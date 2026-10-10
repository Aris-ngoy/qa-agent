import XCTest
@testable import YoqaSimCore

/// backboardd log lines (compact style), trimmed, from an iPhone 17 Pro simulator on iOS 26.5.
private enum Line {
    static func at(_ time: String, pid: Int = 11763, _ message: String) -> String {
        "2026-10-10 \(time) Df backboardd[\(pid):10d71] \(message)"
    }

    static let purpleMain = "<SimHIDVirtualService: 0x103c5e2e0: identifier: 0xacefade00000007 com.apple.SimulatorHID.ScreenTouchService.PurpleMain, state: disconnected, hidCallbackDelegate: <SimHIDVirt"
    static func legacy(_ event: String) -> String {
        "[com.apple.iohid:default] Service \(event): IOHIDService name: id:0xacefade00000007 primaryUsagePage:0xd primaryUsage:0x4 transport: locationID:(null) reportInterval:0"
    }

    static let bootAdded = at("08:23:49.973", legacy("added"))
    static let bootConnected = at("08:23:49.973", "(SimulatorHID) Connecting service: \(purpleMain)")
    static let dtuhiddActive = at("08:23:53.293", "(SimulatorHID) SimHIDVirtualServiceManager: dtuhidd state changed to active")
    static let disconnecting = at("08:23:53.293", "(SimulatorHID) Disconnecting service: \(purpleMain)")
    static let bootRemoved = at("08:23:53.293", legacy("removed"))
    static let coreDeviceAdded = at("08:23:53.586", "[com.apple.iohid:default] Service added: IOHIDService name: id:0x10a4c16000003 primaryUsagePage:0xd primaryUsage:0x4 transport:CoreDevice locationID:(null)")
    static let coreDeviceRemoved = at("08:38:56.266", "[com.apple.iohid:default] Service removed: IOHIDService name: id:0x103f99e00000c primaryUsagePage:0xd primaryUsage:0x4 transport:CoreDevice locationID:(null)")
    static let revival = at("08:31:51.199", "(SimulatorHID) SimHIDVirtualServiceManager: Connecting dtuhidd-suppressed service due to IndigoHID event: \(purpleMain)")
    static let revivedAdded = at("08:31:51.200", legacy("added"))
    static let revivedRemoved = at("08:31:51.200", legacy("removed"))
    static let revivedConnected = at("08:31:51.200", "(SimulatorHID) Connecting service: \(purpleMain)")
}

final class TouchscreenLogTests: XCTestCase {
    private func state(after lines: [String]) -> TouchscreenState {
        var log = TouchscreenLog()
        lines.forEach { log.consume($0) }
        return log.state
    }

    func testNothingLoggedIsUnknown() {
        XCTAssertEqual(state(after: []), .unknown)
        XCTAssertEqual(state(after: ["2026-10-10 08:23:49.000 Df SpringBoard[1:2] unrelated"]), .unknown)
    }

    func testDtuhiddSuppressesTheLegacyTouchscreenAtBoot() {
        XCTAssertEqual(state(after: [Line.bootAdded, Line.bootConnected]), .attached)
        XCTAssertEqual(state(after: [Line.bootAdded, Line.bootConnected, Line.dtuhiddActive, Line.disconnecting, Line.bootRemoved]), .suppressed)
        // dtuhidd can win before the legacy touchscreen ever attached.
        XCTAssertEqual(state(after: [Line.dtuhiddActive]), .suppressed)
    }

    /// dtuhidd's state can flip again (notifyutil, a dtuhidd restart) without backboardd
    /// disconnecting an attached touchscreen; only a disconnect suppresses it.
    func testDtuhiddGoingActiveAgainLeavesAnAttachedTouchscreenAttached() {
        let attached = [Line.dtuhiddActive, Line.revival, Line.revivedAdded, Line.revivedConnected]
        XCTAssertEqual(state(after: attached + [Line.dtuhiddActive]), .attached)
        XCTAssertEqual(state(after: attached + [Line.dtuhiddActive, Line.revivedRemoved]), .dropped)
    }

    func testAnIndigoEventRevivesIt() {
        XCTAssertEqual(state(after: [Line.dtuhiddActive, Line.revival]), .reviving)
        XCTAssertEqual(state(after: [Line.dtuhiddActive, Line.revival, Line.revivedAdded, Line.revivedConnected]), .attached)
    }

    /// The broken boot: the revived service is removed again at once, and SimulatorHID
    /// still records it as connected, so it is never revived again.
    func testARemovalSimulatorHIDDidNotAskForIsADrop() {
        let broken = [
            Line.bootAdded, Line.bootConnected, Line.dtuhiddActive, Line.disconnecting, Line.bootRemoved,
            Line.coreDeviceAdded, Line.revival, Line.revivedAdded, Line.revivedRemoved, Line.revivedConnected,
        ]
        XCTAssertEqual(state(after: broken), .dropped)
        XCTAssertEqual(state(after: broken + [Line.coreDeviceRemoved]), .dropped, "CoreDevice digitizers are not the legacy one")
    }

    func testANewBackboarddStartsOver() {
        let broken = [Line.dtuhiddActive, Line.revival, Line.revivedAdded, Line.revivedRemoved]
        XCTAssertEqual(state(after: broken + [Line.at("08:40:47.245", pid: 22491, "(SimulatorHID) SimHIDVirtualServiceManager: dtuhidd state changed to active")]), .suppressed)
    }
}

