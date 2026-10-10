import Foundation
import YoqaSimCore

/// Feeds a `TouchscreenWatch` from the simulator's own log: what backboardd logged since boot
/// (`log show`, ~1 s), then everything it logs from now on (`log stream`). Runs in the background,
/// so start-up never waits for it; until it has read anything the touchscreen is `unknown`.
final class TouchscreenFeed {
    private let udid: String
    private let simctl: [String]
    private var stream: Process?
    private let lock = NSLock()
    private var stopped = false

    init(udid: String, deviceSet: String?) {
        self.udid = udid
        simctl = ["simctl"] + (deviceSet.map { ["--set", $0] } ?? []) + ["spawn", udid, "log"]
    }

    func start(into watch: TouchscreenWatch) {
        DispatchQueue.global(qos: .utility).async { [self] in
            let ps = (try? run("/bin/ps", ["-axo", "pid=,lstart=,command="])).map { String(decoding: $0, as: UTF8.self) } ?? ""
            let since = SimulatorBoot.logStart(udid: udid, ps: ps).map { ["--start", $0] } ?? ["--last", "1h"]
            if let history = try? run("/usr/bin/xcrun", simctl + ["show", "--style", "compact", "--predicate", TouchscreenLog.predicate] + since) {
                String(decoding: history, as: UTF8.self).split(separator: "\n").forEach { watch.feed(String($0)) }
            }
            follow(into: watch)
        }
    }

    /// Stops `log stream`, so it never outlives yoqa-sim.
    func stop() {
        lock.lock()
        stopped = true
        let process = stream
        lock.unlock()
        if let process, process.isRunning { process.terminate() }
    }

    private func follow(into watch: TouchscreenWatch) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
        process.arguments = simctl + ["stream", "--style", "compact", "--predicate", TouchscreenLog.predicate]
        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        process.standardInput = FileHandle.nullDevice
        lock.lock()
        defer { lock.unlock() }
        guard !stopped, (try? process.run()) != nil else { return }
        stream = process
        var pending = Data()
        output.fileHandleForReading.readabilityHandler = { handle in
            let chunk = handle.availableData
            guard !chunk.isEmpty else {
                handle.readabilityHandler = nil
                return
            }
            pending.append(chunk)
            while let newline = pending.firstIndex(of: UInt8(ascii: "\n")) {
                watch.feed(String(decoding: pending[pending.startIndex..<newline], as: UTF8.self))
                pending.removeSubrange(pending.startIndex...newline)
            }
        }
    }
}
