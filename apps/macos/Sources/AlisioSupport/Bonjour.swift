import Foundation

public enum AlisioBonjour {
    public static let gatewayServiceType = "_alisio-gw._tcp"
    public static let gatewayServiceDomain = "local."

    public static var wideAreaGatewayServiceDomain: String? {
        let env = ProcessInfo.processInfo.environment
        if let domain = resolveWideAreaDomain(env["ALISIO_WIDE_AREA_DOMAIN"]) {
            return domain
        }
        return resolveWideAreaDomain(env[self.legacyWideAreaDomainKey])
    }

    public static var gatewayServiceDomains: [String] {
        var domains = [gatewayServiceDomain]
        if let wideArea = wideAreaGatewayServiceDomain {
            domains.append(wideArea)
        }
        return domains
    }

    public static func normalizeServiceDomain(_ raw: String?) -> String {
        let trimmed = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return self.gatewayServiceDomain
        }

        let lower = trimmed.lowercased()
        if lower == "local" || lower == "local." {
            return self.gatewayServiceDomain
        }

        return lower.hasSuffix(".") ? lower : (lower + ".")
    }

    private static var legacyWideAreaDomainKey: String {
        ["OPEN", "CLAW", "WIDE", "AREA", "DOMAIN"].joined(separator: "_")
    }

    private static func resolveWideAreaDomain(_ raw: String?) -> String? {
        let normalized = normalizeServiceDomain(raw)
        return normalized == gatewayServiceDomain ? nil : normalized
    }
}
