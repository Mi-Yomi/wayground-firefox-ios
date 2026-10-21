import Foundation
import CryptoKit
import Security

@main
struct ChatGPTProtocolTests {
    static func reject(_ job: () throws -> Void) {
        do { try job(); preconditionFailure("Invalid authorization was accepted") } catch { }
    }
    static func main() throws {
        let callback = "/auth/callback?state=test-state&code=example-code&client_id=oaiapp_fixture"
        let result = try ChatGPTProtocol.callback(target: callback, host: "127.0.0.1:1455", port: 1455, state: "test-state", clientID: nil)
        precondition(result["code"] == "example-code")
        reject { _ = try ChatGPTProtocol.callback(target: callback, host: "evil.example:1455", port: 1455, state: "test-state", clientID: nil) }
        reject { _ = try ChatGPTProtocol.callback(target: callback, host: "127.0.0.1:1455", port: 1455, state: "wrong-state", clientID: nil) }
        reject { _ = try ChatGPTProtocol.callback(target: callback + "&code=second", host: "127.0.0.1:1455", port: 1455, state: "test-state", clientID: nil) }
        reject { _ = try ChatGPTProtocol.callback(target: callback, host: "127.0.0.1:1455", port: 1455, state: "test-state", clientID: "different-client") }
        precondition(ChatGPTProtocol.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        let privateKey = P256.Signing.PrivateKey()
        let publicData = privateKey.publicKey.x963Representation
        let jwk: [String: Any] = ["kid": "fixture", "kty": "EC", "crv": "P-256", "alg": "ES256", "use": "sig",
                                  "x": ChatGPTProtocol.base64URL(publicData.subdata(in: 1..<33)), "y": ChatGPTProtocol.base64URL(publicData.subdata(in: 33..<65))]
        let claims: [String: Any] = ["iss": "https://auth.openai.com", "aud": "oaiapp_fixture", "sub": "fixture-user", "nonce": "fixture-nonce", "exp": 2000, "iat": 1000]
        func token(_ claims: [String: Any]) throws -> String {
            let header = try ChatGPTProtocol.base64URL(JSONSerialization.data(withJSONObject: ["alg": "ES256", "kid": "fixture"]))
            let payload = try ChatGPTProtocol.base64URL(JSONSerialization.data(withJSONObject: claims))
            let content = header + "." + payload
            return try content + "." + ChatGPTProtocol.base64URL(privateKey.signature(for: Data(content.utf8)).rawRepresentation)
        }
        let signed = try token(claims)
        let identity = try ChatGPTProtocol.identity(token: signed, keys: [jwk], clientID: "oaiapp_fixture", nonce: "fixture-nonce", now: 1500)
        precondition(identity.subject == "fixture-user")
        reject { _ = try ChatGPTProtocol.identity(token: signed, keys: [jwk], clientID: "other", nonce: "fixture-nonce", now: 1500) }
        reject { _ = try ChatGPTProtocol.identity(token: signed, keys: [jwk], clientID: "oaiapp_fixture", nonce: "wrong", now: 1500) }
        reject { _ = try ChatGPTProtocol.identity(token: signed, keys: [jwk], clientID: "oaiapp_fixture", nonce: "fixture-nonce", now: 2500) }
        let otherKey = P256.Signing.PrivateKey().publicKey.x963Representation
        var wrongJWK = jwk
        wrongJWK["x"] = ChatGPTProtocol.base64URL(otherKey.subdata(in: 1..<33)); wrongJWK["y"] = ChatGPTProtocol.base64URL(otherKey.subdata(in: 33..<65))
        reject { _ = try ChatGPTProtocol.identity(token: signed, keys: [wrongJWK], clientID: "oaiapp_fixture", nonce: "fixture-nonce", now: 1500) }
        var stream = ChatGPTEventStream()
        for byte in Data("data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n".utf8) {
            let partial = try stream.feed(byte)
            precondition(partial == nil)
        }
        let answer = "{\"status\":\"ready\",\"selectedChoiceIds\":[\"2\"],\"explanation\":\"fixture\"}"
        let completed: [String: Any] = ["status": "completed", "output": [["content": [["type": "output_text", "text": answer]]]]]
        let event = try JSONSerialization.data(withJSONObject: ["type": "response.completed", "response": completed])
        var observed: [String: Any]?
        for byte in Data("data: ".utf8) + event + Data("\r\n\r\n".utf8) { if let value = try stream.feed(byte) { observed = value } }
        precondition(observed != nil)
        let completedData = try ChatGPTProtocol.completed(observed!)
        precondition(completedData == Data(answer.utf8))
        reject {
            var failed = ChatGPTEventStream()
            for byte in Data("data: {\"type\":\"response.failed\"}\n\n".utf8) { _ = try failed.feed(byte) }
        }
        reject { _ = try ChatGPTProtocol.completed(["status": "incomplete", "output": []]) }
        print("ChatGPT protocol self-check passed: callback binding, PKCE, signed identity, claims, terminal stream and failure handling")
    }
}
