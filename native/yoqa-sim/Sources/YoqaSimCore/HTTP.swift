import Foundation

/// One HTTP request: method, path, query and body (read up to its `Content-Length`).
public struct HTTPRequest {
    public var method: String
    public var path: String
    public var query: [String: String]
    public var body: Data

    public static func parse(_ raw: Data) -> HTTPRequest? {
        let separator = Data("\r\n\r\n".utf8)
        let headEnd = raw.range(of: separator)
        let head = String(decoding: headEnd.map { raw[..<$0.lowerBound] } ?? raw, as: UTF8.self)
        let parts = (head.components(separatedBy: "\r\n").first ?? "").split(separator: " ")
        guard parts.count == 3, parts[2].hasPrefix("HTTP/") else { return nil }
        let target = URLComponents(string: String(parts[1]))
        var query: [String: String] = [:]
        for item in target?.queryItems ?? [] { query[item.name] = item.value ?? "" }
        let body = headEnd.map { raw[$0.upperBound...] } ?? Data()
        return HTTPRequest(method: String(parts[0]), path: target?.path ?? String(parts[1]), query: query, body: Data(body))
    }

    /// The declared body length, from the request head.
    static func contentLength(ofHead head: Data) -> Int {
        let text = String(decoding: head, as: UTF8.self).lowercased()
        for line in text.components(separatedBy: "\r\n") where line.hasPrefix("content-length:") {
            return Int(line.dropFirst("content-length:".count).trimmingCharacters(in: .whitespaces)) ?? 0
        }
        return 0
    }
}

public struct Response {
    public var status: Int
    public var contentType: String
    public var body: Data
    public var headers: [String: String]

    public init(status: Int, contentType: String, body: Data, headers: [String: String] = [:]) {
        self.status = status
        self.contentType = contentType
        self.body = body
        self.headers = headers
    }

    static func json(_ status: Int, _ object: [String: Any]) -> Response {
        let body = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{}".utf8)
        return Response(status: status, contentType: "application/json", body: body)
    }

    static func error(_ status: Int, _ message: String) -> Response {
        json(status, ["error": message])
    }

    private static let reasons = [200: "OK", 400: "Bad Request", 404: "Not Found", 500: "Internal Server Error", 503: "Service Unavailable"]

    public func serialized() -> Data {
        let extra = headers.keys.sorted().map { "\($0): \(headers[$0]!)\r\n" }.joined()
        var data = Data((
            "HTTP/1.1 \(status) \(Self.reasons[status] ?? "Status")\r\n" +
            "Content-Type: \(contentType)\r\n" +
            "Content-Length: \(body.count)\r\n" +
            extra +
            "Connection: close\r\n\r\n"
        ).utf8)
        data.append(body)
        return data
    }
}
