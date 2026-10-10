import XCTest

/// The phone through XCUITest. Coordinates are fractions of SpringBoard's frame, which is
/// the whole screen whichever app is in front. XCUITest is used on the main thread only,
/// through a `MainThreadGate`, so a stuck main thread is `RunnerWedged` and not a hung cable.
final class PhoneDevice: Device {
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    private let gate = MainThreadGate()

    func viewport() throws -> (width: Double, height: Double) {
        try onMain {
            let size = UIScreen.main.bounds.size
            return (Double(size.width), Double(size.height))
        }
    }

    func tap(_ point: Fraction) throws {
        try onMain { self.coordinate(point).tap() }
    }

    func longPress(_ point: Fraction, seconds: Double) throws {
        try onMain { self.coordinate(point).press(forDuration: seconds) }
    }

    func drag(from: Fraction, to: Fraction, pressSeconds: Double, seconds: Double) throws {
        try onMain {
            let size = UIScreen.main.bounds.size
            let distance = hypot((to.x - from.x) * size.width, (to.y - from.y) * size.height)
            let velocity = XCUIGestureVelocity(rawValue: distance / max(seconds, 0.05))
            self.coordinate(from).press(
                forDuration: pressSeconds,
                thenDragTo: self.coordinate(to),
                withVelocity: velocity,
                thenHoldForDuration: 0
            )
        }
    }

    func screenshot() throws -> Data {
        try onMain { XCUIScreen.main.screenshot().pngRepresentation }
    }

    /// The tree of `bundleId`, or of SpringBoard. A snapshot never activates an app: one that
    /// is not in the foreground is `AppBackgrounded`, and the foreground is left alone.
    func snapshot(bundleId: String?) throws -> [SnapshotNode] {
        try onMain {
            let app = bundleId.map { XCUIApplication(bundleIdentifier: $0) } ?? self.springboard
            if bundleId != nil, app.state != .runningForeground {
                throw AppBackgrounded("\(bundleId ?? "") is not in the foreground (state \(app.state.rawValue))")
            }
            let screen = self.springboard.frame
            guard screen.width > 0, screen.height > 0 else { throw DeviceError("the screen has no size") }
            let query = app.descendants(matching: .any)
            return (0..<query.count).compactMap { index -> SnapshotNode? in
                let element = query.element(boundBy: index)
                let frame = element.frame
                guard frame.width > 0, frame.height > 0 else { return nil }
                return SnapshotNode(
                    role: Self.roleName(element.elementType),
                    label: element.label.isEmpty ? nil : element.label,
                    value: (element.value as? String).flatMap { $0.isEmpty ? nil : $0 },
                    id: element.identifier.isEmpty ? nil : element.identifier,
                    frame: (
                        Double(frame.minX / screen.width), Double(frame.minY / screen.height),
                        Double(frame.width / screen.width), Double(frame.height / screen.height)
                    ),
                    enabled: element.isEnabled
                )
            }
        }
    }

    /// The names `yoqa-ax` reports on the simulator, so the Screen reads a phone the same way.
    private static func roleName(_ type: XCUIElement.ElementType) -> String {
        switch type {
        case .button: return "Button"
        case .staticText: return "StaticText"
        case .textField: return "TextField"
        case .secureTextField: return "SecureTextField"
        case .textView: return "TextView"
        case .image: return "Image"
        case .switch: return "Switch"
        case .slider: return "Slider"
        case .cell: return "Cell"
        case .table: return "Table"
        case .collectionView: return "CollectionView"
        case .scrollView: return "ScrollView"
        case .navigationBar: return "NavigationBar"
        case .tabBar: return "TabBar"
        case .toolbar: return "Toolbar"
        case .alert: return "Alert"
        case .sheet: return "Sheet"
        case .link: return "Link"
        case .searchField: return "SearchField"
        case .key: return "Key"
        case .keyboard: return "Keyboard"
        case .window: return "Window"
        case .application: return "Application"
        case .icon: return "Icon"
        default: return "Other"
        }
    }

    func typeText(_ text: String) throws {
        try onMain { self.springboard.typeText(text) }
    }

    func keyboardReturn() throws {
        try onMain { self.springboard.typeText("\n") }
    }

    func keyboardDelete() throws {
        try onMain { self.springboard.typeText(XCUIKeyboardKey.delete.rawValue) }
    }

    func button(_ name: String) throws {
        try onMain {
            switch name {
            case "home": XCUIDevice.shared.press(.home)
            case "volumeUp": XCUIDevice.shared.press(.volumeUp)
            default: XCUIDevice.shared.press(.volumeDown)
            }
        }
    }

    private func coordinate(_ point: Fraction) -> XCUICoordinate {
        self.springboard.coordinate(withNormalizedOffset: CGVector(dx: point.x, dy: point.y))
    }

    private func onMain<T>(_ work: @escaping () throws -> T) throws -> T {
        try gate.run(work)
    }
}
