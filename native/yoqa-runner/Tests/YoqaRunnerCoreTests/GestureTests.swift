import XCTest
import YoqaRunnerCore

/// Gestures and frames at the Session, with the phone faked: coordinates arrive as 0.0–1.0
/// fractions of the screen, and mutating commands are journaled by `commandId`.
final class GestureTests: XCTestCase {
    private var device: FakeDevice!
    private var session: Session!

    override func setUp() {
        device = FakeDevice()
        session = Session(device: device)
    }

    func testViewportIsTheScreenInPoints() throws {
        let data = try ok(["command": "viewport", "commandId": "v1"])
        XCTAssertEqual(data["width"] as? Double, 393)
        XCTAssertEqual(data["height"] as? Double, 852)
    }

    func testATapLandsAtItsFraction() throws {
        _ = try ok(["command": "tap", "commandId": "t1", "x": 0.25, "y": 0.75])
        XCTAssertEqual(device.calls, ["tap 0.25,0.75"])
    }

    func testALongPressHoldsForItsDuration() throws {
        _ = try ok(["command": "longPress", "commandId": "l1", "x": 0.5, "y": 0.5, "durationMs": 1200])
        XCTAssertEqual(device.calls, ["longPress 0.5,0.5 1.2s"])
    }

    func testADragPressesThenMoves() throws {
        _ = try ok([
            "command": "drag", "commandId": "d1",
            "fromX": 0.1, "fromY": 0.2, "toX": 0.3, "toY": 0.4, "pressMs": 500, "durationMs": 800,
        ])
        XCTAssertEqual(device.calls, ["drag 0.1,0.2 -> 0.3,0.4 press 0.5s move 0.8s"])
    }

    func testAScreenshotIsBase64Png() throws {
        let data = try ok(["command": "screenshot", "commandId": "s1"])
        XCTAssertEqual(Data(base64Encoded: data["png"] as? String ?? ""), device.png)
    }

    func testACoordinateOffTheScreenIsABadRequest() throws {
        let (status, body) = reply(["command": "tap", "commandId": "t2", "x": 1.5, "y": 0.5])
        XCTAssertEqual(status, 400)
        XCTAssertEqual(errorCode(body), "BAD_REQUEST")
        XCTAssertEqual(device.calls, [])
    }

    func testAGestureWithoutACommandIdIsABadRequest() throws {
        let (status, body) = reply(["command": "tap", "x": 0.5, "y": 0.5])
        XCTAssertEqual(status, 400)
        XCTAssertEqual(errorCode(body), "BAD_REQUEST")
        XCTAssertEqual(device.calls, [])
    }

    func testARepeatedCommandIdAnswersFromTheJournalWithoutFiringAgain() throws {
        let tap: [String: Any] = ["command": "tap", "commandId": "t3", "x": 0.5, "y": 0.5]
        let first = reply(tap)
        let second = reply(tap)
        XCTAssertEqual(device.calls.count, 1)
        XCTAssertEqual(first.0, second.0)
        XCTAssertEqual(first.1["ok"] as? Bool, true)
        XCTAssertEqual(second.1["ok"] as? Bool, true)
    }

    func testStatusLooksUpAFinishedCommandAndItsReply() throws {
        _ = try ok(["command": "tap", "commandId": "t4", "x": 0.5, "y": 0.5])
        let data = try ok(["command": "status", "commandId": "s2", "statusCommandId": "t4"])
        XCTAssertEqual(data["state"] as? String, "ready")
        let command = try XCTUnwrap(data["command"] as? [String: Any])
        XCTAssertEqual(command["state"] as? String, "done")
        XCTAssertEqual((command["reply"] as? [String: Any])?["ok"] as? Bool, true)
    }

    func testStatusSaysUnknownForACommandThatNeverArrived() throws {
        let data = try ok(["command": "status", "commandId": "s3", "statusCommandId": "never"])
        XCTAssertEqual((data["command"] as? [String: Any])?["state"] as? String, "unknown")
    }

    func testStatusSeesACommandStillRunningAsPending() throws {
        device.hold = DispatchSemaphore(value: 0)
        let finished = expectation(description: "tap finished")
        DispatchQueue.global().async {
            _ = self.reply(["command": "tap", "commandId": "t5", "x": 0.5, "y": 0.5])
            finished.fulfill()
        }
        device.entered.wait()
        let data = try ok(["command": "status", "commandId": "s4", "statusCommandId": "t5"])
        XCTAssertEqual((data["command"] as? [String: Any])?["state"] as? String, "pending")
        device.hold?.signal()
        wait(for: [finished], timeout: 5)
    }

