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
            "frame": ["x": frame.x, "y": frame.y, "width": frame.width, "height": frame.height],
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

    public init(label: String?, value: String?, identifier: String?, traits: UInt64, frame: Rect) {
        self.label = label
        self.value = value
        self.identifier = identifier
        self.traits = traits
        self.frame = frame
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
                frame: Rect(
                    x: (frame.x - screen.x) / screen.width,
                    y: (frame.y - screen.y) / screen.height,
                    width: frame.width / screen.width,
                    height: frame.height / screen.height
                ),
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
