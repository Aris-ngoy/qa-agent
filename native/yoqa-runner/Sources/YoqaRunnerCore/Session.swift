import Foundation

/// Turns one command request into its reply. Commands arrive as one POST each, with a
/// `{ "command", "commandId", ... }` body, and are answered `{ "ok": true, "data" }` or
/// `{ "ok": false, "error": { "code", "message" } }`.
public final class Session {
    public init() {}

    public func handle(_ request: HTTPRequest?) -> HTTPResponse {
        guard let request else { return Self.failure(400, "BAD_REQUEST", "unreadable HTTP request") }
        guard request.method == "POST" else {
            return Self.failure(405, "BAD_REQUEST", "commands are POST requests, got \(request.method)")
        }
        guard let body = try? JSONSerialization.jsonObject(with: request.body) as? [String: Any],
              let command = body["command"] as? String
        else { return Self.failure(400, "BAD_REQUEST", "body must be a JSON object with a \"command\"") }

        switch command {
        case "status":
            return .json(200, ["ok": true, "data": ["state": "ready"]])
        default:
            return Self.failure(400, "UNKNOWN_COMMAND", "unknown command \"\(command)\"")
        }
    }

    private static func failure(_ status: Int, _ code: String, _ message: String) -> HTTPResponse {
        .json(status, ["ok": false, "error": ["code": code, "message": message]])
    }
}
