import Foundation
import XCTest
@testable import YoqaAxCore

/// The binary at its wire protocol, built for the host: it connects back to the socket it
/// was given, answers `ping`, and exits when the runner closes the connection.
final class ProcessTests: XCTestCase {
    private var binary: URL {
        Bundle(for: ProcessTests.self).bundleURL.deletingLastPathComponent().appendingPathComponent("yoqa-ax")
    }

    func testConnectsBackAnswersPingAndExitsWhenTheRunnerCloses() throws {
        let path = NSTemporaryDirectory() + "yoqa-ax-test-\(UUID().uuidString.prefix(8)).sock"
        let listener = try listen(path)
        defer { close(listener); unlink(path) }

        let process = Process()
        process.executableURL = binary
        process.arguments = ["--connect", path]
        try process.run()
        defer { if process.isRunning { process.terminate() } }

        let connection = accept(listener, nil, nil)
        XCTAssertGreaterThanOrEqual(connection, 0)
        var timeout = timeval(tv_sec: 5, tv_usec: 0)
        setsockopt(connection, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))

        let request = Framing.encode(Data(#"{"id":1,"method":"ping"}"#.utf8))
        _ = request.withUnsafeBytes { write(connection, $0.baseAddress, request.count) }
        var reader = FrameReader()
        var replies: [Data] = []
        var chunk = [UInt8](repeating: 0, count: 256)
        while replies.isEmpty {
            let count = read(connection, &chunk, chunk.count)
            XCTAssertGreaterThan(count, 0, "no reply to ping")
            if count <= 0 { break }
            replies = try reader.feed(Data(chunk[0..<count]))
        }
        let reply = try JSONSerialization.jsonObject(with: try XCTUnwrap(replies.first)) as? [String: Any]
        XCTAssertEqual(reply?["result"] as? String, "ok")

        close(connection)
        let deadline = Date().addingTimeInterval(5)
        while process.isRunning && Date() < deadline { usleep(20_000) }
        XCTAssertFalse(process.isRunning, "yoqa-ax must exit when the runner closes the socket")
    }

    func testExitsNonZeroWhenNobodyListens() throws {
        let process = Process()
        process.executableURL = binary
        process.arguments = ["--connect", NSTemporaryDirectory() + "yoqa-ax-nobody.sock"]
        process.standardError = FileHandle.nullDevice
        try process.run()
        process.waitUntilExit()
        XCTAssertNotEqual(process.terminationStatus, 0)
    }

    private func listen(_ path: String) throws -> Int32 {
        unlink(path)
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        var address = try UnixSocket.address(path)
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        XCTAssertEqual(bound, 0)
        XCTAssertEqual(Darwin.listen(fd, 1), 0)
        return fd
    }
}
