import Foundation

public enum UnixSocket {
    public struct Failure: Error, CustomStringConvertible {
        public let description: String
    }

    public static func address(_ path: String) throws -> sockaddr_un {
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8CString)
        guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else {
            throw Failure(description: "socket path is too long: \(path)")
        }
        withUnsafeMutableBytes(of: &address.sun_path) { buffer in
            bytes.withUnsafeBytes { buffer.copyMemory(from: $0) }
        }
        return address
    }

    /// Connect to the runner's socket.
    public static func connect(_ path: String) throws -> Int32 {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw Failure(description: "socket: \(String(cString: strerror(errno)))") }
        var address = try self.address(path)
        let result = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Foundation.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard result == 0 else {
            let reason = String(cString: strerror(errno))
            close(fd)
            throw Failure(description: "connect \(path): \(reason)")
        }
        return fd
    }

    /// Answer requests on `fd` one at a time until the runner closes it.
    public static func serve(_ fd: Int32, handler: Handler = Handler()) throws {
        var reader = FrameReader()
        var chunk = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            let count = read(fd, &chunk, chunk.count)
            if count == 0 { return }
            if count < 0 {
                if errno == EINTR { continue }
                throw Failure(description: "read: \(String(cString: strerror(errno)))")
            }
            for request in try reader.feed(Data(chunk[0..<count])) {
                try writeAll(fd, Framing.encode(handler.respond(to: request)))
            }
        }
    }

    private static func writeAll(_ fd: Int32, _ data: Data) throws {
        try data.withUnsafeBytes { buffer in
            var offset = 0
            while offset < buffer.count {
                let written = write(fd, buffer.baseAddress! + offset, buffer.count - offset)
                if written < 0 {
                    if errno == EINTR { continue }
                    throw Failure(description: "write: \(String(cString: strerror(errno)))")
                }
                offset += written
            }
        }
    }
}
