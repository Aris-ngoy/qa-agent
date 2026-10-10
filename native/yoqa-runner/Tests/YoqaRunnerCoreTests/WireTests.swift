import XCTest
import YoqaRunnerCore

/// The runner at its wire protocol: one POST per command, `{ "command", "commandId" }` in,
/// `{ "ok": true, "data" }` or `{ "ok": false, "error": { "code", "message" } }` out.
final class WireTests: XCTestCase {
    private var server: HTTPServer!

    override func setUpWithError() throws {
        server = try HTTPServer(port: 0)
        server.serve(Session(device: FakeDevice()).handle)
    }

    func testStatusAnswersReady() throws {
        let (status, body) = try post(["command": "status", "commandId": "c1"])
        XCTAssertEqual(status, 200)
        XCTAssertEqual(body["ok"] as? Bool, true)
        let data = try XCTUnwrap(body["data"] as? [String: Any])
        XCTAssertEqual(data["state"] as? String, "ready")
    }

    func testAnUnknownCommandIsAnError() throws {
        let (status, body) = try post(["command": "levitate", "commandId": "c2"])
        XCTAssertEqual(status, 400)
        XCTAssertEqual(body["ok"] as? Bool, false)
        let error = try XCTUnwrap(body["error"] as? [String: Any])
        XCTAssertEqual(error["code"] as? String, "UNKNOWN_COMMAND")
        XCTAssertTrue((error["message"] as? String ?? "").contains("levitate"))
    }

    func testABodyWithoutACommandIsABadRequest() throws {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(server.port)/")!)
        request.httpMethod = "POST"
        request.httpBody = Data("not json".utf8)
        let (status, body) = try send(request)
        XCTAssertEqual(status, 400)
        XCTAssertEqual((body["error"] as? [String: Any])?["code"] as? String, "BAD_REQUEST")
    }

    func testOnlyPostIsACommand() throws {
        let (status, body) = try send(URLRequest(url: URL(string: "http://127.0.0.1:\(server.port)/")!))
        XCTAssertEqual(status, 405)
        XCTAssertEqual((body["error"] as? [String: Any])?["code"] as? String, "BAD_REQUEST")
    }


    private func post(_ object: [String: Any], path: String = "/") throws -> (Int, [String: Any]) {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(server.port)\(path)")!)
        request.httpMethod = "POST"
        request.httpBody = try JSONSerialization.data(withJSONObject: object)
        return try send(request)
    }

    private func send(_ request: URLRequest) throws -> (Int, [String: Any]) {
        var result: (Data?, URLResponse?, Error?)
        let done = expectation(description: "response")
        URLSession.shared.dataTask(with: request) { result = ($0, $1, $2); done.fulfill() }.resume()
        wait(for: [done], timeout: 5)
        if let error = result.2 { throw error }
        let status = (result.1 as? HTTPURLResponse)?.statusCode ?? 0
        let json = try JSONSerialization.jsonObject(with: result.0 ?? Data()) as? [String: Any]
        return (status, json ?? [:])
    }
}
