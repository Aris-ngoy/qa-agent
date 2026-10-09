import Foundation

public struct SocketError: Error, CustomStringConvertible {
    public let description: String

    init(_ call: String) {
        description = "\(call): \(String(cString: strerror(errno)))"
    }
}

/// How long a connection may take to send its request head.
private let requestTimeoutSeconds = 5

/// How long a write may block on a client that stopped reading, before it is dropped.
private let writeTimeoutSeconds = 5

/// A blocking HTTP listener on 127.0.0.1 only, one request per connection.
public final class LoopbackServer {
    public let port: UInt16
    private let socket: Int32

    public init() throws {
        let fd = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { throw SocketError("socket") }
        var address = sockaddr_in()
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = 0
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        let bound = withUnsafeMutablePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { generic -> Bool in
                Darwin.bind(fd, generic, length) == 0 && Darwin.listen(fd, 16) == 0 && getsockname(fd, generic, &length) == 0
            }
        }
        guard bound else {
            let error = SocketError("bind 127.0.0.1")
            close(fd)
            throw error
        }
        socket = fd
        port = UInt16(bigEndian: address.sin_port)
    }

    /// Accept forever on a background thread; each connection is handled concurrently.
    public func serve(_ handle: @escaping (HTTPRequest?) -> Response) {
        let queue = DispatchQueue(label: "yoqa-sim.connections", attributes: .concurrent)
        Thread.detachNewThread { [socket] in
            while true {
                let client = accept(socket, nil, nil)
                if client < 0 {
                    // Out of descriptors or interrupted: back off instead of spinning.
                    usleep(10_000)
                    continue
                }
                var yes: Int32 = 1
                setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &yes, socklen_t(MemoryLayout<Int32>.size))
                var timeout = timeval(tv_sec: requestTimeoutSeconds, tv_usec: 0)
                setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
                var writeTimeout = timeval(tv_sec: writeTimeoutSeconds, tv_usec: 0)
                setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, &writeTimeout, socklen_t(MemoryLayout<timeval>.size))
                queue.async {
                    defer { close(client) }
                    let response = handle(HTTPRequest.parse(readRequest(client)))
                    guard writeAll(client, response.serialized()), let stream = response.stream else { return }
                    stream { writeAll(client, $0) }
                }
            }
        }
    }
}

/// The request head, then its body up to `Content-Length` (bodies are small JSON).
private func readRequest(_ fd: Int32) -> Data {
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    let end = Data("\r\n\r\n".utf8)
    while data.count < 65_536 {
        if let headEnd = data.range(of: end) {
            let length = min(HTTPRequest.contentLength(ofHead: data[..<headEnd.lowerBound]), 65_536)
            if data.count - headEnd.upperBound >= length { break }
        }
        let count = read(fd, &buffer, buffer.count)
        if count <= 0 { break }
        data.append(buffer, count: count)
    }
    return data
}

/// False when the client is gone (or stopped reading for `writeTimeoutSeconds`).
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
