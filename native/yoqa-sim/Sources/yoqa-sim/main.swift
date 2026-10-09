import Foundation
import SimBridge
import YoqaSimCore

// Resident process for one booted iOS simulator (see docs/plans/device-lanes/device-sim.md).
// Prints `api_ready http://127.0.0.1:<port>` once it serves, then
// `stream_ready http://127.0.0.1:<port>/stream.mjpeg` for the Inspector's live preview, then nothing. It exits when
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

let simulator: YSSimulator
do {
    simulator = try YSSimulator(udid: arguments.udid, deviceSet: arguments.deviceSet, developerDir: developerDir, simulatorKit: simulatorKit)
} catch {
    fail(error.localizedDescription)
}

let device = SimulatorDevice(simulator)
let frames = FrameStore(source: device)
simulator.observeFrames { frames.frameArrived() }
let controller = Controller(status: Status(udid: arguments.udid, simulatorKit: simulatorKit), device: device, frames: frames)

let server: LoopbackServer
do {
    server = try LoopbackServer()
} catch {
    fail(String(describing: error))
}
server.serve(controller.handle)

FileHandle.standardOutput.write(Data("api_ready http://127.0.0.1:\(server.port)\n".utf8))
FileHandle.standardOutput.write(Data("stream_ready http://127.0.0.1:\(server.port)/stream.mjpeg\n".utf8))

// The lifeline: the runner holds our stdin open for the session.
while !FileHandle.standardInput.availableData.isEmpty {}
exit(0)
