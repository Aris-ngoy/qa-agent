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

    func testASnapshotOfTheTargetAppSaysSo() throws {
        let data = try ok(["command": "snapshot", "commandId": "n5", "bundleId": "com.example.app"])
        let source = try XCTUnwrap(data["source"] as? [String: String])
        XCTAssertEqual(source, ["kind": "target", "bundleId": "com.example.app"])
    }

    func testASnapshotOfSpringBoardSaysItIsTheSystems() throws {
        let data = try ok(["command": "snapshot", "commandId": "n6"])
        let source = try XCTUnwrap(data["source"] as? [String: String])
        XCTAssertEqual(source, ["kind": "system"])
    }

    func testWithoutATargetTheFirstCandidateInTheForegroundIsReadAsForeground() throws {
        device.foreground = ["com.example.b", "com.example.c"]
        let data = try ok([
            "command": "snapshot", "commandId": "f1",
            "candidates": ["com.example.a", "com.example.b", "com.example.c"],
        ])
        let source = try XCTUnwrap(data["source"] as? [String: String])
        XCTAssertEqual(source, ["kind": "foreground", "bundleId": "com.example.b"])
        XCTAssertEqual(device.calls, ["foreground? com.example.a", "foreground? com.example.b", "snapshot com.example.b"])
    }

    func testNoCandidateInTheForegroundReadsSpringBoardAsTheSystems() throws {
        let data = try ok(["command": "snapshot", "commandId": "f2", "candidates": ["com.example.a", "com.example.b"]])
        let source = try XCTUnwrap(data["source"] as? [String: String])
        XCTAssertEqual(source, ["kind": "system"])
        XCTAssertEqual(device.calls, ["foreground? com.example.a", "foreground? com.example.b", "snapshot -"])
    }

    func testABundleIdWinsOverCandidates() throws {
        device.foreground = ["com.example.other"]
        let data = try ok([
            "command": "snapshot", "commandId": "f3", "bundleId": "com.example.app", "candidates": ["com.example.other"],
        ])
        let source = try XCTUnwrap(data["source"] as? [String: String])
        XCTAssertEqual(source, ["kind": "target", "bundleId": "com.example.app"])
        XCTAssertEqual(device.calls, ["snapshot com.example.app"])
    }

    func testACandidateThatLeavesTheForegroundBeforeItIsReadGivesSpringBoard() throws {
        device.foreground = ["com.example.a"]
        device.backgroundedBundleIds = ["com.example.a"]
        let data = try ok(["command": "snapshot", "commandId": "f4", "candidates": ["com.example.a"]])
        let source = try XCTUnwrap(data["source"] as? [String: String])
        XCTAssertEqual(source, ["kind": "system"])
        XCTAssertEqual(device.calls, ["foreground? com.example.a", "snapshot -"])
    }

    func testASnapshotNeverLaunchesOrActivatesAnApp() throws {
        // The fake records every call that reaches the phone: a read only asks for states and
        // reads one tree. No gesture, button or launch goes out, with or without a match.
        _ = try ok(["command": "snapshot", "commandId": "f5", "candidates": ["com.example.a"]])
        device.foreground = ["com.example.a"]
        _ = try ok(["command": "snapshot", "commandId": "f6", "candidates": ["com.example.a"]])
        XCTAssertEqual(device.calls, [
            "foreground? com.example.a", "snapshot -",
            "foreground? com.example.a", "snapshot com.example.a",
        ])
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

    func testWorkThatMissedTheDeadlineNeverRunsLate() {
        let stuck = DispatchQueue(label: "late")
        let block = DispatchSemaphore(value: 0)
        stuck.async { block.wait() }
        let gate = MainThreadGate(queue: stuck, timeout: 0.1)
        var ran = false
        XCTAssertThrowsError(try gate.run { ran = true }) { XCTAssertTrue($0 is RunnerWedged) }
        block.signal()
        stuck.sync {}
        XCTAssertFalse(ran)
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
