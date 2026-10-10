/// A rectangle: points as the accessibility runtime reports them, or fractions of the screen.
public struct Rect: Equatable {
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    /// This rectangle as fractions of `screen` (both in points).
    func fraction(of screen: Rect) -> Rect {
        Rect(
            x: (x - screen.x) / screen.width,
            y: (y - screen.y) / screen.height,
            width: width / screen.width,
            height: height / screen.height
        )
    }

    var json: [String: Double] {
        ["x": x, "y": y, "width": width, "height": height]
    }
}

/// One accessibility element, flat: what `describe` returns for each node.
public struct AXNode: Equatable {
    public var role: String
    public var label: String?
    public var value: String?
    /// The accessibility identifier.
    public var id: String?
    /// 0.0–1.0 of the simulator screen.
    public var frame: Rect
    public var enabled: Bool

    public init(role: String, label: String?, value: String?, id: String?, frame: Rect, enabled: Bool) {
        self.role = role
        self.label = label
        self.value = value
        self.id = id
        self.frame = frame
        self.enabled = enabled
    }

    var json: [String: Any] {
        var body: [String: Any] = [
            "role": role,
            "frame": frame.json,
            "enabled": enabled,
        ]
        if let label { body["label"] = label }
        if let value { body["value"] = value }
        if let id { body["id"] = id }
        return body
    }
}

/// What one `describe` read. An empty read is still an answer, marked degraded.
public struct Tree: Equatable {
    public var nodes: [AXNode]
    public var degraded: Bool { nodes.isEmpty }

    public init(nodes: [AXNode]) {
        self.nodes = nodes
    }

    var json: [String: Any] {
        ["nodes": nodes.map(\.json), "degraded": degraded]
    }
}

/// One element as the accessibility runtime reports it: points and UIAccessibilityTraits.
public struct RawElement {
    public var label: String?
    public var value: String?
    public var identifier: String?
    public var traits: UInt64
    /// In points.
    public var frame: Rect
    /// Inside a SpringBoard dialog (a permission prompt, a system alert).
    public var inDialog: Bool

    public init(label: String?, value: String?, identifier: String?, traits: UInt64, frame: Rect, inDialog: Bool = false) {
        self.label = label
        self.value = value
        self.identifier = identifier
        self.traits = traits
        self.frame = frame
        self.inDialog = inDialog
    }
}

/// UIAccessibilityTraits bits, plus the private text-entry one the runtime reports.
enum Trait {
    static let button: UInt64 = 1 << 0
    static let link: UInt64 = 1 << 1
    static let image: UInt64 = 1 << 2
    static let staticText: UInt64 = 1 << 6
    static let notEnabled: UInt64 = 1 << 8
    static let searchField: UInt64 = 1 << 10
    static let adjustable: UInt64 = 1 << 12
    static let header: UInt64 = 1 << 16
    static let textEntry: UInt64 = 1 << 18
}

extension Tree {
    /// The elements with frames as fractions of `screen` (both in points). Zero-sized
    /// elements are dropped; an empty screen gives an empty, degraded tree.
    public init(screen: Rect, elements: [RawElement]) {
        guard screen.width > 0, screen.height > 0 else {
            self.init(nodes: [])
            return
        }
        self.init(nodes: elements.compactMap { element in
            let frame = element.frame
            guard frame.width > 0, frame.height > 0 else { return nil }
            return AXNode(
                role: Self.role(element.traits),
                label: Self.text(element.label),
                value: Self.text(element.value),
                id: Self.text(element.identifier),
                frame: frame.fraction(of: screen),
                enabled: element.traits & Trait.notEnabled == 0
            )
        })
    }

    static func role(_ traits: UInt64) -> String {
        let roles: [(UInt64, String)] = [
            (Trait.searchField, "SearchField"),
            (Trait.textEntry, "TextField"),
            (Trait.adjustable, "Slider"),
            (Trait.button, "Button"),
            (Trait.link, "Link"),
            (Trait.header, "Heading"),
            (Trait.image, "Image"),
            (Trait.staticText, "StaticText"),
        ]
        return roles.first { traits & $0.0 != 0 }?.1 ?? "Other"
    }

    private static func text(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return value
    }
}

/// The SpringBoard dialog on screen: its title and buttons, in order. No dialog gives no
/// title and no buttons.
public struct Alert: Equatable {
    public struct Button: Equatable {
        public var label: String
        /// 0.0–1.0 of the simulator screen.
        public var frame: Rect

        public init(label: String, frame: Rect) {
            self.label = label
            self.frame = frame
        }
    }

    public var title: String?
    public var buttons: [Button]

    public init(title: String?, buttons: [Button]) {
        self.title = title
        self.buttons = buttons
    }

    /// The dialog among SpringBoard's elements: its first text is the title, and its labelled
    /// buttons are the buttons.
    public init(screen: Rect, elements: [RawElement]) {
        let dialog = elements.filter(\.inDialog)
        guard screen.width > 0, screen.height > 0, !dialog.isEmpty else {
            self.init(title: nil, buttons: [])
            return
        }
        let isButton = { (element: RawElement) in element.traits & Trait.button != 0 }
        self.init(
            title: dialog.first { !isButton($0) && !($0.label ?? "").isEmpty }?.label,
            buttons: dialog.filter(isButton).compactMap { element in
                guard let label = element.label, !label.isEmpty else { return nil }
                return Button(label: label, frame: element.frame.fraction(of: screen))
            }
        )
    }

    var json: [String: Any] {
        var body: [String: Any] = ["buttons": buttons.map { ["label": $0.label, "frame": $0.frame.json] }]
        if let title { body["title"] = title }
        return body
    }
}
