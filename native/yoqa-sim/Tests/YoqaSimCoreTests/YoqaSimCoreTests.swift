import CoreGraphics
import XCTest
@testable import YoqaSimCore

final class ArgumentsTests: XCTestCase {
    func testIosWithId() throws {
        XCTAssertEqual(
            try Arguments.parse(["ios", "--id", "B750"]),
            Arguments(udid: "B750", deviceSet: nil)
        )
    }

    func testDeviceSet() throws {
        XCTAssertEqual(
            try Arguments.parse(["ios", "--id", "B750", "--device-set", "/tmp/radon set"]),
            Arguments(udid: "B750", deviceSet: "/tmp/radon set")
        )
    }

    func testRejectsAnythingElse() {
        XCTAssertThrowsError(try Arguments.parse([]))
        XCTAssertThrowsError(try Arguments.parse(["android", "--id", "x"]))
        XCTAssertThrowsError(try Arguments.parse(["ios"]))
        XCTAssertThrowsError(try Arguments.parse(["ios", "--id"]))
        XCTAssertThrowsError(try Arguments.parse(["ios", "--id", "x", "--nope"]))
    }
}

final class SimulatorKitTests: XCTestCase {
    private func resolve(_ developerDir: String, existing: Set<String>) -> String? {
        SimulatorKit.resolve(developerDir: developerDir, exists: { existing.contains($0) })
    }

    func testXcode27LayoutInSharedFrameworks() {
        XCTAssertEqual(
            resolve(
                "/Applications/Xcode.app/Contents/Developer",
                existing: ["/Applications/Xcode.app/Contents/SharedFrameworks/SimulatorKit.framework"]
            ),
            "/Applications/Xcode.app/Contents/SharedFrameworks/SimulatorKit.framework"
        )
    }

    func testOlderLayoutInPrivateFrameworks() {
        XCTAssertEqual(
            resolve(
                "/Applications/Xcode-16.app/Contents/Developer",
                existing: ["/Applications/Xcode-16.app/Contents/Developer/Library/PrivateFrameworks/SimulatorKit.framework"]
            ),
            "/Applications/Xcode-16.app/Contents/Developer/Library/PrivateFrameworks/SimulatorKit.framework"
        )
    }

    func testNeitherLayout() {
        XCTAssertNil(resolve("/Library/Developer/CommandLineTools", existing: []))
    }
}

/// A simulator that records the touches it is sent.
final class FakeDevice: TouchDevice {
    var touches: [TouchStep] = []
    var fail: Error?
    var failOn: TouchStep.Phase?
    let pixelSize = CGSize(width: 1206, height: 2622)
    let pointScale = 3.0

    func send(_ step: TouchStep) throws {
        if let fail, failOn == nil || failOn == step.phase { throw fail }
        touches.append(TouchStep(phase: step.phase, x: step.x, y: step.y, edge: step.edge, delayMs: 0))
    }
}

final class RoutingTests: XCTestCase {
    private let status = Status(udid: "B750", simulatorKit: "/X/SimulatorKit.framework")
    private let device = FakeDevice()
    private lazy var controller = Controller(status: status, device: device, frames: FrameStore(source: ShadeSource()), sleep: { _ in })

    private func respond(_ raw: String) -> Response {
        controller.handle(HTTPRequest.parse(Data(raw.utf8)))
    }

    private func post(_ path: String, _ json: String) -> Response {
        respond("POST \(path) HTTP/1.1\r\nContent-Length: \(json.utf8.count)\r\n\r\n\(json)")
    }

