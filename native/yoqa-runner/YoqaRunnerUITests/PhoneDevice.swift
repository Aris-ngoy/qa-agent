import XCTest

/// The phone through XCUITest. Coordinates are fractions of SpringBoard's frame, which is
/// the whole screen whichever app is in front. XCUITest is used on the main thread only.
final class PhoneDevice: Device {
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

    func viewport() throws -> (width: Double, height: Double) {
        onMain {
            let size = UIScreen.main.bounds.size
            return (Double(size.width), Double(size.height))
        }
    }

    func tap(_ point: Fraction) throws {
        onMain { coordinate(point).tap() }
    }

    func longPress(_ point: Fraction, seconds: Double) throws {
        onMain { coordinate(point).press(forDuration: seconds) }
    }

    func drag(from: Fraction, to: Fraction, pressSeconds: Double, seconds: Double) throws {
        onMain {
            let size = UIScreen.main.bounds.size
            let distance = hypot((to.x - from.x) * size.width, (to.y - from.y) * size.height)
            let velocity = XCUIGestureVelocity(rawValue: distance / max(seconds, 0.05))
            coordinate(from).press(
                forDuration: pressSeconds,
                thenDragTo: coordinate(to),
                withVelocity: velocity,
                thenHoldForDuration: 0
            )
        }
    }

    func screenshot() throws -> Data {
        onMain { XCUIScreen.main.screenshot().pngRepresentation }
    }

    private func coordinate(_ point: Fraction) -> XCUICoordinate {
        springboard.coordinate(withNormalizedOffset: CGVector(dx: point.x, dy: point.y))
    }

    private func onMain<T>(_ work: () -> T) -> T {
        Thread.isMainThread ? work() : DispatchQueue.main.sync(execute: work)
    }
}
