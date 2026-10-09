import XCTest

/// The binary at its wire protocol: the startup line, loopback only, and the stdin lifeline.
final class ProcessTests: XCTestCase {
    private var binary: URL {
        Bundle(for: ProcessTests.self).bundleURL.deletingLastPathComponent().appendingPathComponent("yoqa-sim")
    }

    func testAnnouncesApiReadyOnLoopbackAndExitsWhenStdinCloses() throws {
        let process = Process()
        process.executableURL = binary
        process.arguments = ["ios", "--id", "00000000-0000-0000-0000-000000000000"]
        let stdin = Pipe()
        let stdout = Pipe()
        process.standardInput = stdin
        process.standardOutput = stdout
        process.standardError = Pipe()
        try process.run()

        let line = try XCTUnwrap(readLine(stdout.fileHandleForReading))
        XCTAssertTrue(
            line.range(of: #"^api_ready http://127\.0\.0\.1:\d+$"#, options: .regularExpression) != nil,
            line
        )

        let url = try XCTUnwrap(URL(string: String(line.dropFirst("api_ready ".count)) + "/status"))
        let (body, response) = try fetch(url)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        XCTAssertTrue(String(decoding: body, as: UTF8.self).contains("\"udid\":\"00000000-0000-0000-0000-000000000000\""))

        try stdin.fileHandleForWriting.close()
        let deadline = Date().addingTimeInterval(5)
        while process.isRunning && Date() < deadline { usleep(20_000) }
        XCTAssertFalse(process.isRunning, "yoqa-sim must exit when its stdin closes")
        if process.isRunning { process.terminate() }
    }

    func testBadArgumentsExitNonZeroWithoutApiReady() throws {
        let process = Process()
        process.executableURL = binary
        process.arguments = ["ios"]
        let stdout = Pipe()
        process.standardOutput = stdout
        process.standardError = Pipe()
        try process.run()
        process.waitUntilExit()
        XCTAssertNotEqual(process.terminationStatus, 0)
        XCTAssertEqual(stdout.fileHandleForReading.readDataToEndOfFile(), Data())
    }

    private func readLine(_ handle: FileHandle) -> String? {
        var buffer = Data()
        while true {
            let byte = handle.readData(ofLength: 1)
            if byte.isEmpty { return buffer.isEmpty ? nil : String(decoding: buffer, as: UTF8.self) }
            if byte == Data("\n".utf8) { return String(decoding: buffer, as: UTF8.self) }
            buffer.append(byte)
        }
    }

    private func fetch(_ url: URL) throws -> (Data, URLResponse) {
        var result: Result<(Data, URLResponse), Error>?
        let done = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: url) { data, response, error in
            if let data, let response { result = .success((data, response)) } else { result = .failure(error ?? URLError(.unknown)) }
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 5)
        return try XCTUnwrap(result).get()
    }
}