    func testTheJournalKeepsTheLast64Commands() throws {
        for index in 0..<65 {
            _ = try ok(["command": "tap", "commandId": "j\(index)", "x": 0.5, "y": 0.5])
        }
        let oldest = try ok(["command": "status", "commandId": "s5", "statusCommandId": "j0"])
        XCTAssertEqual((oldest["command"] as? [String: Any])?["state"] as? String, "unknown")
        let newest = try ok(["command": "status", "commandId": "s6", "statusCommandId": "j64"])
        XCTAssertEqual((newest["command"] as? [String: Any])?["state"] as? String, "done")
        let kept = try ok(["command": "status", "commandId": "s7", "statusCommandId": "j1"])
        XCTAssertEqual((kept["command"] as? [String: Any])?["state"] as? String, "done")
    }

    func testAFailedGestureIsADeviceErrorAndIsJournaled() throws {
        device.failure = "no window"
        let (status, body) = reply(["command": "tap", "commandId": "t6", "x": 0.5, "y": 0.5])
        XCTAssertEqual(status, 500)
        XCTAssertEqual(errorCode(body), "DEVICE_ERROR")
        let data = try ok(["command": "status", "commandId": "s8", "statusCommandId": "t6"])
        let command = try XCTUnwrap(data["command"] as? [String: Any])
        XCTAssertEqual(command["state"] as? String, "done")
        XCTAssertEqual((command["reply"] as? [String: Any])?["ok"] as? Bool, false)
    }

    // MARK: - Helpers

    private func reply(_ object: [String: Any]) -> (Int, [String: Any]) {
        let body = try! JSONSerialization.data(withJSONObject: object)
        var raw = Data("POST / HTTP/1.1\r\nContent-Length: \(body.count)\r\n\r\n".utf8)
        raw.append(body)
        let response = session.handle(HTTPRequest.parse(raw))
        let json = (try? JSONSerialization.jsonObject(with: response.body)) as? [String: Any]
        return (response.status, json ?? [:])
    }

    private func ok(_ object: [String: Any]) throws -> [String: Any] {
        let (status, body) = reply(object)
        XCTAssertEqual(status, 200, "\(body)")
        return try XCTUnwrap(body["data"] as? [String: Any], "\(body)")
    }

    private func errorCode(_ body: [String: Any]) -> String? {
        (body["error"] as? [String: Any])?["code"] as? String
    }
}

/// The phone: records each gesture as a line, serves a fixed PNG, and can hold a gesture
/// mid-flight (`hold`) or fail every call (`failure`).
final class FakeDevice: Device {
    private let lock = NSLock()
    private var recorded: [String] = []
    let png = Data([0x89, 0x50, 0x4E, 0x47, 1, 2, 3])
    var failure: String?
    var hold: DispatchSemaphore?
    let entered = DispatchSemaphore(value: 0)

    var calls: [String] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    private func record(_ line: String) throws {
        if let failure { throw DeviceError(failure) }
        lock.lock()
        recorded.append(line)
        lock.unlock()
        entered.signal()
        hold?.wait()
    }

    func viewport() throws -> (width: Double, height: Double) { (393, 852) }

    func tap(_ point: Fraction) throws { try record("tap \(point.x),\(point.y)") }

    func longPress(_ point: Fraction, seconds: Double) throws {
        try record("longPress \(point.x),\(point.y) \(seconds)s")
    }

    func drag(from: Fraction, to: Fraction, pressSeconds: Double, seconds: Double) throws {
        try record("drag \(from.x),\(from.y) -> \(to.x),\(to.y) press \(pressSeconds)s move \(seconds)s")
    }

    func screenshot() throws -> Data {
        if let failure { throw DeviceError(failure) }
        return png
    }

    var nodes: [SnapshotNode] = []
    var snapshotError: Error?

    func snapshot(bundleId: String?) throws -> [SnapshotNode] {
        if let snapshotError { throw snapshotError }
        try record("snapshot \(bundleId ?? "-")")
        return nodes
    }

    func typeText(_ text: String) throws { try record("type \(text)") }
    func keyboardReturn() throws { try record("keyboardReturn") }
    func keyboardDelete() throws { try record("keyboardDelete") }
    func button(_ name: String) throws { try record("button \(name)") }
}
