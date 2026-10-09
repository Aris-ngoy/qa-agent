import Foundation

/// Answers one request: `{"id":1,"method":"ping"}` gives `{"id":1,"result":"ok"}`, and any
/// failure gives `{"id":1,"error":"…"}`. Requests are handled one at a time.
public struct Handler {
    public init() {}

    public func respond(to request: Data) -> Data {
        let object = (try? JSONSerialization.jsonObject(with: request)) as? [String: Any]
        let id = object?["id"]
        guard let method = object?["method"] as? String else {
            return reply(id: id, ["error": "request is not a JSON object with a method"])
        }
        switch method {
        case "ping": return reply(id: id, ["result": "ok"])
        default: return reply(id: id, ["error": "unknown method \(method)"])
        }
    }

    private func reply(id: Any?, _ fields: [String: Any]) -> Data {
        var body = fields
        if let id { body["id"] = id }
        return (try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])) ?? Data("{}".utf8)
    }
}