    private func json(_ response: Response) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: response.body)) as? [String: Any] ?? [:]
    }

    func testTapSendsDownThenUp() {
        let response = post("/tap", #"{"x":0.25,"y":0.5}"#)
        XCTAssertEqual(response.status, 200)
        XCTAssertEqual(device.touches.map(\.phase), [.down, .up])
        XCTAssertEqual(device.touches.first.map { [$0.x, $0.y] }, [0.25, 0.5])
    }

    func testBadTapIs400AndSendsNothing() {
        XCTAssertEqual(post("/tap", #"{"x":"left"}"#).status, 400)
        XCTAssertEqual(post("/tap", "not json").status, 400)
        XCTAssertEqual(device.touches, [])
    }

    func testSwipe() {
        XCTAssertEqual(post("/swipe", #"{"fromX":0.5,"fromY":0.9,"toX":0.5,"toY":0.1,"durationMs":100}"#).status, 200)
        XCTAssertEqual(device.touches.first?.phase, .down)
        XCTAssertEqual(device.touches.last?.phase, .up)
        XCTAssertEqual(device.touches.last.map { [$0.x, $0.y] }, [0.5, 0.1])
    }

    func testHomeKeyAndUnsupportedKeys() {
        XCTAssertEqual(post("/key", #"{"key":"home"}"#).status, 200)
        XCTAssertTrue(device.touches.allSatisfy { $0.edge == .bottom })
        let volume = post("/key", #"{"key":"volume-up"}"#)
        XCTAssertEqual(volume.status, 400)
        XCTAssertEqual(json(volume)["error"] as? String, "unsupported key volume-up")
    }

    func testAFailedTouchIs500WithTheReason() {
        struct Gone: Error, CustomStringConvertible { var description: String { "simulator shut down" } }
        device.fail = Gone()
        let response = post("/tap", #"{"x":0.5,"y":0.5}"#)
        XCTAssertEqual(response.status, 500)
        XCTAssertEqual(json(response)["error"] as? String, "simulator shut down")
    }

    func testAGestureThatFailsAfterDownStillLiftsTheFinger() {
        struct Dropped: Error {}
        device.fail = Dropped()
        device.failOn = .move
        XCTAssertEqual(post("/swipe", #"{"fromX":0.1,"fromY":0.1,"toX":0.9,"toY":0.9}"#).status, 500)
        XCTAssertEqual(device.touches.map(\.phase), [.down, .up])
        XCTAssertEqual(device.touches.last.map { [$0.x, $0.y] }, [0.1, 0.1])
    }

    func testScreenshotCarriesTheFrameHash() {
        let response = respond("GET /screenshot?scale=1&format=png HTTP/1.1\r\n\r\n")
        XCTAssertEqual(response.status, 200)
        XCTAssertEqual(response.contentType, "image/png")
        XCTAssertNotNil(response.headers["X-Frame-Hash"])
        XCTAssertNotNil(response.headers["X-Frame-Seq"])
        XCTAssertEqual(respond("GET /screenshot HTTP/1.1\r\n\r\n").contentType, "image/jpeg")
        XCTAssertEqual(respond("GET /screenshot?format=gif HTTP/1.1\r\n\r\n").status, 400)
    }

    func testDisplay() {
        let body = json(respond("GET /display HTTP/1.1\r\n\r\n"))
        XCTAssertEqual(body["width"] as? Int, 1206)
        XCTAssertEqual(body["height"] as? Int, 2622)
        XCTAssertEqual(body["scale"] as? Double, 3)
        XCTAssertEqual(body["orientation"] as? String, "portrait")
    }

    func testStatus() {
        let body = json(respond("GET /status HTTP/1.1\r\n\r\n"))
        XCTAssertEqual(body["udid"] as? String, "B750")
    }

    func testUnknownIs404AndGarbageIs400() {
        XCTAssertEqual(respond("GET /nope HTTP/1.1\r\n\r\n").status, 404)
        XCTAssertEqual(respond("garbage").status, 400)
    }

    func testSerializedResponse() {
        let wire = String(decoding: Response(status: 200, contentType: "image/png", body: Data([65]), headers: ["X-Frame-Hash": "ab"]).serialized(), as: UTF8.self)
        XCTAssertEqual(wire, "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 1\r\nX-Frame-Hash: ab\r\nConnection: close\r\n\r\nA")
    }
}
