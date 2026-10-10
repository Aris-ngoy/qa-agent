import XCTest
import YoqaRunnerCore

/// The Screen tree, typing and the errors that reach the Mac as their own codes.
final class ObservationTests: XCTestCase {
    private var device: FakeDevice!
    private var session: Session!

    override func setUp() {
        device = FakeDevice()
        session = Session(device: device)
    }

    func testASnapshotListsTheNodesWithFractionFrames() throws {
        device.nodes = [
            SnapshotNode(role: "Button", label: "Allow", id: "allow", frame: (0.1, 0.2, 0.3, 0.05)),
            SnapshotNode(role: "StaticText", value: "Hi", frame: (0, 0, 1, 0.1), enabled: false),
        ]
        let data = try ok(["command": "snapshot", "commandId": "n1", "bundleId": "com.example.app"])
        let nodes = try XCTUnwrap(data["nodes"] as? [[String: Any]])
        XCTAssertEqual(nodes.count, 2)
        XCTAssertEqual(nodes[0]["role"] as? String, "Button")
        XCTAssertEqual(nodes[0]["label"] as? String, "Allow")
        XCTAssertEqual(nodes[0]["id"] as? String, "allow")
        XCTAssertEqual((nodes[0]["frame"] as? [String: Double])?["width"], 0.3)
        XCTAssertEqual(nodes[1]["enabled"] as? Bool, false)
        XCTAssertNil(nodes[1]["label"])
        XCTAssertEqual(device.calls, ["snapshot com.example.app"])
    }

    func testASnapshotWithoutABundleIdReadsSpringBoard() throws {
        _ = try ok(["command": "snapshot", "commandId": "n2"])
        XCTAssertEqual(device.calls, ["snapshot -"])
    }

    func testASnapshotOfABackgroundedAppIsAppBackgrounded() {
        device.snapshotError = AppBackgrounded("com.example.app is not in the foreground")
        let (status, body) = reply(["command": "snapshot", "commandId": "n3", "bundleId": "com.example.app"])
        XCTAssertEqual(status, 409)
        XCTAssertEqual(errorCode(body), "APP_BACKGROUNDED")
    }

    func testAWedgedMainThreadIsRunnerWedged() {
        device.snapshotError = RunnerWedged("the main thread did not answer")
        let (status, body) = reply(["command": "snapshot", "commandId": "n4"])
        XCTAssertEqual(status, 503)
        XCTAssertEqual(errorCode(body), "RUNNER_WEDGED")
    }

    func testTypingKeyboardKeysAndButtonsReachTheDevice() throws {
        _ = try ok(["command": "type", "commandId": "k1", "text": "héllo"])
        _ = try ok(["command": "keyboardReturn", "commandId": "k2"])
        _ = try ok(["command": "keyboardDelete", "commandId": "k3"])
        _ = try ok(["command": "button", "commandId": "k4", "name": "home"])
        XCTAssertEqual(device.calls, ["type héllo", "keyboardReturn", "keyboardDelete", "button home"])
    }

    func testTypingIsJournaled() throws {
        let command: [String: Any] = ["command": "type", "commandId": "k5", "text": "a"]
        _ = try ok(command)
        _ = try ok(command)
        XCTAssertEqual(device.calls, ["type a"])
    }

    func testTypeWithoutTextAndAnUnknownButtonAreBadRequests() {
        XCTAssertEqual(reply(["command": "type", "commandId": "k6"]).0, 400)
        XCTAssertEqual(reply(["command": "button", "commandId": "k7", "name": "power"]).0, 400)
        XCTAssertEqual(device.calls, [])
    }

    func testTheGateReportsAStuckQueueAsWedged() {
        let stuck = DispatchQueue(label: "stuck")
        let block = DispatchSemaphore(value: 0)
        stuck.async { block.wait() }
        defer { block.signal() }
        let gate = MainThreadGate(queue: stuck, timeout: 0.1)
        XCTAssertThrowsError(try gate.run { 1 }) { error in
            XCTAssertTrue(error is RunnerWedged)
        }
    }

    func testTheGateReturnsWhatTheWorkReturnsAndRethrows() throws {
        let gate = MainThreadGate(queue: DispatchQueue(label: "fine"), timeout: 5)
        XCTAssertEqual(try gate.run { 42 }, 42)
        XCTAssertThrowsError(try gate.run { throw DeviceError("boom") }) { error in
            XCTAssertTrue(error is DeviceError)
        }
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
