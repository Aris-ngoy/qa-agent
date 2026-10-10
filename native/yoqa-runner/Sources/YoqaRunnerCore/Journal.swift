import Foundation

/// The last `capacity` mutating commands by `commandId`, with their replies once they finish.
/// When a reply is lost on the cable, the Mac asks `status` about the command id instead of
/// sending the gesture again; a repeated id is answered from here and never fires twice.
public final class Journal {
    public enum Entry {
        case pending
        case done(HTTPResponse)
    }

    private let capacity: Int
    private let lock = NSLock()
    private var entries: [String: Entry] = [:]
    private var order: [String] = []

    public init(capacity: Int = 64) {
        self.capacity = capacity
    }

    /// Records `id` as pending and returns nil, or returns what is already recorded for it.
    func begin(_ id: String) -> Entry? {
        lock.lock()
        defer { lock.unlock() }
        if let existing = entries[id] { return existing }
        entries[id] = .pending
        order.append(id)
        if order.count > capacity {
            entries[order.removeFirst()] = nil
        }
        return nil
    }

    func finish(_ id: String, _ response: HTTPResponse) {
        lock.lock()
        defer { lock.unlock() }
        // Evicted while it ran (`capacity` newer commands): there is nothing left to update.
        if entries[id] != nil { entries[id] = .done(response) }
    }

    func lookup(_ id: String) -> Entry? {
        lock.lock()
        defer { lock.unlock() }
        return entries[id]
    }
}
