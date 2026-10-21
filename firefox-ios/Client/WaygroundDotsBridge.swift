// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import Security
import UIKit
import WebKit

@MainActor
final class WaygroundDotsBridge: NSObject, WKScriptMessageHandlerWithReply, URLSessionTaskDelegate {
    static let shared = WaygroundDotsBridge()
    static let world = WKContentWorld.world(name: "WaygroundDots")
    private let contexts = NSMapTable<WKWebView, DotsContext>.weakToStrongObjects()
    private let storeKey = "wayground-dots.state.v1"
    private let keys: Set<String> = ["aiConfig", "widgetPosition", "widgetAppearance", "source", "sources",
                                     "sourcesRevision", "themeEnabled", "ios.tab-context.v1", "ios.ai-results.v1",
                                     "remoteConnection", "remoteBootstrapImported", "codexModelsCache"]
    private var sequence = Int.random(in: 1_000_000...2_000_000_000)
    private var approvedOrigins = Set<String>()
    private var jobs = [String: Task<DotsHTTPResponse, Error>]()
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.urlCredentialStorage = nil
        config.urlCache = nil
        config.timeoutIntervalForRequest = 45
        config.timeoutIntervalForResource = 50
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    private var resourceURL: URL? {
        Bundle.main.url(forResource: "WaygroundDotsResources", withExtension: nil)
    }
    private var keychainQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: (Bundle.main.bundleIdentifier ?? "wayground.browser") + ".dots",
         kSecAttrAccount as String: "aiConfig"]
    }

    static func allowedPage(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.scheme == "https" && ["wayground.com", "www.wayground.com"].contains(url.host ?? "")
            && url.port == nil && url.user == nil && url.password == nil
    }

    func install(in webView: WKWebView) {
        guard let resources = resourceURL,
              let source = try? String(contentsOf: resources.appendingPathComponent("page.js"), encoding: .utf8)
        else { return }
        let context = context(for: webView, settings: false)
        let controller = webView.configuration.userContentController
        controller.removeScriptMessageHandler(forName: "waygroundDots", contentWorld: Self.world)
        controller.addScriptMessageHandler(self, contentWorld: Self.world, name: "waygroundDots")
        controller.addUserScript(WKUserScript(source: prefix(context) + source, injectionTime: .atDocumentEnd,
                                              forMainFrameOnly: true, in: Self.world))
    }

    private func context(for webView: WKWebView, settings: Bool) -> DotsContext {
        if let context = contexts.object(forKey: webView) { return context }
        sequence += 1
        let context = DotsContext(webView: webView, id: sequence, settings: settings)
        contexts.setObject(context, forKey: webView)
        return context
    }

    private func prefix(_ context: DotsContext) -> String {
        let base = resourceURL!.absoluteString
        let values: [String: Any] = ["tabId": context.id,
                                     "resourceURL": base.hasSuffix("/") ? base : base + "/"]
        return "globalThis.WGNativeContext = \(json(values));\n"
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, let webView = message.webView,
              let context = contexts.object(forKey: webView), let input = message.body as? [String: Any],
              let op = input["op"] as? String,
              trusted(message.frameInfo.request.url, context: context),
              trusted(webView.url, context: context)
        else { replyHandler(nil, "Untrusted Dots caller"); return }
        Task { @MainActor in
            do { replyHandler(["value": try await perform(op, input: input, context: context)], nil) }
            catch { replyHandler(["error": error.localizedDescription], nil) }
        }
    }

    private func trusted(_ url: URL?, context: DotsContext) -> Bool {
        if !context.settings { return Self.allowedPage(url) }
        return url?.standardizedFileURL == resourceURL?.appendingPathComponent("options.html").standardizedFileURL
    }

    private func fail(_ text: String) -> NSError { NSError(domain: "WaygroundDots", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }

    private func readConfig() throws -> [String: Any]? {
        var query = keychainQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data,
              let value = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { throw fail("Не удалось прочитать ключ ИИ из Keychain (\(status))") }
        return value
    }

    private func writeConfig(_ config: [String: Any]?) throws {
        guard let config else {
            let status = SecItemDelete(keychainQuery as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw fail("Не удалось удалить ключ ИИ (\(status))") }
            return
        }
        let data = try JSONSerialization.data(withJSONObject: config, options: .sortedKeys)
        let update = [kSecValueData as String: data]
        var status = SecItemUpdate(keychainQuery as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var query = keychainQuery
            query[kSecValueData as String] = data
            query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(query as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw fail("Keychain не сохранил ключ ИИ (\(status)). Проверьте подпись приложения") }
    }

    private func selectedKeys(_ value: Any?) throws -> [String] {
        let result: [String]
        if value == nil || value is NSNull { result = Array(keys) }
        else if let value = value as? String { result = [value] }
        else if let value = value as? [String] { result = value }
        else { throw fail("Некорректные ключи хранилища") }
        guard result.allSatisfy(keys.contains) else { throw fail("Недопустимый ключ хранилища") }
        return result
    }

    private func validateConfig(_ config: [String: Any], settings: Bool) throws {
        guard let provider = config["provider"] as? String, ["openai", "gemini", "compatible"].contains(provider),
              let endpoint = config["endpoint"] as? String, let url = URL(string: endpoint),
              url.scheme == "https", url.host != nil, url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil,
              let model = config["model"] as? String, model.count <= 150, !model.isEmpty,
              let token = config["apiKey"] as? String, !token.isEmpty, token.count <= 4096,
              !token.contains(where: { $0.isWhitespace || $0.isNewline }),
              config["enabled"] is Bool, config["images"] is Bool
        else { throw fail("Некорректные настройки ИИ") }
        if !settings {
            guard var previous = try readConfig() else { throw fail("Ключ ИИ задаётся только в настройках") }
            var proposed = config
            previous.removeValue(forKey: "enabled")
            proposed.removeValue(forKey: "enabled")
            guard NSDictionary(dictionary: previous).isEqual(to: proposed) else { throw fail("Менять ключ можно только в настройках") }
        }
    }

    private func perform(_ op: String, input: [String: Any], context: DotsContext) async throws -> Any {
        switch op {
        case "get":
            let selected = try selectedKeys(input["keys"])
            var state = UserDefaults.standard.dictionary(forKey: storeKey) ?? [:]
            if selected.contains("aiConfig"), let config = try readConfig() { state["aiConfig"] = config }
            return state.filter { selected.contains($0.key) }
        case "set", "remove":
            var state = UserDefaults.standard.dictionary(forKey: storeKey) ?? [:]
            let values = input["values"] as? [String: Any] ?? [:]
            let changed = try selectedKeys(op == "set" ? Array(values.keys) : input["keys"])
            let size = try JSONSerialization.data(withJSONObject: values).count
            guard op != "set" || size <= 1024 * 1024
            else { throw fail("Данные хранилища слишком большие") }
            if changed.contains("aiConfig") {
                if op == "set", let config = values["aiConfig"] as? [String: Any] {
                    try validateConfig(config, settings: context.settings)
                    try writeConfig(config)
                } else {
                    guard context.settings else { throw fail("Удалить ключ можно только в настройках") }
                    try writeConfig(nil)
                }
                for job in jobs.values { job.cancel() }
            }
            var changes = [String: Any]()
            for key in changed {
                changes[key] = ["oldValue": state[key] ?? NSNull(), "newValue": op == "set" ? values[key] ?? NSNull() : NSNull()]
                if key == "aiConfig" { changes[key] = ["newValue": true]; continue }
                if op == "set" { state[key] = values[key] } else { state.removeValue(forKey: key) }
            }
            state.removeValue(forKey: "aiConfig")
            UserDefaults.standard.set(state, forKey: storeKey)
            broadcast(changes)
            return true
        case "permission":
            guard let origins = input["origins"] as? [String], origins.count <= 3,
                  origins.allSatisfy({ $0.hasPrefix("https://") && $0.hasSuffix("/*") })
            else { return false }
            if input["request"] as? Bool == true {
                guard context.settings else { return false }
                approvedOrigins.formUnion(origins)
                return true
            }
            let config = try readConfig()
            let endpoint = (config?["endpoint"] as? String).flatMap(URL.init(string:))
            return origins.allSatisfy { origin in
                approvedOrigins.contains(origin) || origin == endpoint.map { "https://\($0.host ?? "")/*" }
                    || (config?["images"] as? Bool == true && ["https://*.quizizz.com/*", "https://*.wayground.com/*"].contains(origin))
            }
        case "settings":
            guard !context.settings, let view = context.webView else { throw fail("Настройки уже открыты") }
            try openSettings(from: view)
            return true
        case "fetch":
            guard let id = input["id"] as? Int, let address = input["url"] as? String,
                  let url = URL(string: address), let method = input["method"] as? String,
                  ["GET", "HEAD", "POST"].contains(method), let headers = input["headers"] as? [String: String]
            else { throw fail("Некорректный сетевой запрос") }
            let config = try (Self.allowedPage(url) && ["GET", "HEAD"].contains(method) ? nil : readConfig())
            try validateRequest(url, method: method, headers: headers, config: config)
            let body = input["body"] as? String
            guard (body?.utf8.count ?? 0) <= 16 * 1024 * 1024 else { throw fail("Слишком большой запрос ИИ") }
            let key = "\(context.id):\(id)"
            guard jobs[key] == nil, jobs.count < 12 else { throw fail("Слишком много запросов Dots") }
            var request = URLRequest(url: url)
            request.httpMethod = method
            request.allHTTPHeaderFields = headers
            request.httpBody = body?.data(using: .utf8)
            let job = Task { @MainActor in try await download(request) }
            jobs[key] = job
            defer { jobs.removeValue(forKey: key) }
            let response = try await job.value
            return ["status": response.status, "headers": response.headers, "body": response.body]
        case "cancel":
            if let id = input["id"] as? Int { jobs["\(context.id):\(id)"]?.cancel() }
            return true
        default: throw fail("Неизвестная команда Dots")
        }
    }

    private func validateRequest(_ url: URL, method: String, headers: [String: String], config: [String: Any]?) throws {
        guard url.scheme == "https", url.host != nil, url.user == nil, url.password == nil,
              url.fragment == nil, headers.keys.allSatisfy({ ["authorization", "content-type", "x-goog-api-key", "accept"].contains($0.lowercased()) })
        else { throw fail("Недопустимый адрес или заголовки") }
        if let endpoint = config?["endpoint"] as? String, let base = URL(string: endpoint),
           url.host == base.host, url.port == base.port, method == "POST",
           url.path == base.path || url.path.hasPrefix(base.path + "/") { return }
        let host = url.host!.lowercased()
        let media = ["wayground.com", "quizizz.com"].contains { host == $0 || host.hasSuffix("." + $0) }
        guard url.port == nil, headers.keys.allSatisfy({ !["authorization", "x-goog-api-key"].contains($0.lowercased()) }),
              method == "HEAD" && Self.allowedPage(url)
                || method == "GET" && (Self.allowedPage(url) || media && config?["images"] as? Bool == true)
        else { throw fail("Запрос вне Wayground и выбранного API запрещён") }
    }

    private func download(_ request: URLRequest) async throws -> DotsHTTPResponse {
        let (bytes, response) = try await session.bytes(for: request)
        guard let response = response as? HTTPURLResponse else { throw fail("Сервер не вернул HTTP-ответ") }
        let limit = request.httpMethod == "POST" ? 1024 * 1024 : 5 * 1024 * 1024
        guard response.expectedContentLength <= limit else { throw fail("Ответ сервера слишком большой") }
        var data = Data()
        for try await byte in bytes {
            if data.count >= limit { throw fail("Ответ сервера превышает лимит") }
            data.append(byte)
        }
        try Task.checkCancellation()
        return DotsHTTPResponse(status: response.statusCode,
                                headers: ["content-type": response.value(forHTTPHeaderField: "Content-Type") ?? ""],
                                body: data.base64EncodedString())
    }

    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask,
                                willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                                completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    private func broadcast(_ changes: [String: Any]) {
        let script = "globalThis.__wgNativeStorage?.(\(json(changes)))"
        for view in contexts.keyEnumerator().allObjects.compactMap({ $0 as? WKWebView }) {
            guard let context = contexts.object(forKey: view), trusted(view.url, context: context) else { continue }
            view.evaluateJavaScript(script, in: nil, in: context.settings ? .page : Self.world) { _ in }
        }
    }

    private func json(_ value: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .fragmentsAllowed]),
              let text = String(data: data, encoding: .utf8) else { return "{}" }
        return text
    }

    private func openSettings(from webView: WKWebView) throws {
        guard let url = resourceURL?.appendingPathComponent("options.html") else { throw fail("Ресурсы Dots отсутствуют") }
        var responder: UIResponder? = webView
        while responder != nil && !(responder is UIViewController) { responder = responder?.next }
        guard let presenter = responder as? UIViewController, presenter.presentedViewController == nil
        else { throw fail("Не удалось открыть окно настроек") }
        let settingsView = WKWebView(frame: .zero)
        let controller = DotsSettingsController(webView: settingsView, pageURL: url)
        let context = context(for: settingsView, settings: true)
        settingsView.configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "waygroundDots")
        settingsView.configuration.userContentController.addUserScript(WKUserScript(source: prefix(context), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        settingsView.navigationDelegate = controller
        settingsView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        presenter.present(UINavigationController(rootViewController: controller), animated: true)
    }
}

