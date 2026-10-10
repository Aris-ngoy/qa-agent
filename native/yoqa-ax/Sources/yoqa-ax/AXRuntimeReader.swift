import CoreGraphics
import Foundation
import YoqaAxCore

/// Reads the accessibility tree from inside the simulator through the private AXRuntime
/// framework, the way VoiceOver sees it: the foreground apps' elements, then SpringBoard's
/// (its dialogs and the status bar). Off the simulator there is no AXRuntime, and every read
/// is empty.
///
/// It turns app accessibility on, so running apps load their accessibility bundles. It never
/// sets `AutomationEnabled`, which hangs the query on current simulators, and it never
/// foregrounds an app.
final class AXRuntimeReader {
    private let elementClass: NSObject.Type?

    init() {
        _ = dlopen("/System/Library/PrivateFrameworks/AXRuntime.framework/AXRuntime", RTLD_NOW)
        if let accessibility = dlopen("/usr/lib/libAccessibility.dylib", RTLD_NOW),
           let symbol = dlsym(accessibility, "_AXSApplicationAccessibilitySetEnabled")
        {
            typealias SetEnabled = @convention(c) (Bool) -> Void
            unsafeBitCast(symbol, to: SetEnabled.self)(true)
        }
        elementClass = NSClassFromString("AXElement") as? NSObject.Type
    }

    /// The foreground apps' elements, then SpringBoard's.
    func read() -> Tree {
        guard let springBoard else { return Tree(nodes: []) }
        // While SpringBoard is frontmost (a dialog, the home screen), it is listed among the
        // current applications too; it is read once, last.
        let apps = ((object(springBoard, "currentApplications") as? [NSObject]) ?? [])
            .filter { (object($0, "isSystemApplication") as? NSNumber)?.boolValue != true }
        return Tree(screen: rect(springBoard), elements: (apps + [springBoard]).flatMap(elements))
    }

    /// The SpringBoard dialog, from SpringBoard's elements alone.
    func alert() -> Alert {
        guard let springBoard else { return Alert(title: nil, buttons: []) }
        return Alert(screen: rect(springBoard), elements: elements(of: springBoard))
    }

    /// SpringBoard, whose frame is the screen in points.
    private var springBoard: NSObject? {
        elementClass?.value(forKey: "systemApplication") as? NSObject
    }

    private func elements(of app: NSObject) -> [RawElement] {
        ((object(app, "explorerElements") as? [NSObject]) ?? []).map { element in
            RawElement(
                label: string(element, "label"),
                value: string(element, "value"),
                identifier: string(element, "axIdentifier"),
                traits: (object(element, "traits") as? NSNumber)?.uint64Value ?? 0,
                frame: rect(element),
                inDialog: ((object(element, "containerTypes") as? [NSNumber]) ?? [])
                    .contains { $0.intValue == Self.dialogContainer }
            )
        }
    }

    /// The container type of a SpringBoard dialog. Every element of a permission prompt has it
    /// among its `containerTypes`, and its title is the container's label; Settings and the
    /// home screen have none.
    private static let dialogContainer = 1024

    /// The value of a getter the object has, else nil (KVC on a missing key would throw).
    private func object(_ target: NSObject, _ key: String) -> Any? {
        guard target.responds(to: NSSelectorFromString(key)) else { return nil }
        return target.value(forKey: key)
    }

    /// Labels come back as `AXAttributedString`; its description is the plain text.
    private func string(_ target: NSObject, _ key: String) -> String? {
        guard let value = object(target, key) else { return nil }
        if let string = value as? String { return string }
        if let attributed = value as? NSAttributedString { return attributed.string }
        if let number = value as? NSNumber { return number.stringValue }
        return (value as? NSObject)?.description
    }

    private func rect(_ target: NSObject) -> Rect {
        var frame = CGRect.zero
        (object(target, "frame") as? NSValue)?.getValue(&frame)
        return Rect(
            x: Double(frame.origin.x), y: Double(frame.origin.y),
            width: Double(frame.width), height: Double(frame.height)
        )
    }
}
