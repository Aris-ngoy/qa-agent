import Foundation

public struct CommandError: Error, CustomStringConvertible {
    public let description: String
}

/// Run a command and return its stdout, or throw with its stderr.
public func run(_ executable: String, _ arguments: [String]) throws -> Data {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    let stdout = Pipe()
    let stderr = Pipe()
    process.standardOutput = stdout
    process.standardError = stderr
    process.standardInput = FileHandle.nullDevice
    try process.run()
    // Drain stderr alongside stdout, so a chatty command can't fill one pipe and block.
    var err = Data()
    let drained = DispatchGroup()
    drained.enter()
    DispatchQueue.global().async {
        err = stderr.fileHandleForReading.readDataToEndOfFile()
        drained.leave()
    }
    let out = stdout.fileHandleForReading.readDataToEndOfFile()
    drained.wait()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
        let detail = String(decoding: err, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        throw CommandError(description: "\((executable as NSString).lastPathComponent) \(arguments.first ?? ""): \(detail.isEmpty ? "exit \(process.terminationStatus)" : detail)")
    }
    return out
}
