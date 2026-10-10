import XCTest
import YoqaRunnerCore

/// What the Mac reads to find the runner: `YOQA_RUNNER_LISTENING port=N`, once it is listening.
final class StartupTests: XCTestCase {
    func testWithoutAPortItTakesASystemPortAndLogsIt() throws {
        var lines: [String] = []
        let server = try startRunner(environment: [:]) { lines.append($0) }
        defer { server.stop() }
        XCTAssertGreaterThan(server.port, 0)
        XCTAssertEqual(lines, ["YOQA_RUNNER_LISTENING port=\(server.port)"])
    }

    func testYoqaRunnerPortIsTheOneBound() throws {
        let probe = try HTTPServer(port: 0)
        let port = probe.port
        probe.stop()
        var lines: [String] = []
        let server = try startRunner(environment: ["YOQA_RUNNER_PORT": "\(port)"]) { lines.append($0) }
        defer { server.stop() }
        XCTAssertEqual(server.port, port)
        XCTAssertEqual(lines, ["YOQA_RUNNER_LISTENING port=\(port)"])
    }

    func testAPortThatIsNotANumberIsRefused() {
        XCTAssertThrowsError(try startRunner(environment: ["YOQA_RUNNER_PORT": "eighty"]) { _ in }) {
            XCTAssertTrue("\($0)".contains("YOQA_RUNNER_PORT"))
        }
    }

    func testTheLoggedPortAnswersStatus() throws {
        var lines: [String] = []
        let server = try startRunner(environment: [:]) { lines.append($0) }
        defer { server.stop() }
        let port = try XCTUnwrap(lines.first?.split(separator: "=").last)
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/")!)
        request.httpMethod = "POST"
        request.httpBody = Data(#"{"command":"status","commandId":"s1"}"#.utf8)
        var reply: Data?
        let done = expectation(description: "status")
        URLSession.shared.dataTask(with: request) { data, _, _ in reply = data; done.fulfill() }.resume()
        wait(for: [done], timeout: 5)
        let body = try JSONSerialization.jsonObject(with: try XCTUnwrap(reply)) as? [String: Any]
        XCTAssertEqual(body?["ok"] as? Bool, true)
    }
}
