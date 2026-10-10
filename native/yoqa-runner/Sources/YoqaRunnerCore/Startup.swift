import Foundation

public struct StartupError: Error, CustomStringConvertible {
    public let description: String
}

/// Bind 127.0.0.1 on `YOQA_RUNNER_PORT` (a system port when unset), serve a `Session`, and
/// log `YOQA_RUNNER_LISTENING port=N` once listening. The Mac reads that line for the port.
public func startRunner(
    environment: [String: String] = ProcessInfo.processInfo.environment,
    log: (String) -> Void
) throws -> HTTPServer {
    var port: UInt16 = 0
    if let raw = environment["YOQA_RUNNER_PORT"]?.trimmingCharacters(in: .whitespaces), !raw.isEmpty {
        guard let parsed = UInt16(raw) else {
            throw StartupError(description: "YOQA_RUNNER_PORT must be a port number, got \"\(raw)\"")
        }
        port = parsed
    }
    let server = try HTTPServer(port: port)
    server.serve(Session().handle)
    log("YOQA_RUNNER_LISTENING port=\(server.port)")
    return server
}
