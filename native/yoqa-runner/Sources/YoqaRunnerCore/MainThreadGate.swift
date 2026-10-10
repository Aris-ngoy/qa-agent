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
            box.set(Result { try work() })
            done.signal()
        }
        guard done.wait(timeout: .now() + timeout) == .success, let result = box.get() else {
            throw RunnerWedged("the main thread did not answer within \(Int(timeout)) s")
        }
        return try result.get()
    }
}

/// The work's result, written by the queue's thread and read by the caller's.
private final class Box<T> {
    private let lock = NSLock()
    private var result: Result<T, Error>?

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