final class TouchscreenWatchTests: XCTestCase {
    func testSettleReturnsOnceARevivalHasAnOutcome() {
        let watch = TouchscreenWatch()
        watch.feed(Line.dtuhiddActive)
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.05) {
            [Line.revival, Line.revivedAdded, Line.revivedRemoved].forEach(watch.feed)
        }
        XCTAssertEqual(watch.settled(timeout: 2), .dropped)
    }

    /// A revival that logs nothing can't be judged; later gestures don't wait for it again.
    func testARevivalThatLogsNothingIsUnknownAfterTheTimeout() {
        let watch = TouchscreenWatch()
        watch.feed(Line.dtuhiddActive)
        let started = Date()
        XCTAssertEqual(watch.settled(timeout: 0.05), .unknown)
        XCTAssertLessThan(Date().timeIntervalSince(started), 1)
        XCTAssertEqual(watch.state, .unknown)
        // A later drop is still seen.
        [Line.revival, Line.revivedAdded, Line.revivedRemoved].forEach(watch.feed)
        XCTAssertEqual(watch.state, .dropped)
    }
}

final class BootTimeTests: XCTestCase {
    func testLaunchdSimStartFromPs() {
        let ps = """
          11711 Sat Oct 10 08:23:47 2026     launchd_sim /Users/a/Library/Developer/CoreSimulator/Devices/0000-OTHER/data/var/run/launchd_bootstrap.plist
          22467 Sat Oct 10 08:40:45 2026     launchd_sim /Users/a/Library/Developer/CoreSimulator/Devices/B75001FB-B91D-4F94-80A7-3E371A641D27/data/var/run/launchd_bootstrap.plist
          22491 Sat Oct 10 08:40:46 2026     /Library/Developer/CoreSimulator/.../backboardd
        """
        XCTAssertEqual(SimulatorBoot.logStart(udid: "B75001FB-B91D-4F94-80A7-3E371A641D27", ps: ps), "2026-10-10 08:40:45")
        XCTAssertNil(SimulatorBoot.logStart(udid: "NOT-BOOTED", ps: ps))
    }
}

/// A touchscreen whose state the test sets.
final class FakeTouchscreen: TouchscreenHealth {
    var state: TouchscreenState = .unknown
    /// What a gesture's revival turns into.
    var afterGesture: TouchscreenState?
    var settleCalls = 0

    func settled(timeout: TimeInterval) -> TouchscreenState {
        settleCalls += 1
        if let afterGesture { state = afterGesture }
        return state
    }
}

final class DroppedTouchscreenRoutingTests: XCTestCase {
    private let device = FakeDevice()
    private let touchscreen = FakeTouchscreen()
    private lazy var controller = Controller(
        status: Status(udid: "B750", simulatorKit: "/X"), device: device, frames: FrameStore(source: ShadeSource()),
        touchscreen: touchscreen, sleep: { _ in }
    )

    private func post(_ path: String, _ json: String) -> Response {
        controller.handle(HTTPRequest.parse(Data("POST \(path) HTTP/1.1\r\nContent-Length: \(json.utf8.count)\r\n\r\n\(json)".utf8)))
    }

    private func error(_ response: Response) -> String? {
        ((try? JSONSerialization.jsonObject(with: response.body)) as? [String: Any])?["error"] as? String
    }

    func testADroppedTouchscreenRefusesGesturesWithoutSendingThem() {
        touchscreen.state = .dropped
        for (path, body) in [("/tap", #"{"x":0.5,"y":0.5}"#), ("/swipe", #"{"fromX":0,"fromY":0,"toX":1,"toY":1}"#), ("/key", #"{"key":"home"}"#)] {
            let response = post(path, body)
            XCTAssertEqual(response.status, 503, path)
            XCTAssertTrue(error(response)?.contains("reboot the simulator") == true, error(response) ?? "")
        }
        XCTAssertEqual(device.touches, [])
    }

    func testAGestureThatRevivesTheTouchscreenFailsWhenTheRevivalDropsIt() {
        touchscreen.state = .suppressed
        touchscreen.afterGesture = .dropped
        let response = post("/tap", #"{"x":0.5,"y":0.5}"#)
        XCTAssertEqual(response.status, 503)
        XCTAssertEqual(device.touches.map(\.phase), [.down, .up])
    }

    func testAGestureThatRevivesTheTouchscreenSucceedsWhenItAttaches() {
        touchscreen.state = .suppressed
        touchscreen.afterGesture = .attached
        XCTAssertEqual(post("/tap", #"{"x":0.5,"y":0.5}"#).status, 200)
    }

    func testAnAttachedOrUnknownTouchscreenDoesNotWait() {
        for state in [TouchscreenState.attached, .unknown] {
            touchscreen.state = state
            XCTAssertEqual(post("/tap", #"{"x":0.5,"y":0.5}"#).status, 200)
        }
        XCTAssertEqual(touchscreen.settleCalls, 0)
    }

    func testStatusReportsTheTouchscreen() {
        touchscreen.state = .dropped
        let response = controller.handle(HTTPRequest.parse(Data("GET /status HTTP/1.1\r\n\r\n".utf8)))
        let body = (try? JSONSerialization.jsonObject(with: response.body)) as? [String: Any]
        XCTAssertEqual(body?["touchscreen"] as? String, "dropped")
    }
}
