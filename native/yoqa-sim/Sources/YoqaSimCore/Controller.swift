import CoreGraphics
import Foundation

/// The simulator's touch input. Each call sends one touch and returns once it is delivered.
public protocol TouchDevice: AnyObject {
    var pixelSize: CGSize { get }
    var pointScale: Double { get }
    func send(_ step: TouchStep) throws
}

/// What `GET /status` reports: which simulator, and the SimulatorKit it loaded.
public struct Status {
    public var udid: String
    public var simulatorKit: String

    public init(udid: String, simulatorKit: String) {
        self.udid = udid
        self.simulatorKit = simulatorKit
    }
}

/// The control API (see docs/plans/device-lanes/device-sim.md). Gestures run one at a
/// time on the HID queue, and a request returns once its last touch is up.
public final class Controller {
    private let status: Status
    private let device: TouchDevice
    private let frames: FrameStore
    private let sleep: (Double) -> Void
    private let hid = DispatchQueue(label: "yoqa-sim.hid", qos: .userInteractive)
    public var onShutdown: () -> Void = { exit(0) }

    public init(status: Status, device: TouchDevice, frames: FrameStore, sleep: @escaping (Double) -> Void = { usleep(useconds_t($0 * 1000)) }) {
        self.status = status
        self.device = device
        self.frames = frames
        self.sleep = sleep
    }

    public func handle(_ request: HTTPRequest?) -> Response {
        guard let request else { return .error(400, "bad request") }
        switch (request.method, request.path) {
        case ("GET", "/status"):
            return .json(200, ["udid": status.udid, "simulatorKit": status.simulatorKit])
        case ("GET", "/screenshot"):
            return screenshot(request.query)
        case ("GET", "/display"):
            let size = device.pixelSize
            return .json(200, [
                "width": Int(size.width),
                "height": Int(size.height),
                "scale": device.pointScale,
                "orientation": size.width > size.height ? "landscape" : "portrait",
            ])
        case ("POST", "/tap"):
            guard let body = numbers(request.body), let x = body["x"], let y = body["y"] else {
                return .error(400, "tap needs numeric x and y in 0.0–1.0")
            }
            return perform(TouchPlan.tap(x: x, y: y, holdMs: body["holdMs"]))
        case ("POST", "/swipe"):
            guard let body = numbers(request.body),
                  let fromX = body["fromX"], let fromY = body["fromY"], let toX = body["toX"], let toY = body["toY"]
            else { return .error(400, "swipe needs numeric fromX, fromY, toX and toY in 0.0–1.0") }
            return perform(TouchPlan.swipe(from: (fromX, fromY), to: (toX, toY), durationMs: body["durationMs"]))
        case ("POST", "/key"):
            let key = (try? JSONSerialization.jsonObject(with: request.body) as? [String: Any])?["key"] as? String
            // Hardware button messages have no effect on current runtimes; Home is a gesture.
            guard key == "home" else { return .error(400, "unsupported key \(key ?? "(none)")") }
            return perform(TouchPlan.home())
        case ("POST", "/shutdown"):
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.05) { self.onShutdown() }
            return .json(200, ["ok": true])
        default:
            return .error(404, "not found")
        }
    }

    private func screenshot(_ query: [String: String]) -> Response {
        let scale = Double(query["scale"] ?? "") ?? FrameStore.preview.scale
        guard scale > 0, scale <= 1,
              let format = query["format"].map(FrameFormat.init(rawValue:)) ?? FrameStore.preview.format
        else {
            return .error(400, "scale must be in (0, 1] and format png or jpeg")
        }
        guard let frame = frames.frame(scale: scale, format: format) else {
            return .error(503, "the display has no framebuffer yet")
        }
        return Response(
            status: 200,
            contentType: format == .png ? "image/png" : "image/jpeg",
            body: frame.data,
            headers: ["X-Frame-Hash": frame.hash, "X-Frame-Seq": String(frame.sequence)]
        )
    }

    private func perform(_ plan: [TouchStep]) -> Response {
        var failure: Error?
        hid.sync {
            var down: TouchStep?
            for step in plan {
                if step.delayMs > 0 { sleep(step.delayMs) }
                do {
                    try device.send(step)
                    down = step.phase == .up ? nil : (down ?? step)
                } catch {
                    failure = error
                    // Never leave a finger on the screen: lift it where it went down.
                    if let down, step.phase != .up {
                        try? device.send(TouchStep(phase: .up, x: down.x, y: down.y, edge: down.edge, delayMs: 0))
                    }
                    return
                }
            }
        }
        if let failure { return .error(500, String(describing: failure)) }
        return .json(200, ["ok": true])
    }
}

private func numbers(_ body: Data) -> [String: Double]? {
    guard let object = try? JSONSerialization.jsonObject(with: body) as? [String: Any] else { return nil }
    var result: [String: Double] = [:]
    for (key, value) in object {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite else {
            return nil
        }
        result[key] = number.doubleValue
    }
    return result
}
