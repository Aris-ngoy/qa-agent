import Foundation
import YoqaAxCore

// The runner binds the socket, then spawns us inside the simulator with `simctl spawn`. We
// connect back, answer requests until the runner closes the socket, then exit, so we never
// outlive the Device Session.

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("yoqa-ax: \(message)\n".utf8))
    exit(2)
}

// A runner that goes away mid-reply must end the loop through `write`'s error, not kill us.
signal(SIGPIPE, SIG_IGN)

let arguments: Arguments
do {
    arguments = try Arguments.parse(Array(CommandLine.arguments.dropFirst()))
} catch {
    fail("\(error)")
}

do {
    let fd = try UnixSocket.connect(arguments.socketPath)
    let reader = AXRuntimeReader()
    try UnixSocket.serve(fd, handler: Handler(describe: reader.read))
    exit(0)
} catch {
    fail("\(error)")
}
