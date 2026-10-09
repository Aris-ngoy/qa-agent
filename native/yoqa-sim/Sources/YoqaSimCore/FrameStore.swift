import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Where frames come from: the simulator framebuffer in the binary, a test image in tests.
public protocol FrameSource: AnyObject {
    /// A copy of the screen as it is now, or nil when there is no framebuffer.
    func currentImage() -> CGImage?
}

public enum FrameFormat: String {
    case png
    case jpeg
}

/// One encoded frame. `hash` identifies its pixels: it changes when the screen does.
public struct EncodedFrame {
    public var data: Data
    public var hash: String
    public var sequence: UInt64
}

/// The latest frame, encoded once per format and scale. A frame is read from the source
/// only after the display reports a new one, so serving an unchanged screen costs nothing.
/// Capture and encoding run outside the lock, so one slow encode never blocks other reads.
public final class FrameStore {
    /// `GET /screenshot` without parameters; always encoded ahead of time. The Inspector's
    /// stream (`/stream.mjpeg`) reads half scale instead, kept warm while it is read.
    public static let preview = (scale: 0.25, format: FrameFormat.jpeg)
    /// A format read within this long is encoded ahead of time when a new frame arrives.
    static let warmWindow: TimeInterval = 2

    private struct Key: Hashable {
        var scale: Double
        var format: FrameFormat
    }

    private struct Entry {
        var sequence: UInt64
        var image: CGImage
        var hash: String
        var encoded: [Key: Data] = [:]
    }

    private let source: FrameSource
    /// Guards the fields below; signalled when a frame arrives.
    private let lock = NSCondition()
    private var sequence: UInt64 = 1
    private var entry: Entry?
    private var lastRead: [Key: Date] = [Key(scale: preview.scale, format: preview.format): .distantFuture]
    private let warmQueue = DispatchQueue(label: "yoqa-sim.encode", qos: .userInitiated)
    private var warmPending = false

    public init(source: FrameSource) {
        self.source = source
    }

    /// The display drew a new frame: the next read takes it, and the formats read recently
    /// are encoded in the background so they are ready before anyone asks. Frames that
    /// arrive during one warm-up are coalesced into the next.
    public func frameArrived() {
        lock.lock()
        sequence += 1
        let schedule = !warmPending
        warmPending = true
        lock.broadcast()
        lock.unlock()
        guard schedule else { return }
        warmQueue.async { [weak self] in
            guard let self else { return }
            self.lock.lock()
            self.warmPending = false
            let now = Date()
            let keys = self.lastRead.filter { now.timeIntervalSince($0.value) < Self.warmWindow }.map(\.key)
            self.lock.unlock()
            for key in keys { _ = self.encoded(key, markRead: false) }
        }
    }

    /// Blocks until a frame newer than `sequence` arrives, or `timeout` passes.
    public func waitForFrame(after sequence: UInt64, timeout: TimeInterval) {
        let deadline = Date().addingTimeInterval(timeout)
        lock.lock()
        while self.sequence <= sequence, lock.wait(until: deadline) {}
        lock.unlock()
    }

    /// Blocks until queued warm-ups are done (for tests).
    func waitUntilWarm() {
        warmQueue.sync {}
    }

    public func frame(scale: Double, format: FrameFormat) -> EncodedFrame? {
        encoded(Key(scale: scale, format: format), markRead: true)
    }

    private func encoded(_ key: Key, markRead: Bool) -> EncodedFrame? {
        lock.lock()
        if markRead, lastRead[key] != .distantFuture { lastRead[key] = Date() }
        let wanted = sequence
        var current = entry?.sequence == wanted ? entry : nil
        lock.unlock()

        if let current, let data = current.encoded[key] {
            return EncodedFrame(data: data, hash: current.hash, sequence: current.sequence)
        }
        if current == nil {
            guard let image = source.currentImage() else { return nil }
            current = Entry(sequence: wanted, image: image, hash: pixelHash(image))
        }
        guard var fresh = current, let data = encode(fresh.image, scale: key.scale, format: key.format) else { return nil }

        lock.lock()
        if let stored = entry, stored.sequence == fresh.sequence {
            fresh = stored
        }
        fresh.encoded[key] = data
        if (entry?.sequence ?? 0) <= fresh.sequence { entry = fresh }
        lock.unlock()
        return EncodedFrame(data: data, hash: fresh.hash, sequence: fresh.sequence)
    }
}

private func scaled(_ image: CGImage, by scale: Double) -> CGImage? {
    if scale >= 1 { return image }
    let width = max(1, Int((Double(image.width) * scale).rounded()))
    let height = max(1, Int((Double(image.height) * scale).rounded()))
    guard let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
    ) else { return nil }
    context.interpolationQuality = .medium
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return context.makeImage()
}

private func encode(_ image: CGImage, scale: Double, format: FrameFormat) -> Data? {
    guard let image = scaled(image, by: scale) else { return nil }
    let data = NSMutableData()
    let type = (format == .png ? UTType.png : UTType.jpeg).identifier as CFString
    guard let destination = CGImageDestinationCreateWithData(data, type, 1, nil) else { return nil }
    let options = [kCGImageDestinationLossyCompressionQuality: format == .jpeg ? 0.7 : 1] as CFDictionary
    CGImageDestinationAddImage(destination, image, options)
    return CGImageDestinationFinalize(destination) ? data as Data : nil
}

/// FNV-1a over a 64-pixel-wide thumbnail: cheap, and equal for an unchanged screen.
private func pixelHash(_ image: CGImage) -> String {
    let width = 64
    let height = max(1, image.height * width / max(1, image.width))
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    pixels.withUnsafeMutableBytes { buffer in
        guard let context = CGContext(
            data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
        ) else { return }
        context.interpolationQuality = .low
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    }
    var hash: UInt64 = 0xcbf2_9ce4_8422_2325
    for byte in pixels {
        hash ^= UInt64(byte)
        hash = hash &* 0x0000_0100_0000_01b3
    }
    return String(format: "%016llx", hash)
}
