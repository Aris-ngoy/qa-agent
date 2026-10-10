import Foundation

/// Length-prefixed JSON: a 4-byte big-endian body length, then the UTF-8 body.
public enum Framing {
    /// Larger than any tree a screen holds; a bigger length means the stream is out of sync.
    public static let maxBody = 16 << 20

    public static func encode(_ body: Data) -> Data {
        let length = UInt32(body.count)
        return Data([UInt8(length >> 24), UInt8(length >> 16 & 0xFF), UInt8(length >> 8 & 0xFF), UInt8(length & 0xFF)]) + body
    }

    public struct OversizeError: Error, CustomStringConvertible {
        public let length: Int
        public var description: String { "frame of \(length) bytes is over the \(Framing.maxBody)-byte limit" }
    }
}

/// Splits a byte stream into frame bodies, whatever the chunk boundaries.
public struct FrameReader {
    private var buffered = Data()

    public init() {}

    /// The bodies completed by `chunk`, in order. Throws when a length is over the limit.
    public mutating func feed(_ chunk: Data) throws -> [Data] {
        buffered.append(chunk)
        var bodies: [Data] = []
        while buffered.count >= 4 {
            let header = [UInt8](buffered.prefix(4))
            let length = Int(header[0]) << 24 | Int(header[1]) << 16 | Int(header[2]) << 8 | Int(header[3])
            guard length <= Framing.maxBody else { throw Framing.OversizeError(length: length) }
            guard buffered.count >= 4 + length else { break }
            bodies.append(Data(buffered.dropFirst(4).prefix(length)))
            buffered = Data(buffered.dropFirst(4 + length))
        }
        return bodies
    }
}
