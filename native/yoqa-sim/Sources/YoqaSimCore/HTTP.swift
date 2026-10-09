import Foundation

/// The first line of one HTTP request. Bodies are not read; no route takes one yet.
public struct HTTPRequest: Equatable {
    public var method: String
    public var path: String

    public static func parse(_ head: Data) -> HTTPRequest? {
        let text = String(decoding: head, as: UTF8.self)
        let parts = (text.components(separatedBy: "\r\n").first ?? "").split(separator: " ")
        guard parts.count == 3, parts[2].hasPrefix("HTTP/") else { return nil }
        let target = String(parts[1])
        let path = target.split(separator: "?", maxSplits: 1).first.map(String.init) ?? target
        return HTTPRequest(method: String(parts[0]), path: path)
    }
}

public struct Response: Equatable {
    public var status: Int
    public var contentType: String
    public var body: Data

    public init(status: Int, contentType: String, body: Data) {
        self.status = status
        self.contentType = contentType
        self.body = body
    }

    static func json(_ status: Int, _ fields: KeyValuePairs<String, String>) -> Response {
        let members = fields.map { "\(jsonString($0.key)):\(jsonString($0.value))" }
        return Response(status: status, contentType: "application/json", body: Data("{\(members.joined(separator: ","))}".utf8))
    }

    private static let reasons = [200: "OK", 400: "Bad Request", 404: "Not Found", 500: "Internal Server Error"]

    public func serialized() -> Data {
        var data = Data((
            "HTTP/1.1 \(status) \(Self.reasons[status] ?? "Status")\r\n" +
            "Content-Type: \(contentType)\r\n" +
            "Content-Length: \(body.count)\r\n" +
            "Connection: close\r\n\r\n"
        ).utf8)
        data.append(body)
        return data
    }
}

private func jsonString(_ value: String) -> String {
    let data = (try? JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed)) ?? Data("\"\"".utf8)
    return String(decoding: data, as: UTF8.self)
}

public struct Status {
    public var udid: String
    public var simulatorKit: String

    public init(udid: String, simulatorKit: String) {
        self.udid = udid
        self.simulatorKit = simulatorKit
    }
}

/// The control API. `GET /screenshot` is a full-size PNG; the runner scales it.
public func route(_ request: HTTPRequest?, status: Status, screenshot: () throws -> Data) -> Response {
    guard let request else { return .json(400, ["error": "bad request"]) }
    switch (request.method, request.path) {
    case ("GET", "/status"):
        return .json(200, ["udid": status.udid, "simulatorKit": status.simulatorKit])
    case ("GET", "/screenshot"):
        do {
            return Response(status: 200, contentType: "image/png", body: try screenshot())
        } catch {
            return .json(500, ["error": String(describing: error)])
        }
    default:
        return .json(404, ["error": "not found"])
    }
}
