import Foundation

/// Finds SimulatorKit in the active Xcode. Xcode 27 moved it from
/// `Contents/Developer/Library/PrivateFrameworks` to `Contents/SharedFrameworks`.
public enum SimulatorKit {
    public static func resolve(developerDir: String, exists: (String) -> Bool) -> String? {
        let developer = URL(fileURLWithPath: developerDir).standardizedFileURL
        let candidates = [
            developer.deletingLastPathComponent().appendingPathComponent("SharedFrameworks/SimulatorKit.framework"),
            developer.appendingPathComponent("Library/PrivateFrameworks/SimulatorKit.framework"),
        ]
        return candidates.map(\.path).first(where: exists)
    }

    /// `DEVELOPER_DIR`, else `xcode-select -p`.
    public static func activeDeveloperDir() throws -> String {
        if let fromEnv = ProcessInfo.processInfo.environment["DEVELOPER_DIR"], !fromEnv.isEmpty {
            return fromEnv
        }
        let output = try run("/usr/bin/xcode-select", ["-p"])
        return String(decoding: output, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
