import XCTest
@testable import YoqaAxCore

final class ArgumentsTests: XCTestCase {
    func testParsesTheSocketPath() throws {
        XCTAssertEqual(try Arguments.parse(["--connect", "/tmp/yoqa-ax-b75001fb.sock"]).socketPath, "/tmp/yoqa-ax-b75001fb.sock")
    }

    func testRejectsMissingOrUnknownOptions() {
        XCTAssertThrowsError(try Arguments.parse([]))
        XCTAssertThrowsError(try Arguments.parse(["--connect"]))
        XCTAssertThrowsError(try Arguments.parse(["--listen", "/tmp/x.sock"]))
    }
}

final class FramingTests: XCTestCase {
    func testAFrameIsABigEndianLengthThenTheBody() {
        XCTAssertEqual(Array(Framing.encode(Data("{}".utf8))), [0, 0, 0, 2, 0x7B, 0x7D])
    }

    func testReadsFramesSplitAcrossChunksAndLeavesTheRest() throws {
        var reader = FrameReader()
        let wire = Framing.encode(Data("{\"id\":1}".utf8)) + Framing.encode(Data("{\"id\":2}".utf8))
        XCTAssertEqual(try reader.feed(wire.prefix(3)), [])
        XCTAssertEqual(try reader.feed(wire.dropFirst(3).prefix(10)), [Data("{\"id\":1}".utf8)])
        XCTAssertEqual(try reader.feed(wire.dropFirst(13)), [Data("{\"id\":2}".utf8)])
    }

    func testRefusesAFrameOverTheLimit() {
        var reader = FrameReader()
        XCTAssertThrowsError(try reader.feed(Data([0xFF, 0xFF, 0xFF, 0xFF])))
    }
}

final class HandlerTests: XCTestCase {
    private func respond(_ request: String) throws -> [String: Any] {
        let reply = Handler().respond(to: Data(request.utf8))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: reply) as? [String: Any])
    }

    func testPingAnswersOkWithTheRequestId() throws {
        let reply = try respond(#"{"id":7,"method":"ping"}"#)
        XCTAssertEqual(reply["id"] as? Int, 7)
        XCTAssertEqual(reply["result"] as? String, "ok")
        XCTAssertNil(reply["error"])
    }

    func testAnUnknownMethodIsAnErrorNotACrash() throws {
        let reply = try respond(#"{"id":8,"method":"describe"}"#)
        XCTAssertEqual(reply["id"] as? Int, 8)
        XCTAssertEqual(reply["error"] as? String, "unknown method describe")
    }

    func testARequestThatIsNotJsonIsAnError() throws {
        let reply = try respond("nope")
        XCTAssertNotNil(reply["error"] as? String)
    }
}
