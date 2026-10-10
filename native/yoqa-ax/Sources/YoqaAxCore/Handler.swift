import Foundation

/// Answers one request: `{"id":1,"method":"ping"}` gives `{"id":1,"result":"ok"}`, and any
/// failure gives `{"id":1,"error":"…"}`. Requests are handled one at a time.
///
/// `describe` gives `{"nodes":[…],"degraded":false}`, or no nodes and `degraded: true`.
/// `alert` gives `{"title":"…","buttons":[{"label":"…","frame":{…}}]}`, or `{"buttons":[]}`.
public struct Handler {
    private let describe: () -> Tree
    private let alert: () -> Alert

    /// `describe` reads the accessibility tree and `alert` the SpringBoard dialog; the binary
    /// passes the in-simulator reader.
    public init(describe: @escaping () -> Tree, alert: @escaping () -> Alert) {
        self.describe = describe
        self.alert = alert
    }

    public func respond(to request: Data) -> Data {
        let object = (try? JSONSerialization.jsonObject(with: request)) as? [String: Any]
        let id = object?["id"]
        guard let method = object?["method"] as? String else {
            return reply(id: id, ["error": "request is not a JSON object with a method"])
        }
        switch method {
        case "ping": return reply(id: id, ["result": "ok"])
        case "describe": return reply(id: id, ["result": describe().json])
        case "alert": return reply(id: id, ["result": alert().json])
        default: return reply(id: id, ["error": "unknown method \(method)"])
        }
    }

    private func reply(id: Any?, _ fields: [String: Any]) -> Data {
        var body = fields
        if let id { body["id"] = id }
        return (try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])) ?? Data("{}".utf8)
    }
}
