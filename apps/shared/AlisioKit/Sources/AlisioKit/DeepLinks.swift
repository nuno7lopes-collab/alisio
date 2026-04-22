import Foundation

public enum DeepLinkRoute: Sendable, Equatable {
    case agent(AgentDeepLink)
    case accountAuth(AccountAuthDeepLink)
    case gateway(GatewayConnectDeepLink)
}

public enum AccountAuthDeepLink: Sendable, Equatable {
    case emailLink(AccountEmailLinkDeepLink)
    case googleCallback(AccountGoogleAuthCallbackDeepLink)
}

public struct AccountEmailLinkDeepLink: Codable, Sendable, Equatable {
    public let accessToken: String
    public let refreshToken: String?
    public let expiresIn: Int?
    public let tokenType: String?

    public init(
        accessToken: String,
        refreshToken: String?,
        expiresIn: Int?,
        tokenType: String?)
    {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresIn = expiresIn
        self.tokenType = tokenType
    }
}

public struct AccountGoogleAuthCallbackDeepLink: Codable, Sendable, Equatable {
    public let stateToken: String?
    public let code: String?
    public let error: String?
    public let errorDescription: String?

    public init(
        stateToken: String?,
        code: String?,
        error: String?,
        errorDescription: String?)
    {
        self.stateToken = stateToken
        self.code = code
        self.error = error
        self.errorDescription = errorDescription
    }
}

public struct GatewayConnectDeepLink: Codable, Sendable, Equatable {
    public let host: String
    public let port: Int
    public let tls: Bool
    public let bootstrapToken: String?
    public let token: String?
    public let password: String?

    public init(host: String, port: Int, tls: Bool, bootstrapToken: String?, token: String?, password: String?) {
        self.host = host
        self.port = port
        self.tls = tls
        self.bootstrapToken = bootstrapToken
        self.token = token
        self.password = password
    }

    public var websocketURL: URL? {
        let scheme = self.tls ? "wss" : "ws"
        return URL(string: "\(scheme)://\(self.host):\(self.port)")
    }

    /// Parse a device-pair setup code (base64url-encoded JSON: `{url, bootstrapToken?, token?, password?}`).
    public static func fromSetupCode(_ code: String) -> GatewayConnectDeepLink? {
        guard let data = Self.decodeBase64Url(code) else { return nil }
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        guard let urlString = json["url"] as? String,
              let parsed = URLComponents(string: urlString),
              let hostname = parsed.host, !hostname.isEmpty
        else { return nil }

        let scheme = (parsed.scheme ?? "ws").lowercased()
        guard scheme == "ws" || scheme == "wss" else { return nil }
        let tls = scheme == "wss"
        if !tls, !LoopbackHost.isLoopbackHost(hostname) {
            return nil
        }
        let port = parsed.port ?? (tls ? 443 : GatewayDefaults.defaultPort)
        let bootstrapToken = json["bootstrapToken"] as? String
        let token = json["token"] as? String
        let password = json["password"] as? String
        return GatewayConnectDeepLink(
            host: hostname,
            port: port,
            tls: tls,
            bootstrapToken: bootstrapToken,
            token: token,
            password: password)
    }

    private static func decodeBase64Url(_ input: String) -> Data? {
        var base64 = input
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder > 0 {
            base64.append(contentsOf: String(repeating: "=", count: 4 - remainder))
        }
        return Data(base64Encoded: base64)
    }
}

public struct AgentDeepLink: Codable, Sendable, Equatable {
    public let message: String
    public let sessionKey: String?
    public let thinking: String?
    public let deliver: Bool
    public let to: String?
    public let channel: String?
    public let timeoutSeconds: Int?
    public let key: String?

    public init(
        message: String,
        sessionKey: String?,
        thinking: String?,
        deliver: Bool,
        to: String?,
        channel: String?,
        timeoutSeconds: Int?,
        key: String?)
    {
        self.message = message
        self.sessionKey = sessionKey
        self.thinking = thinking
        self.deliver = deliver
        self.to = to
        self.channel = channel
        self.timeoutSeconds = timeoutSeconds
        self.key = key
    }
}