private struct DotsHTTPResponse: Sendable {
    let status: Int
    let headers: [String: String]
    let body: String
}

@MainActor
private final class DotsContext: NSObject {
    weak var webView: WKWebView?
    let id: Int
    let settings: Bool
    private var observation: NSKeyValueObservation?
    private var button: UIButton?

    init(webView: WKWebView, id: Int, settings: Bool) {
        self.webView = webView
        self.id = id
        self.settings = settings
        super.init()
        guard !settings else { return }
        let button = UIButton(type: .system)
        button.setImage(UIImage(systemName: "circle.grid.2x2.fill"), for: .normal)
        button.backgroundColor = .secondarySystemBackground
        button.layer.cornerRadius = 22
        button.accessibilityLabel = "Настройки Wayground Dots"
        button.translatesAutoresizingMaskIntoConstraints = false
        button.addTarget(self, action: #selector(showPanel), for: .touchUpInside)
        webView.addSubview(button)
        NSLayoutConstraint.activate([
            button.leadingAnchor.constraint(equalTo: webView.safeAreaLayoutGuide.leadingAnchor, constant: 12),
            button.bottomAnchor.constraint(equalTo: webView.safeAreaLayoutGuide.bottomAnchor, constant: -12),
            button.widthAnchor.constraint(equalToConstant: 44), button.heightAnchor.constraint(equalToConstant: 44)
        ])
        self.button = button
        observation = webView.observe(\.url, options: [.initial, .new]) { [weak button] view, _ in
            MainActor.assumeIsolated { button?.isHidden = !WaygroundDotsBridge.allowedPage(view.url) }
        }
    }

    @objc private func showPanel() {
        webView?.evaluateJavaScript("globalThis.__wgNativePanel?.()", in: nil, in: WaygroundDotsBridge.world) { _ in }
    }
}

@MainActor
private final class DotsSettingsController: UIViewController, WKNavigationDelegate {
    private let webView: WKWebView
    private let pageURL: URL
    init(webView: WKWebView, pageURL: URL) {
        self.webView = webView
        self.pageURL = pageURL
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { nil }
    override func loadView() { view = webView }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Wayground Dots"
        navigationItem.rightBarButtonItem = UIBarButtonItem(systemItem: .done, primaryAction: UIAction { [weak self] _ in
            self?.dismiss(animated: true)
        })
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        navigationAction.request.url?.standardizedFileURL == pageURL.standardizedFileURL ? .allow : .cancel
    }
}
