import Foundation

/// Whether backboardd still has the legacy (Indigo) touchscreen that yoqa-sim's touches reach.
///
/// Since iOS 26 the simulator's main touchscreen belongs to `dtuhidd` (CoreDevice HID). backboardd
/// disconnects the legacy one when dtuhidd goes active and connects it again on the next Indigo
/// event. That reconnect can fail: the service is removed again at once while SimulatorHID records
/// it as connected, so it is never retried. From then until a reboot every Indigo touch is accepted
/// and dropped (see docs/devices/yoqa-sim-framebuffer-hid.md).
public enum TouchscreenState: String, Equatable {
    /// Nothing logged about it yet: no dtuhidd, or the log isn't read yet.
    case unknown
    case attached
    /// Disconnected for dtuhidd; the next Indigo event reconnects it.
    case suppressed
    /// An Indigo event asked for it; backboardd hasn't added it yet.
    case reviving
    /// Removed without SimulatorHID asking. Touches go nowhere until the simulator reboots.
    case dropped

    /// A gesture sent now decides whether it attaches or is dropped.
    var awaitsRevival: Bool { self == .suppressed || self == .reviving }
}

/// Follows the legacy touchscreen through backboardd's log lines (`log show --style compact`).
public struct TouchscreenLog {
    public private(set) var state = TouchscreenState.unknown
    private var serviceID: String?
    private var removalExpected = false
    private var backboardd: Substring?

    public init() {}

    /// Only the lines these match matter; `log show` and `log stream` take it as `--predicate`.
    public static let predicate = #"process == "backboardd" AND (eventMessage CONTAINS "dtuhidd state changed" OR eventMessage CONTAINS "ScreenTouchService.PurpleMain" OR (eventMessage CONTAINS "IOHIDService name" AND eventMessage CONTAINS "primaryUsagePage:0xd primaryUsage:0x4 transport: "))"#

    public mutating func consume(_ line: String) {
        guard let process = line.range(of: "backboardd[") else { return }
        let pid = line[process.upperBound...].prefix { $0.isNumber }
        if let backboardd, backboardd != pid { self = TouchscreenLog() }
        backboardd = pid

        if line.contains("dtuhidd state changed to active") {
            // backboardd disconnects an attached touchscreen with its own lines; one never seen
            // is suppressed from the start.
            if state == .unknown { state = .suppressed }
        } else if line.contains("ScreenTouchService.PurpleMain") {
            serviceID = Self.value(after: "identifier: ", in: line) ?? serviceID
            if line.contains("Connecting dtuhidd-suppressed service") {
                state = .reviving
                removalExpected = false
            } else if line.contains("Disconnecting service") {
                removalExpected = true
            } else if line.contains("Connecting service"), state == .unknown {
                state = .attached
            }
        } else if line.contains("transport: "), let id = Self.value(after: "IOHIDService name: id:", in: line),
                  serviceID == nil || serviceID == id {
            // Legacy SimulatorHID services have an empty transport; CoreDevice ones say CoreDevice.
            if line.contains("Service added") {
                state = .attached
                removalExpected = false
            } else if line.contains("Service removed") {
                state = removalExpected ? .suppressed : .dropped
                removalExpected = false
            }
        }
    }

    /// A revival that logged nothing can't be judged; stop waiting for one.
    mutating func forgetPendingRevival() {
        if state.awaitsRevival { state = .unknown }
    }

    private static func value(after marker: String, in line: String) -> String? {
        guard let start = line.range(of: marker) else { return nil }
        let value = line[start.upperBound...].prefix { $0.isHexDigit || $0 == "x" }
        return value.isEmpty ? nil : String(value)
    }
}

/// What the controller asks about the touchscreen.
public protocol TouchscreenHealth: AnyObject {
    var state: TouchscreenState { get }
    /// Waits up to `timeout` for a pending revival to attach or drop it, and returns the state:
    /// `unknown` when nothing was logged in time.
    func settled(timeout: TimeInterval) -> TouchscreenState
}

/// A `TouchscreenLog` fed from another thread (the simulator's `log show` and `log stream`).
public final class TouchscreenWatch: TouchscreenHealth {
    private let condition = NSCondition()
    private var log = TouchscreenLog()

    public init() {}

    public func feed(_ line: String) {
        condition.lock()
        log.consume(line)
        condition.broadcast()
        condition.unlock()
    }

    public var state: TouchscreenState {
        condition.lock()
        defer { condition.unlock() }
        return log.state
    }

    public func settled(timeout: TimeInterval) -> TouchscreenState {
        let deadline = Date().addingTimeInterval(timeout)
        condition.lock()
        defer { condition.unlock() }
        while log.state.awaitsRevival, condition.wait(until: deadline) {}
        log.forgetPendingRevival()
        return log.state
    }
}

/// When the simulator booted, for `log show --start`: reading its whole log store takes ~10 s.
public enum SimulatorBoot {
    /// The start of the simulator's `launchd_sim`, from `ps -axo pid=,lstart=,command=`, in the
    /// local time `log show` expects.
    public static func logStart(udid: String, ps: String) -> String? {
        guard let line = ps.split(separator: "\n").first(where: { $0.contains("launchd_sim") && $0.contains("/\(udid)/") }) else {
            return nil
        }
        // "  22467 Sat Oct 10 08:40:45 2026     launchd_sim …": the five fields after the pid.
        let fields = line.split(separator: " ", omittingEmptySubsequences: true)
        guard fields.count > 6 else { return nil }
        let reader = DateFormatter()
        reader.locale = Locale(identifier: "en_US_POSIX")
        reader.dateFormat = "EEE MMM d HH:mm:ss yyyy"
        guard let date = reader.date(from: fields[1...5].joined(separator: " ")) else { return nil }
        let writer = DateFormatter()
        writer.locale = Locale(identifier: "en_US_POSIX")
        writer.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return writer.string(from: date)
    }
}
