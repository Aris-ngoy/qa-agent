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

final class RoutingTests: XCTestCase {
    private let status = Status(udid: "B750", simulatorKit: "/X/SimulatorKit.framework")

    private func respond(_ raw: String, screenshot: () throws -> Data = { Data([1, 2]) }) -> Response {
        route(HTTPRequest.parse(Data(raw.utf8)), status: status, screenshot: screenshot)
    }

    func testScreenshotIsPng() {
        let response = respond("GET /screenshot HTTP/1.1\r\nHost: x\r\n\r\n")
        XCTAssertEqual(response.status, 200)
        XCTAssertEqual(response.contentType, "image/png")
        XCTAssertEqual(response.body, Data([1, 2]))
    }

    func testScreenshotIgnoresQuery() {
        XCTAssertEqual(respond("GET /screenshot?scale=0.25 HTTP/1.1\r\n\r\n").status, 200)
    }

    func testFailedScreenshotIs500WithTheReason() {
        struct Boom: Error, CustomStringConvertible { var description: String { "simctl: not booted" } }
        let response = respond("GET /screenshot HTTP/1.1\r\n\r\n", screenshot: { throw Boom() })
        XCTAssertEqual(response.status, 500)
        XCTAssertEqual(String(decoding: response.body, as: UTF8.self), "{\"error\":\"simctl: not booted\"}")
    }

    func testStatus() {
        let response = respond("GET /status HTTP/1.1\r\n\r\n")
        XCTAssertEqual(response.status, 200)
        XCTAssertEqual(
            String(decoding: response.body, as: UTF8.self),
            "{\"udid\":\"B750\",\"simulatorKit\":\"\\/X\\/SimulatorKit.framework\"}"
        )
    }

    func testUnknownIs404AndGarbageIs400() {
        XCTAssertEqual(respond("GET /nope HTTP/1.1\r\n\r\n").status, 404)
        XCTAssertEqual(respond("POST /screenshot HTTP/1.1\r\n\r\n").status, 404)
        XCTAssertEqual(respond("garbage").status, 400)
    }

    func testSerializedResponse() {
        let wire = String(decoding: Response(status: 200, contentType: "image/png", body: Data([65])).serialized(), as: UTF8.self)
        XCTAssertEqual(wire, "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 1\r\nConnection: close\r\n\r\nA")
    }
}
