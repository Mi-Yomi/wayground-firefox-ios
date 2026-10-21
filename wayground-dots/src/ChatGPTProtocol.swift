// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import Foundation
import CryptoKit
import Security

enum ChatGPTProtocol {
    static let issuer = "https://auth.openai.com"
    static let resource = "https://api.openai.com/v1"
    static let scope = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
    static func error(_ message: String) -> NSError {
        NSError(domain: "WaygroundChatGPT", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    static func decode(_ value: String) throws -> Data {
        guard value.utf8.count <= 65536,
              value.range(of: "^[A-Za-z0-9_-]*$", options: .regularExpression) != nil,
              let data = Data(base64Encoded: value.replacingOccurrences(of: "-", with: "+")
                .replacingOccurrences(of: "_", with: "/") + String(repeating: "=", count: (4 - value.count % 4) % 4))
        else { throw error("Некорректный ответ авторизации") }
        return data
    }
    static func random() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess
        else { throw error("Не удалось подготовить защищённый вход") }
        return base64URL(Data(bytes))
    }
    static func challenge(_ verifier: String) -> String { base64URL(Data(SHA256.hash(data: Data(verifier.utf8)))) }
    static func form(_ values: [String: String]) -> Data {
        var parts = URLComponents()
        parts.queryItems = values.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        return Data((parts.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B").utf8)
    }
    static func callback(target: String, host: String, port: UInt16, state: String, clientID: String?) throws -> [String: String] {
        guard host == "127.0.0.1:\(port)", target.hasPrefix("/auth/callback?"), target.utf8.count < 8192,
              let url = URLComponents(string: "http://127.0.0.1:\(port)" + target), url.path == "/auth/callback",
              url.host == "127.0.0.1", let items = url.queryItems,
              Set(items.map(\.name)).count == items.count
        else { throw error("Недопустимый callback авторизации") }
        let values = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
        guard values["state"] == state else { throw error("Состояние входа не совпало") }
        if values["error"] != nil { return values }
        guard let code = values["code"], !code.isEmpty, code.count <= 4096 else { throw error("Нет кода авторизации") }
        if let clientID {
            guard values["client_id"] == nil || values["client_id"] == clientID else { throw error("Регистрация аккаунта изменилась") }
        } else {
            guard let issued = values["client_id"], !issued.isEmpty, issued != "dynamic_agent_client", issued.count < 512
            else { throw error("OpenAI не вернул регистрацию приложения") }
        }
        return values
    }
    private static func der(_ tag: UInt8, _ data: Data) -> Data {
        var length = data.count, bytes = [UInt8]()
        repeat { bytes.insert(UInt8(length & 255), at: 0); length >>= 8 } while length > 0
        return Data([tag] + (data.count < 128 ? [UInt8(data.count)] : [0x80 | UInt8(bytes.count)] + bytes)) + data
    }
    private static func integer(_ data: Data) -> Data {
        let value = Data(data.drop { $0 == 0 })
        return der(2, (value.first.map { $0 & 0x80 != 0 } == true ? Data([0]) : Data()) + value)
    }
    static func identity(token: String, keys: [[String: Any]], clientID: String, nonce: String?, now: TimeInterval = Date().timeIntervalSince1970) throws -> (subject: String, email: String) {
        let parts = token.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 3,
              let header = try JSONSerialization.jsonObject(with: decode(parts[0])) as? [String: Any],
              let claims = try JSONSerialization.jsonObject(with: decode(parts[1])) as? [String: Any],
              let kid = header["kid"] as? String, let algorithm = header["alg"] as? String,
              let key = keys.first(where: { $0["kid"] as? String == kid }),
              key["use"] == nil || key["use"] as? String == "sig",
              key["alg"] == nil || key["alg"] as? String == algorithm
        else { throw error("Не удалось проверить подпись аккаунта") }
        let signature = try decode(parts[2]), message = Data((parts[0] + "." + parts[1]).utf8)
        var verified = false
        if algorithm == "RS256", key["kty"] as? String == "RSA", let n = key["n"] as? String, let e = key["e"] as? String {
            let modulus = try decode(n)
            guard modulus.count >= 256, modulus.count <= 1024 else { throw error("Недопустимый ключ подписи") }
            let data = try der(0x30, integer(modulus) + integer(decode(e)))
            if let publicKey = SecKeyCreateWithData(data as CFData, [kSecAttrKeyType: kSecAttrKeyTypeRSA, kSecAttrKeyClass: kSecAttrKeyClassPublic] as CFDictionary, nil) {
                verified = SecKeyVerifySignature(publicKey, .rsaSignatureMessagePKCS1v15SHA256, message as CFData, signature as CFData, nil)
            }
        } else if algorithm == "ES256", key["kty"] as? String == "EC", key["crv"] as? String == "P-256",
                  let x = key["x"] as? String, let y = key["y"] as? String {
            let publicKey = try P256.Signing.PublicKey(x963Representation: Data([4]) + decode(x) + decode(y))
            verified = try publicKey.isValidSignature(P256.Signing.ECDSASignature(rawRepresentation: signature), for: message)
        }
        let audiences = (claims["aud"] as? [String]) ?? (claims["aud"] as? String).map { [$0] } ?? []
        guard verified, claims["iss"] as? String == issuer, audiences.contains(clientID),
              claims["azp"] == nil || claims["azp"] as? String == clientID,
              let expiration = claims["exp"] as? Double, expiration > now,
              (claims["iat"] as? Double ?? now) <= now + 300,
              nonce == nil || claims["nonce"] as? String == nonce,
              let subject = claims["sub"] as? String, !subject.isEmpty
        else { throw error("Проверка личности аккаунта не пройдена. Повторите вход") }
        return (subject, claims["email"] as? String ?? "Аккаунт ChatGPT")
    }
    static func completed(_ response: [String: Any], streamedText: String = "") throws -> Data {
        guard response["status"] as? String == "completed", response["incomplete_details"] == nil || response["incomplete_details"] is NSNull,
              response["error"] == nil || response["error"] is NSNull
        else { throw error("Ответ ChatGPT не завершён [CGPT_OUTPUT_STATUS]") }
        guard response["output"] == nil || response["output"] is [[String: Any]]
        else { throw error("Некорректная структура ответа ChatGPT [CGPT_OUTPUT_SHAPE]") }
        let output = response["output"] as? [[String: Any]] ?? []
        let content = output.flatMap { $0["content"] as? [[String: Any]] ?? [] }
        guard !content.contains(where: { $0["type"] as? String == "refusal" }) else { throw error("ChatGPT отклонил запрос") }
        let finalText = content.filter { $0["type"] as? String == "output_text" }.compactMap { $0["text"] as? String }.joined()
        var text = (finalText.isEmpty ? streamedText : finalText).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw error("ChatGPT завершил запрос без текста подсказки [CGPT_OUTPUT_EMPTY]") }
        // Match the other providers: accept one JSON code block, never extract arbitrary prose.
        if text.hasPrefix("```"), text.hasSuffix("```"), let newline = text.firstIndex(of: "\n"),
           ["```", "```json"].contains(text[..<newline].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()) {
            text = String(text[text.index(after: newline)..<text.index(text.endIndex, offsetBy: -3)]).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        let data = Data(text.utf8)
        guard data.count <= 128 * 1024,
              let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              ["ready", "uncertain", "unreadable"].contains(value["status"] as? String ?? ""),
              value["selectedChoiceIds"] is [String], value["explanation"] is String
        else { throw error("ChatGPT вернул подсказку не в ожидаемом JSON-формате [CGPT_OUTPUT_JSON]") }
        return data
    }
}

struct ChatGPTEventStream {
    private var line = Data(), event = [String](), total = 0
    private var fragments = [Int: [Int: String]]()
    var outputText: String { fragments.keys.sorted().map { index in
        fragments[index]!.keys.sorted().map { fragments[index]![$0]! }.joined()
    }.joined() }
    mutating func feed(_ byte: UInt8) throws -> [String: Any]? {
        total += 1
        guard total <= 2 * 1024 * 1024, line.count <= 65536 else { throw ChatGPTProtocol.error("Слишком большой ответ ChatGPT") }
        if byte != 10 { line.append(byte); return nil }
        let text = String(decoding: line, as: UTF8.self).trimmingCharacters(in: .newlines)
        line.removeAll(keepingCapacity: true)
        if text.hasPrefix("data:") { event.append(String(text.dropFirst(5)).trimmingCharacters(in: .whitespaces)); return nil }
        guard text.isEmpty, !event.isEmpty else { return nil }
        let data = Data(event.joined(separator: "\n").utf8)
        event.removeAll(keepingCapacity: true)
        if String(decoding: data, as: UTF8.self) == "[DONE]" { return nil }
        guard let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { throw ChatGPTProtocol.error("OpenAI вернул повреждённое событие потока [CGPT_STREAM_JSON]") }
        let type = value["type"] as? String
        if ["error", "response.failed", "response.incomplete"].contains(type ?? "") {
            throw ChatGPTProtocol.error("ChatGPT не завершил запрос: проверьте лимиты и доступ к модели в настройках ChatGPT")
        }
        if type == "response.refusal.delta" || type == "response.refusal.done" { throw ChatGPTProtocol.error("ChatGPT отклонил запрос") }
        if type == "response.output_text.delta" || type == "response.output_text.done" {
            guard let index = value["output_index"] as? Int, let part = value["content_index"] as? Int,
                  (0..<100).contains(index), (0..<100).contains(part),
                  let text = value[type == "response.output_text.done" ? "text" : "delta"] as? String
            else { throw ChatGPTProtocol.error("Некорректная структура текста в потоке [CGPT_STREAM_TEXT]") }
            let previous = fragments[index]?[part] ?? ""
            fragments[index, default: [:]][part] = type == "response.output_text.done" ? text : previous + text
        }
        if type == "response.completed" {
            guard let response = value["response"] as? [String: Any]
            else { throw ChatGPTProtocol.error("Поток завершился без результата [CGPT_STREAM_TERMINAL]") }
            return response
        }
        return nil
    }
}
