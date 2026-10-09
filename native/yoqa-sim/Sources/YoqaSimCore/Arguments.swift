/// `yoqa-sim ios --id <udid> [--device-set <path>]`
public struct Arguments: Equatable {
    public var udid: String
    public var deviceSet: String?

    public init(udid: String, deviceSet: String?) {
        self.udid = udid
        self.deviceSet = deviceSet
    }

    public struct UsageError: Error, CustomStringConvertible {
        public let description: String
    }

    public static let usage = "usage: yoqa-sim ios --id <udid> [--device-set <path>]"

    public static func parse(_ argv: [String]) throws -> Arguments {
        guard argv.first == "ios" else { throw UsageError(description: usage) }
        var udid: String?
        var deviceSet: String?
        var rest = argv.dropFirst()
        while let flag = rest.popFirst() {
            guard let value = rest.popFirst(), !value.isEmpty else {
                throw UsageError(description: "\(flag) needs a value\n\(usage)")
            }
            switch flag {
            case "--id": udid = value
            case "--device-set": deviceSet = value
            default: throw UsageError(description: "unknown option \(flag)\n\(usage)")
            }
        }
        guard let udid else { throw UsageError(description: usage) }
        return Arguments(udid: udid, deviceSet: deviceSet)
    }
}
