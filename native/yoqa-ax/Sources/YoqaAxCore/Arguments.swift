/// `yoqa-ax --connect <socket>`
public struct Arguments: Equatable {
    public var socketPath: String

    public struct UsageError: Error, CustomStringConvertible {
        public let description: String
    }

    public static let usage = "usage: yoqa-ax --connect <socket>"

    public static func parse(_ argv: [String]) throws -> Arguments {
        var socketPath: String?
        var rest = argv[...]
        while let flag = rest.popFirst() {
            guard let value = rest.popFirst(), !value.isEmpty else {
                throw UsageError(description: "\(flag) needs a value\n\(usage)")
            }
            switch flag {
            case "--connect": socketPath = value
            default: throw UsageError(description: "unknown option \(flag)\n\(usage)")
            }
        }
        guard let socketPath else { throw UsageError(description: usage) }
        return Arguments(socketPath: socketPath)
    }
}
