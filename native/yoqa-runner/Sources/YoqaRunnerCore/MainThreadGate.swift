import Foundation

/// Runs work on the main thread, which XCUITest requires, and gives up when the main thread
/// does not get to it. A stuck main thread (a modal XCUITest is waiting on, a hung app) is
/// reported as `RunnerWedged` instead of hanging the cable until the Mac times out.
public struct MainThreadGate {
    private let queue: DispatchQueue
    private let timeout: TimeInterval

    public init(queue: DispatchQueue = .main, timeout: TimeInterval = 8) {
        self.queue = queue
        self.timeout = timeout
    }

    public func run<T>(_ work: @escaping () throws -> T) throws -> T {
        if queue === DispatchQueue.main && Thread.isMainThread { return try work() }
        let done = DispatchSemaphore(value: 0)
        let box = Box<T>()
        queue.async {
            // The caller gave up and said so: a late tap or keystroke must not fire after that.
            guard box.start() else { return }
            box.set(Result { try work() })
            done.signal()
        }
        guard done.wait(timeout: .now() + timeout) == .success, let result = box.get() else {
            if box.abandon() { throw RunnerWedged("the main thread did not answer within \(Int(timeout)) s") }
            // The work started just before the deadline; take its result.
            done.wait()
            return try box.get()!.get()
        }
        return try result.get()
    }
}

/// The work's result, written by the queue's thread and read by the caller's.
private final class Box<T> {
    private let lock = NSLock()
    private var result: Result<T, Error>?
    private var state = 0  // 0 queued, 1 started, 2 abandoned

    /// False when the caller already abandoned the work.
    func start() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if state == 2 { return false }
        state = 1
        return true
    }

    /// True when the work never started and now never will.
    func abandon() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if state == 1 { return false }
        state = 2
        return true
    }

    func set(_ value: Result<T, Error>) {
        lock.lock()
        result = value
        lock.unlock()
    }

    func get() -> Result<T, Error>? {
        lock.lock()
        defer { lock.unlock() }
        return result
    }
}
