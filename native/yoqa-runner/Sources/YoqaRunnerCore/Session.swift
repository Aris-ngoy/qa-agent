import Foundation

/// Turns one command request into its reply. Commands arrive as one POST each, with a
/// `{ "command", "commandId", ... }` body, and are answered `{ "ok": true, "data" }` or
/// `{ "ok": false, "error": { "code", "message" } }`.
///
/// Gestures are journaled by `commandId` (see `Journal`). `status` with a
/// `statusCommandId` reports that command as `pending`, `done` (with its reply) or `unknown`.
public final class Session {
    private let device: Device
    private let journal: Journal

    public init(device: Device, journal: Journal = Journal()) {
        self.device = device
        self.journal = journal
    }

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
            return status(body)
        case "viewport":
            return run {
                let size = try self.device.viewport()
                return ["width": size.width, "height": size.height]
            }
        case "screenshot":
            return run { ["png": try self.device.screenshot().base64EncodedString()] }
        case "tap", "longPress", "drag":
            return journaled(body) { try self.gesture(command, body) }
        default:
            return Self.failure(400, "UNKNOWN_COMMAND", "unknown command \"\(command)\"")
        }
    }

    private func status(_ body: [String: Any]) -> HTTPResponse {
        var data: [String: Any] = ["state": "ready"]
        if let id = body["statusCommandId"] as? String {
            switch journal.lookup(id) {
            case nil:
                data["command"] = ["state": "unknown"]
            case .pending:
                data["command"] = ["state": "pending"]
            case .done(let response):
                let reply = (try? JSONSerialization.jsonObject(with: response.body)) ?? [:]
                data["command"] = ["state": "done", "reply": reply]
            }
        }
        return .json(200, ["ok": true, "data": data])
    }

    /// Run a gesture once per `commandId`. A repeated id gets the recorded reply, or
    /// `COMMAND_PENDING` while the first is still running; it never fires again.
    private func journaled(_ body: [String: Any], _ perform: () throws -> HTTPResponse) -> HTTPResponse {
        guard let id = body["commandId"] as? String, !id.isEmpty else {
            return Self.failure(400, "BAD_REQUEST", "a gesture needs a \"commandId\"")
        }
        switch journal.begin(id) {
        case .done(let response):
            return response
        case .pending:
            return Self.failure(409, "COMMAND_PENDING", "command \(id) is still running")
        case nil:
            let response: HTTPResponse
            do {
                response = try perform()
            } catch let error as BadRequest {
                response = Self.failure(400, "BAD_REQUEST", error.message)
            } catch {
                response = Self.failure(500, "DEVICE_ERROR", "\(error)")
            }
            journal.finish(id, response)
            return response
        }
    }

    private func gesture(_ command: String, _ body: [String: Any]) throws -> HTTPResponse {
        switch command {
        case "tap":
            try device.tap(try Self.fraction(body, "x", "y"))
        case "longPress":
            let point = try Self.fraction(body, "x", "y")
            try device.longPress(point, seconds: try Self.seconds(body, "durationMs"))
        case "drag":
            try device.drag(
                from: try Self.fraction(body, "fromX", "fromY"),
                to: try Self.fraction(body, "toX", "toY"),
                pressSeconds: try Self.seconds(body, "pressMs"),
                seconds: try Self.seconds(body, "durationMs")
            )
        default:
            throw BadRequest(message: "\"\(command)\" is not a gesture")
        }
        return .json(200, ["ok": true, "data": [String: Any]()])
    }

    private func run(_ read: () throws -> [String: Any]) -> HTTPResponse {
        do {
            return .json(200, ["ok": true, "data": try read()])
        } catch {
            return Self.failure(500, "DEVICE_ERROR", "\(error)")
        }
    }

    private struct BadRequest: Error {
        let message: String
    }

    private static func fraction(_ body: [String: Any], _ xKey: String, _ yKey: String) throws -> Fraction {
        guard let x = (body[xKey] as? NSNumber)?.doubleValue, let y = (body[yKey] as? NSNumber)?.doubleValue,
              (0...1).contains(x), (0...1).contains(y)
        else { throw BadRequest(message: "\"\(xKey)\" and \"\(yKey)\" must be fractions from 0 to 1") }
        return Fraction(x: x, y: y)
    }

    private static func seconds(_ body: [String: Any], _ key: String) throws -> Double {
        guard let ms = (body[key] as? NSNumber)?.doubleValue, ms >= 0 else {
            throw BadRequest(message: "\"\(key)\" must be a number of milliseconds")
        }
        return ms / 1000
    }

    private static func failure(_ status: Int, _ code: String, _ message: String) -> HTTPResponse {
        .json(status, ["ok": false, "error": ["code": code, "message": message]])
    }
}
