import Foundation

public enum GatewayAddressError: LocalizedError {
    case invalidAddress
    case endpointInsteadOfBase

    public var errorDescription: String? {
        switch self {
        case .invalidAddress:
            return "请填写有效的 HTTPS 网关地址，不要包含账号、密码、查询参数或 #。"
        case .endpointInsteadOfBase:
            return "请填写网关根地址，不要带 /healthz 或 /v1/... 接口路径。"
        }
    }
}

public enum GatewayConfiguration {
    public static let defaultsKey = "MotoGPS.GatewayBaseURL.v1"

    public static func normalizedURL(_ input: String) throws -> URL {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !value.contains(where: { $0.isWhitespace }),
              var parts = URLComponents(string: value),
              parts.scheme?.lowercased() == "https",
              let host = parts.host, !host.isEmpty,
              host.lowercased() != "example.invalid", !host.lowercased().hasSuffix(".invalid"),
              parts.user == nil, parts.password == nil,
              parts.query == nil, parts.fragment == nil,
              parts.port.map({ (1 ... 65535).contains($0) }) ?? true,
              !parts.path.split(separator: "/").contains(where: { $0 == "." || $0 == ".." })
        else { throw GatewayAddressError.invalidAddress }
        let components = parts.path.split(separator: "/")
        guard components.last != "healthz", !components.contains("v1") else {
            throw GatewayAddressError.endpointInsteadOfBase
        }
        parts.scheme = "https"
        parts.host = host.lowercased()
        if !parts.path.hasSuffix("/") { parts.path += "/" }
        guard let url = parts.url else { throw GatewayAddressError.invalidAddress }
        return url
    }

    public static func resolvedURL(defaults: UserDefaults = .standard, bundledAddress: String?) -> URL? {
        if let saved = defaults.string(forKey: defaultsKey), let url = try? normalizedURL(saved) {
            return url
        }
        return bundledAddress.flatMap { try? normalizedURL($0) }
    }

    @discardableResult
    public static func save(_ address: String, defaults: UserDefaults = .standard) throws -> URL {
        let url = try normalizedURL(address)
        defaults.set(url.absoluteString, forKey: defaultsKey)
        return url
    }
}
