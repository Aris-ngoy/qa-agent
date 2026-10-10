import XCTest

/// The runner. Started with `xcodebuild test-without-building`, it serves commands on
/// 127.0.0.1 until its server stops. `YOQA_RUNNER_PORT` reaches it as
/// `TEST_RUNNER_YOQA_RUNNER_PORT` on the `xcodebuild` side.
final class RunnerTests: XCTestCase {
    /// Not `testRun`: that name is XCTest's own `testRun` property, and the test never runs.
    func testServe() throws {
        let server = try startRunner { line in
            print(line)
            fflush(stdout)
        }
        while server.isListening {
            _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(1))
        }
    }
}