public enum DeepLinkParser {
    public static func parse(_ url: URL) -> DeepLinkRoute? {
        guard let scheme = url.scheme?.lowercased(),
              scheme == AlisioBranding.deepLinkScheme
        else {
            return nil
        }
        guard let host = url.host?.lowercased(), !host.isEmpty else { return nil }
        guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let query = self.parameters(from: comps)

        switch host {
        case "agent":
            guard let message = query["message"],
                  !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else {
                return nil
            }
            let deliver = (query["deliver"] as NSString?)?.boolValue ?? false
            let timeoutSeconds = query["timeoutSeconds"].flatMap { Int($0) }.flatMap { $0 >= 0 ? $0 : nil }
            return .agent(
                .init(
                    message: message,
                    sessionKey: query["sessionKey"],
                    thinking: query["thinking"],
                    deliver: deliver,
                    to: query["to"],
                    channel: query["channel"],
                    timeoutSeconds: timeoutSeconds,
                    key: query["key"]))

        case "auth":
            guard comps.path == "/account/callback" else {
                return nil
            }
            if let accessToken = query["access_token"]?.trimmingCharacters(in: .whitespacesAndNewlines),
               !accessToken.isEmpty
            {
                let refreshToken = query["refresh_token"]?.trimmingCharacters(in: .whitespacesAndNewlines)
                let tokenType = query["token_type"]?.trimmingCharacters(in: .whitespacesAndNewlines)
                let expiresIn = query["expires_in"].flatMap(Int.init).flatMap { $0 > 0 ? $0 : nil }
                return .accountAuth(
                    .emailLink(
                        .init(
                            accessToken: accessToken,
                            refreshToken: refreshToken?.isEmpty == false ? refreshToken : nil,
                            expiresIn: expiresIn,
                            tokenType: tokenType?.isEmpty == false ? tokenType : nil)))
            }

            let provider = query["provider"]?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let stateToken = query["account_state"]?.trimmingCharacters(in: .whitespacesAndNewlines)
            let code = query["code"]?.trimmingCharacters(in: .whitespacesAndNewlines)
            let error = query["error"]?.trimmingCharacters(in: .whitespacesAndNewlines)
            let errorDescription = query["error_description"]?.trimmingCharacters(
                in: .whitespacesAndNewlines)
            let hasGoogleCallbackPayload =
                provider == "google" ||
                stateToken?.isEmpty == false ||
                code?.isEmpty == false ||
                error?.isEmpty == false
            guard hasGoogleCallbackPayload else {
                return nil
            }
            return .accountAuth(
                .googleCallback(
                    .init(
                        stateToken: stateToken?.isEmpty == false ? stateToken : nil,
                        code: code?.isEmpty == false ? code : nil,
                        error: error?.isEmpty == false ? error : nil,
                        errorDescription: errorDescription?.isEmpty == false ? errorDescription : nil)))

        case "gateway":
            guard let hostParam = query["host"],
                  !hostParam.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else {
                return nil
            }
            let port = query["port"].flatMap { Int($0) } ?? GatewayDefaults.defaultPort
            let tls = (query["tls"] as NSString?)?.boolValue ?? false
            if !tls, !LoopbackHost.isLoopbackHost(hostParam) {
                return nil
            }
            return .gateway(
                .init(
                    host: hostParam,
                    port: port,
                    tls: tls,
                    bootstrapToken: nil,
                    token: query["token"],
                    password: query["password"]))

        default:
            return nil
        }
    }

    private static func parameters(from components: URLComponents) -> [String: String] {
        var query: [String: String] = [:]
        for item in components.queryItems ?? [] {
            guard let value = item.value else { continue }
            query[item.name] = value
        }
        guard let fragment = components.fragment, !fragment.isEmpty,
              let fragmentComponents = URLComponents(string: "scheme://host?\(fragment)")
        else {
            return query
        }
        for item in fragmentComponents.queryItems ?? [] {
            guard let value = item.value else { continue }
            query[item.name] = value
        }
        return query
    }
}
