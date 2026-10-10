import Foundation

/// Captures the screen on the phone, in the background, so a Run recording does not pay a
/// cable round trip per frame. Frames are JPEGs with the milliseconds since `start`; the Mac
/// pulls them in batches with `fetch` and encodes the video. This is what WebDriverAgent's
/// MJPEG server does for Appium, with a pull instead of a push.
///
/// Memory is bounded: past `maxBytes` the oldest frames are dropped, and a recording nobody
/// has pulled from for `idleSeconds` stops itself, so a lost Mac cannot leave it running.
public final class FrameRecorder {
    public struct Frame {
        public let seq: Int
        public let ms: Int
        public let jpeg: Data
    }

    public struct Batch {
        public let frames: [Frame]
        public let running: Bool
        /// The last capture failure, when no frame has landed since.
        public let error: String?
    }

    private let device: Device
    private let maxBytes: Int
    private let idleSeconds: Double
    private let lock = NSLock()
    private var frames: [Frame] = []
    private var bytes = 0
    private var nextSeq = 0
    private var generation = 0
    private var running = false
    private var lastError: String?
    private var lastFetch = Date()
    private var origin = Date()

    public init(device: Device, maxBytes: Int = 64 * 1024 * 1024, idleSeconds: Double = 60) {
        self.device = device
        self.maxBytes = maxBytes
        self.idleSeconds = idleSeconds
    }

    /// Start capturing about `fps` frames a second (a slow phone delivers fewer). Starting again
    /// restarts: the old frames are discarded.
    public func start(fps: Double, scale: Double, quality: Double) {
        lock.lock()
        generation += 1
        let mine = generation
        frames = []
        bytes = 0
        nextSeq = 0
        running = true
        lastError = nil
        lastFetch = Date()
        origin = Date()
        lock.unlock()

        let interval = 1 / max(fps, 0.5)
        let thread = Thread { [self] in
            while isCurrent(mine) {
                let began = Date()
                do {
                    let jpeg = try device.frame(scale: scale, quality: quality)
                    add(jpeg, generation: mine)
                } catch {
                    fail("\(error)", generation: mine)
                }
                let rest = interval - Date().timeIntervalSince(began)
                if rest > 0 { Thread.sleep(forTimeInterval: rest) }
            }
        }
        thread.name = "yoqa-frame-recorder"
        thread.start()
    }

    /// Frames after `seq` (all of them when nil). Pulling frames also marks the Mac as alive.
    public func fetch(after seq: Int?, limit: Int = 40) -> Batch {
        lock.lock()
        defer { lock.unlock() }
        lastFetch = Date()
        let from = seq ?? -1
        let batch = Array(frames.filter { $0.seq > from }.prefix(limit))
        return Batch(frames: batch, running: running, error: batch.isEmpty ? lastError : nil)
    }

    public func stop() {
        lock.lock()
        generation += 1
        running = false
        lock.unlock()
    }

    private func isCurrent(_ mine: Int) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard generation == mine, running else { return false }
        if Date().timeIntervalSince(lastFetch) > idleSeconds {
            running = false
            lastError = "the Mac stopped pulling frames, so the recording stopped"
            return false
        }
        return true
    }

    private func add(_ jpeg: Data, generation mine: Int) {
        lock.lock()
        defer { lock.unlock() }
        guard generation == mine else { return }
        let ms = Int(Date().timeIntervalSince(origin) * 1000)
        frames.append(Frame(seq: nextSeq, ms: ms, jpeg: jpeg))
        nextSeq += 1
        bytes += jpeg.count
        lastError = nil
        while bytes > maxBytes, frames.count > 1 {
            bytes -= frames.removeFirst().jpeg.count
        }
    }

    private func fail(_ message: String, generation mine: Int) {
        lock.lock()
        defer { lock.unlock() }
        if generation == mine { lastError = message }
    }
}
