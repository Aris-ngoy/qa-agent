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
    private let recorder: FrameRecorder

    public init(device: Device, journal: Journal = Journal()) {
        self.device = device
        self.journal = journal
        self.recorder = FrameRecorder(device: device)
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
        case "recordStart":
            return recordStart(body)
        case "recordFetch":
            return recordFetch(body)
        case "recordStop":
            recorder.stop()
            return .json(200, ["ok": true, "data": [String: Any]()])
        case "snapshot":
            return run { ["nodes": try self.device.snapshot(bundleId: body["bundleId"] as? String).map(Self.json)] }
        case "tap", "longPress", "drag", "type", "keyboardReturn", "keyboardDelete", "button":
            return journaled(body) { try self.gesture(command, body) }
        default:
            return Self.failure(400, "UNKNOWN_COMMAND", "unknown command \"\(command)\"")
        }
    }

    /// `fps`, `scale` and `quality` are optional: 8 frames a second at 0.5 size and 0.6 quality.
    private func recordStart(_ body: [String: Any]) -> HTTPResponse {
        func number(_ key: String, _ fallback: Double, _ range: ClosedRange<Double>) -> Double {
            min(range.upperBound, max(range.lowerBound, (body[key] as? NSNumber)?.doubleValue ?? fallback))
        }
        recorder.start(fps: number("fps", 8, 1...30), scale: number("scale", 0.5, 0.1...1), quality: number("quality", 0.6, 0.1...1))
        return .json(200, ["ok": true, "data": [String: Any]()])
    }

    private func recordFetch(_ body: [String: Any]) -> HTTPResponse {
        let batch = recorder.fetch(after: (body["after"] as? NSNumber)?.intValue)
        var data: [String: Any] = [
            "running": batch.running,
            "frames": batch.frames.map { ["seq": $0.seq, "ms": $0.ms, "jpeg": $0.jpeg.base64EncodedString()] },
        ]
        if let error = batch.error { data["error"] = error }
        return .json(200, ["ok": true, "data": data])
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
                response = Self.deviceFailure(error)
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
        case "type":
            guard let text = body["text"] as? String else {
                throw BadRequest(message: "\"text\" must be a string")
            }
            try device.typeText(text)
        case "keyboardReturn":
            try device.keyboardReturn()
        case "keyboardDelete":
            try device.keyboardDelete()
        case "button":
            guard let name = body["name"] as? String, ["home", "volumeUp", "volumeDown"].contains(name) else {
                throw BadRequest(message: "\"name\" must be home, volumeUp or volumeDown")
            }
            try device.button(name)
        default:
            throw BadRequest(message: "\"\(command)\" is not a gesture")
        }
        return .json(200, ["ok": true, "data": [String: Any]()])
    }

    private func run(_ read: () throws -> [String: Any]) -> HTTPResponse {
        do {
            return .json(200, ["ok": true, "data": try read()])
        } catch {
            return Self.deviceFailure(error)
        }
    }

    /// `APP_BACKGROUNDED` and `RUNNER_WEDGED` reach the Mac as their own codes.
    private static func deviceFailure(_ error: Error) -> HTTPResponse {
        switch error {
        case let error as AppBackgrounded: return failure(409, "APP_BACKGROUNDED", error.description)
        case let error as RunnerWedged: return failure(503, "RUNNER_WEDGED", error.description)
        default: return failure(500, "DEVICE_ERROR", "\(error)")
        }
    }

    private static func json(_ node: SnapshotNode) -> [String: Any] {
        var out: [String: Any] = [
            "role": node.role,
            "frame": ["x": node.frame.x, "y": node.frame.y, "width": node.frame.width, "height": node.frame.height],
            "enabled": node.enabled,
        ]
        if let label = node.label { out["label"] = label }
        if let value = node.value { out["value"] = value }
        if let id = node.id { out["id"] = id }
        return out
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
