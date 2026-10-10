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
}
