import Foundation
import YoqaSimCore

// Resident process for one booted iOS simulator (see docs/plans/device-lanes/device-sim.md).
// Prints `api_ready http://127.0.0.1:<port>` once it serves, then nothing. It exits when
// stdin closes, so it never outlives the runner that spawned it.

// A client that hangs up mid-response must not kill the process.
signal(SIGPIPE, SIG_IGN)

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("yoqa-sim: \(message)\n".utf8))
    exit(2)
}

let arguments: Arguments
do {
    arguments = try Arguments.parse(Array(CommandLine.arguments.dropFirst()))
} catch {
    fail(String(describing: error))
}

let developerDir: String
do {
    developerDir = try SimulatorKit.activeDeveloperDir()
} catch {
    fail("no active Xcode (\(error))")
}
guard let simulatorKit = SimulatorKit.resolve(developerDir: developerDir, exists: { FileManager.default.fileExists(atPath: $0) }) else {
    fail("SimulatorKit.framework not found for the Xcode at \(developerDir)")
}

let server: LoopbackServer
do {
    server = try LoopbackServer()
} catch {
    fail(String(describing: error))
}

let status = Status(udid: arguments.udid, simulatorKit: simulatorKit)
server.serve { request in
    route(request, status: status) {
        try simctlScreenshot(udid: arguments.udid, deviceSet: arguments.deviceSet)
    }
}

FileHandle.standardOutput.write(Data("api_ready http://127.0.0.1:\(server.port)\n".utf8))

// The lifeline: the runner holds our stdin open for the session.
while !FileHandle.standardInput.availableData.isEmpty {}
exit(0)
