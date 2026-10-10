import Foundation

/// One HTTP request: method, path and body (read up to its `Content-Length`).
public struct HTTPRequest {
    public var method: String
    public var path: String
    public var body: Data

    public static func parse(_ raw: Data) -> HTTPRequest? {
        let separator = Data("\r\n\r\n".utf8)
        guard let headEnd = raw.range(of: separator) else { return nil }
        let head = String(decoding: raw[..<headEnd.lowerBound], as: UTF8.self)
        let parts = (head.components(separatedBy: "\r\n").first ?? "").split(separator: " ")
        guard parts.count == 3, parts[2].hasPrefix("HTTP/") else { return nil }
        let path = URLComponents(string: String(parts[1]))?.path ?? String(parts[1])
        return HTTPRequest(method: String(parts[0]), path: path, body: Data(raw[headEnd.upperBound...]))
    }

    static func contentLength(ofHead head: Data) -> Int {
        let text = String(decoding: head, as: UTF8.self).lowercased()
        for line in text.components(separatedBy: "\r\n") where line.hasPrefix("content-length:") {
            return Int(line.dropFirst("content-length:".count).trimmingCharacters(in: .whitespaces)) ?? 0
        }
        return 0
    }
}

public struct HTTPResponse {
    public var status: Int
    public var body: Data

    public init(status: Int, body: Data) {
        self.status = status
        self.body = body
    }

    public static func json(_ status: Int, _ object: [String: Any]) -> HTTPResponse {
        let body = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{}".utf8)
        return HTTPResponse(status: status, body: body)
    }

    private static let reasons = [200: "OK", 400: "Bad Request", 404: "Not Found", 405: "Method Not Allowed", 409: "Conflict", 500: "Internal Server Error"]

    func serialized() -> Data {
        var data = Data((
            "HTTP/1.1 \(status) \(Self.reasons[status] ?? "Status")\r\n" +
            "Content-Type: application/json\r\n" +
            "Content-Length: \(body.count)\r\n" +
            "Connection: close\r\n\r\n"
        ).utf8)
        data.append(body)
        return data
    }
}

public struct SocketError: Error, CustomStringConvertible {
    public let description: String

    init(_ call: String) {
        description = "\(call): \(String(cString: strerror(errno)))"
    }
}

/// How long a connection may take to send its request, and a write may block.
private let socketTimeoutSeconds = 5

/// A blocking HTTP listener on 127.0.0.1 only, one request per connection. Port 0 takes a
/// system port; `port` is the one actually bound.
public final class HTTPServer {
    public let port: UInt16
    private let socket: Int32
    private let stopped = NSLock()
    private var isStopped = false

    public init(port requested: UInt16) throws {
        let fd = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { throw SocketError("socket") }
        var yes: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
        var address = sockaddr_in()
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = requested.bigEndian
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        let bound = withUnsafeMutablePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { generic -> Bool in
                Darwin.bind(fd, generic, length) == 0 && Darwin.listen(fd, 16) == 0 && getsockname(fd, generic, &length) == 0
            }
        }
        guard bound else {
            let error = SocketError("bind 127.0.0.1:\(requested)")
            close(fd)
            throw error
        }
        socket = fd
        port = UInt16(bigEndian: address.sin_port)
    }

    /// Accept forever on a background thread; each connection is handled concurrently.
    public func serve(_ handle: @escaping (HTTPRequest?) -> HTTPResponse) {
        let queue = DispatchQueue(label: "yoqa-runner.connections", attributes: .concurrent)
        Thread.detachNewThread { [socket, weak self] in
            while true {
                let client = accept(socket, nil, nil)
                if client < 0 {
                    if !(self?.isListening ?? false) { return }
                    // Out of descriptors or interrupted: back off instead of spinning.
                    usleep(10_000)
                    continue
                }
                var yes: Int32 = 1
                setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &yes, socklen_t(MemoryLayout<Int32>.size))
                var timeout = timeval(tv_sec: socketTimeoutSeconds, tv_usec: 0)
                setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
                setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
                queue.async {
                    defer { close(client) }
                    _ = writeAll(client, handle(HTTPRequest.parse(readRequest(client))).serialized())
                }
            }
        }
    }

    /// Close the listener; the accept loop ends and the port is free again.
    public func stop() {
        stopped.lock()
        defer { stopped.unlock() }
        guard !isStopped else { return }
        isStopped = true
        close(socket)
    }

    /// True until `stop()`. The runner's test method waits on it.
    public var isListening: Bool {
        stopped.lock()
        defer { stopped.unlock() }
        return !isStopped
    }
}

/// The request head, then its body up to `Content-Length` (bodies are small JSON).
private func readRequest(_ fd: Int32) -> Data {
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    let end = Data("\r\n\r\n".utf8)
    while data.count < 1_048_576 {
        if let headEnd = data.range(of: end) {
            let length = min(HTTPRequest.contentLength(ofHead: data[..<headEnd.lowerBound]), 1_048_576)
            if data.count - headEnd.upperBound >= length { break }
        }
        let count = read(fd, &buffer, buffer.count)
        if count <= 0 { break }
        data.append(buffer, count: count)
    }
    return data
}

private func writeAll(_ fd: Int32, _ data: Data) -> Bool {
    data.withUnsafeBytes { raw in
        guard var pointer = raw.baseAddress else { return true }
        var remaining = raw.count
        while remaining > 0 {
            let written = write(fd, pointer, remaining)
            if written <= 0 { return false }
            pointer += written
            remaining -= written
        }
        return true
    }
}
