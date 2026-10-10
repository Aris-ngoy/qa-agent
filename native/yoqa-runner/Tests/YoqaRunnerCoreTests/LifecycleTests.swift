import XCTest
import YoqaRunnerCore

final class LifecycleTests: XCTestCase {
    func testAStoppedServerIsNoLongerListening() throws {
        let server = try HTTPServer(port: 0)
        XCTAssertTrue(server.isListening)
        server.stop()
        server.stop()
        XCTAssertFalse(server.isListening)
    }
}
