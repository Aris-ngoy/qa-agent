import Foundation

/// A PNG of the simulator screen from `simctl io screenshot`. Slow, but real; the
/// framebuffer capture replaces it in the next slice.
public func simctlScreenshot(udid: String, deviceSet: String?) throws -> Data {
    let file = FileManager.default.temporaryDirectory.appendingPathComponent("yoqa-sim-\(UUID().uuidString).png")
    defer { try? FileManager.default.removeItem(at: file) }
    let set = deviceSet.map { ["--set", $0] } ?? []
    _ = try run("/usr/bin/xcrun", ["simctl"] + set + ["io", udid, "screenshot", "--type=png", file.path])
    return try Data(contentsOf: file)
}
