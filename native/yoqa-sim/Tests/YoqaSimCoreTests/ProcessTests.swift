import XCTest

/// The binary at its wire protocol: the startup line, loopback only, the control API on a
/// booted simulator, and the stdin lifeline. Tests that need a simulator skip without one.
final class ProcessTests: XCTestCase {
    private var binary: URL {
        Bundle(for: ProcessTests.self).bundleURL.deletingLastPathComponent().appendingPathComponent("yoqa-sim")
    }

    func testAnUnknownSimulatorExitsNonZeroBeforeApiReady() throws {
        let (process, stdout, stderr) = try launch(["ios", "--id", "00000000-0000-0000-0000-000000000000"])
        process.waitUntilExit()
        XCTAssertNotEqual(process.terminationStatus, 0)
        XCTAssertEqual(stdout.fileHandleForReading.readDataToEndOfFile(), Data())
        XCTAssertTrue(String(decoding: stderr.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self).contains("not found"))
    }

    func testBadArgumentsExitNonZeroWithoutApiReady() throws {
        let (process, stdout, _) = try launch(["ios"])
        process.waitUntilExit()
        XCTAssertNotEqual(process.terminationStatus, 0)
        XCTAssertEqual(stdout.fileHandleForReading.readDataToEndOfFile(), Data())
    }

    func testServesABootedSimulatorAndExitsWhenStdinCloses() throws {
        guard let udid = bootedSimulator() else { throw XCTSkip("no booted iOS simulator") }
        let stdin = Pipe()
        let (process, stdout, _) = try launch(["ios", "--id", udid], stdin: stdin)
        defer { if process.isRunning { process.terminate() } }

        let line = try XCTUnwrap(readLine(stdout.fileHandleForReading))
        XCTAssertNotNil(line.range(of: #"^api_ready http://127\.0\.0\.1:\d+$"#, options: .regularExpression), line)
        let base = String(line.dropFirst("api_ready ".count))
        XCTAssertEqual(readLine(stdout.fileHandleForReading), "stream_ready \(base)/stream.mjpeg")

        let display = try JSONSerialization.jsonObject(with: try fetch("\(base)/display").0) as? [String: Any]
        XCTAssertGreaterThan(display?["width"] as? Int ?? 0, 0)

        let (png, response) = try fetch("\(base)/screenshot?scale=1&format=png")
        XCTAssertEqual(Array(png.prefix(4)), [0x89, 0x50, 0x4E, 0x47])
        let hash = try XCTUnwrap(response.value(forHTTPHeaderField: "X-Frame-Hash"))
        let (_, again) = try fetch("\(base)/screenshot?scale=1&format=png")
        XCTAssertEqual(again.value(forHTTPHeaderField: "X-Frame-Hash"), hash)

        try stdin.fileHandleForWriting.close()
        let deadline = Date().addingTimeInterval(5)
        while process.isRunning && Date() < deadline { usleep(20_000) }
        XCTAssertFalse(process.isRunning, "yoqa-sim must exit when its stdin closes")
    }

    private func launch(_ arguments: [String], stdin: Pipe? = nil) throws -> (Process, Pipe, Pipe) {
        let process = Process()
        process.executableURL = binary
        process.arguments = arguments
        let stdout = Pipe()
        let stderr = Pipe()
        process.standardInput = stdin ?? FileHandle.nullDevice
        process.standardOutput = stdout
        process.standardError = stderr
        try process.run()
        return (process, stdout, stderr)
    }

    private func bootedSimulator() -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
        process.arguments = ["simctl", "list", "devices", "booted", "-j"]
        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        guard (try? process.run()) != nil else { return nil }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        let list = (try? JSONSerialization.jsonObject(with: data)) as? [String: [String: [[String: Any]]]]
        return list?["devices"]?.filter { $0.key.contains("iOS") }.values.flatMap { $0 }.first?["udid"] as? String
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

    private func fetch(_ url: String) throws -> (Data, HTTPURLResponse) {
        var result: Result<(Data, HTTPURLResponse), Error>?
        let done = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: URL(string: url)!) { data, response, error in
            if let data, let response = response as? HTTPURLResponse { result = .success((data, response)) } else { result = .failure(error ?? URLError(.unknown)) }
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 10)
        return try XCTUnwrap(result).get()
    }
}
