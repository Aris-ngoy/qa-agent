import Foundation

/// A point on the screen as 0.0–1.0 fractions of its width and height, the way the Mac
/// sends coordinates. The Lane converts from 0–1000 at its edge; the phone never sees 0–1000.
public struct Fraction: Equatable {
    public var x: Double
    public var y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

public struct DeviceError: Error, CustomStringConvertible {
    public let description: String

    public init(_ description: String) {
        self.description = description
    }
}

/// The foreground app is not the one asked about. The snapshot is refused rather than
/// bringing the app forward: observing never changes what is on screen.
public struct AppBackgrounded: Error, CustomStringConvertible {
    public let description: String

    public init(_ description: String) {
        self.description = description
    }
}

/// The main thread did not answer in time, so XCUITest cannot be driven.
public struct RunnerWedged: Error, CustomStringConvertible {
    public let description: String

    public init(_ description: String) {
        self.description = description
    }
}

/// One accessibility element. The frame is 0.0–1.0 of the screen, as `yoqa-ax` reports it.
public struct SnapshotNode: Equatable {
    public var role: String
    public var label: String?
    public var value: String?
    public var id: String?
    public var frame: (x: Double, y: Double, width: Double, height: Double)
    public var enabled: Bool

    public init(
        role: String, label: String? = nil, value: String? = nil, id: String? = nil,
        frame: (x: Double, y: Double, width: Double, height: Double), enabled: Bool = true
    ) {
        self.role = role
        self.label = label
        self.value = value
        self.id = id
        self.frame = frame
        self.enabled = enabled
    }

    public static func == (lhs: SnapshotNode, rhs: SnapshotNode) -> Bool {
        lhs.role == rhs.role && lhs.label == rhs.label && lhs.value == rhs.value && lhs.id == rhs.id
            && lhs.frame == rhs.frame && lhs.enabled == rhs.enabled
    }
}

/// The phone, as the Session drives it. The UI-test bundle implements it with XCUITest;
/// the package's tests fake it. Calls arrive on the server's connection threads.
public protocol Device {
    /// The screen in points.
    func viewport() throws -> (width: Double, height: Double)
    func tap(_ point: Fraction) throws
    func longPress(_ point: Fraction, seconds: Double) throws
    /// Hold at `from` for `pressSeconds`, then move to `to` over `seconds`.
    func drag(from: Fraction, to: Fraction, pressSeconds: Double, seconds: Double) throws
    /// The whole screen as PNG.
    func screenshot() throws -> Data
    /// The accessibility tree of `bundleId`, or of SpringBoard when nil. Throws `AppBackgrounded`
    /// when that app is not in the foreground; it never activates it.
    func snapshot(bundleId: String?) throws -> [SnapshotNode]
    /// Type into whatever has keyboard focus.
    func typeText(_ text: String) throws
    func keyboardReturn() throws
    func keyboardDelete() throws
    /// A hardware button: `home`, `volumeUp` or `volumeDown`.
    func button(_ name: String) throws
}
