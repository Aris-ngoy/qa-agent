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
    private func respond(_ request: String, tree: Tree = Tree(nodes: [])) throws -> [String: Any] {
        let reply = Handler(describe: { tree }).respond(to: Data(request.utf8))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: reply) as? [String: Any])
    }

    func testPingAnswersOkWithTheRequestId() throws {
        let reply = try respond(#"{"id":7,"method":"ping"}"#)
        XCTAssertEqual(reply["id"] as? Int, 7)
        XCTAssertEqual(reply["result"] as? String, "ok")
        XCTAssertNil(reply["error"])
    }

    func testAnUnknownMethodIsAnErrorNotACrash() throws {
        let reply = try respond(#"{"id":8,"method":"shake"}"#)
        XCTAssertEqual(reply["id"] as? Int, 8)
        XCTAssertEqual(reply["error"] as? String, "unknown method shake")
    }

    func testDescribeAnswersTheFlatNodes() throws {
        let button = AXNode(
            role: "Button", label: "General", value: nil, id: "com.apple.settings.general",
            frame: Rect(x: 0.25, y: 0.5, width: 0.5, height: 0.0625), enabled: true
        )
        let reply = try respond(#"{"id":9,"method":"describe"}"#, tree: Tree(nodes: [button]))
        let result = try XCTUnwrap(reply["result"] as? [String: Any])
        XCTAssertEqual(result["degraded"] as? Bool, false)
        let nodes = try XCTUnwrap(result["nodes"] as? [[String: Any]])
        XCTAssertEqual(nodes.count, 1)
        XCTAssertEqual(nodes[0]["role"] as? String, "Button")
        XCTAssertEqual(nodes[0]["label"] as? String, "General")
        XCTAssertNil(nodes[0]["value"])
        XCTAssertEqual(nodes[0]["id"] as? String, "com.apple.settings.general")
        XCTAssertEqual(nodes[0]["enabled"] as? Bool, true)
        let frame = try XCTUnwrap(nodes[0]["frame"] as? [String: Double])
        XCTAssertEqual(frame, ["x": 0.25, "y": 0.5, "width": 0.5, "height": 0.0625])
    }

    func testAnEmptyTreeIsAValidReplyMarkedDegraded() throws {
        let reply = try respond(#"{"id":10,"method":"describe"}"#, tree: Tree(nodes: []))
        XCTAssertNil(reply["error"])
        let result = try XCTUnwrap(reply["result"] as? [String: Any])
        XCTAssertEqual((result["nodes"] as? [Any])?.count, 0)
        XCTAssertEqual(result["degraded"] as? Bool, true)
    }

    func testARequestThatIsNotJsonIsAnError() throws {
        let reply = try respond("nope")
        XCTAssertNotNil(reply["error"] as? String)
    }
}

final class TreeTests: XCTestCase {
    private let screen = Rect(x: 0, y: 0, width: 400, height: 800)

    private func element(
        _ label: String?, traits: UInt64, frame: Rect = Rect(x: 100, y: 200, width: 200, height: 50),
        value: String? = nil, identifier: String? = nil
    ) -> RawElement {
        RawElement(label: label, value: value, identifier: identifier, traits: traits, frame: frame)
    }

    func testFramesBecomeFractionsOfTheScreen() {
        let tree = Tree(screen: screen, elements: [
            element("General", traits: 1 | 64 | 1 << 33, identifier: "com.apple.settings.general"),
        ])
        XCTAssertEqual(tree.nodes, [
            AXNode(
                role: "Button", label: "General", value: nil, id: "com.apple.settings.general",
                frame: Rect(x: 0.25, y: 0.25, width: 0.5, height: 0.0625), enabled: true
            ),
        ])
    }

    func testRolesComeFromTheTraits() {
        let roles = Tree(screen: screen, elements: [
            element("Search", traits: 1 << 10 | 1 << 18),
            element("Name", traits: 1 << 18),
            element("Settings", traits: 1 << 16),
            element("Learn more", traits: 1 << 1),
            element("Volume", traits: 1 << 12),
            element("Photo", traits: 1 << 2),
            element("Version 26.5", traits: 1 << 6),
            element("Card", traits: 0),
        ]).nodes.map(\.role)
        XCTAssertEqual(roles, ["SearchField", "TextField", "Heading", "Link", "Slider", "Image", "StaticText", "Other"])
    }

    func testANotEnabledElementIsDisabled() {
        let tree = Tree(screen: screen, elements: [element("Continue", traits: 1 | 1 << 8)])
        XCTAssertEqual(tree.nodes.first?.enabled, false)
    }

    func testEmptyTextIsLeftOutAndZeroSizedElementsAreDropped() {
        let tree = Tree(screen: screen, elements: [
            element("", traits: 1 << 6, value: "SSID, 3 of 3 Wi-Fi bars", identifier: ""),
            element("Hidden", traits: 1, frame: Rect(x: 10, y: 10, width: 0, height: 20)),
        ])
        XCTAssertEqual(tree.nodes.count, 1)
        XCTAssertNil(tree.nodes[0].label)
        XCTAssertEqual(tree.nodes[0].value, "SSID, 3 of 3 Wi-Fi bars")
        XCTAssertNil(tree.nodes[0].id)
    }

    func testAnUnknownScreenSizeGivesADegradedTree() {
        let tree = Tree(screen: Rect(x: 0, y: 0, width: 0, height: 0), elements: [element("General", traits: 1)])
        XCTAssertEqual(tree.nodes, [])
        XCTAssertTrue(tree.degraded)
    }
}
