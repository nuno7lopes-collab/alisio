import AppKit
import Foundation
import Observation
import AlisioDiscovery
import os

import AlisioSupport
/// Manages Tailscale integration and status checking.
@Observable
@MainActor
final class TailscaleService {
    static let shared = TailscaleService()

    /// Tailscale local API endpoint.
    private static let tailscaleAPIEndpoint = "http://100.100.100.100/api/data"

    /// API request timeout in seconds.
    private static let apiTimeoutInterval: TimeInterval = 5.0

    private let logger = Logger(subsystem: AlisioBrand.logSubsystem, category: "tailscale")

    /// Indicates if the Tailscale app is installed on the system.
    private(set) var isInstalled = false

    /// Indicates if Tailscale is currently running.
    private(set) var isRunning = false

    /// The Tailscale hostname for this device (e.g., "my-mac.tailnet.ts.net").
    private(set) var tailscaleHostname: String?

    /// The Tailscale IPv4 address for this device.
    private(set) var tailscaleIP: String?

    private init() {}

    #if DEBUG
    init(
        isInstalled: Bool,
        isRunning: Bool,
        tailscaleHostname: String? = nil,
        tailscaleIP: String? = nil)
    {
        self.isInstalled = isInstalled
        self.isRunning = isRunning
        self.tailscaleHostname = tailscaleHostname
        self.tailscaleIP = tailscaleIP
    }
    #endif

    private func checkAppInstallation() -> Bool {
        FileManager().fileExists(atPath: "/Applications/Tailscale.app")
    }

    private struct TailscaleAPIResponse: Codable {
        let status: String
        let deviceName: String
        let tailnetName: String
        let iPv4: String?

        private enum CodingKeys: String, CodingKey {
            case status = "Status"
            case deviceName = "DeviceName"
            case tailnetName = "TailnetName"
            case iPv4 = "IPv4"
        }
    }

    private func fetchTailscaleStatus() async -> TailscaleAPIResponse? {
        guard let url = URL(string: Self.tailscaleAPIEndpoint) else {
            self.logger.error("Invalid Tailscale API URL")
            return nil
        }

        do {
            let configuration = URLSessionConfiguration.default
            configuration.timeoutIntervalForRequest = Self.apiTimeoutInterval
            let session = URLSession(configuration: configuration)

            let (data, response) = try await session.data(from: url)
            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200
            else {
                self.logger.debug("tailscale API returned a non-200 status")
                return nil
            }

            let decoder = JSONDecoder()
            return try decoder.decode(TailscaleAPIResponse.self, from: data)
        } catch {
            self.logger.debug("Failed to fetch Tailscale status: \(String(describing: error))")
            return nil
        }
    }

    func checkTailscaleStatus() async {
        let previousIP = self.tailscaleIP
        self.isInstalled = self.checkAppInstallation()
        if !self.isInstalled {
            self.isRunning = false
            self.tailscaleHostname = nil
            self.tailscaleIP = nil
        } else if let apiResponse = await fetchTailscaleStatus() {
            self.isRunning = apiResponse.status.lowercased() == "running"

            if self.isRunning {
                let deviceName = apiResponse.deviceName
                    .lowercased()
                    .replacingOccurrences(of: " ", with: "-")
                let tailnetName = apiResponse.tailnetName
                    .replacingOccurrences(of: ".ts.net", with: "")
                    .replacingOccurrences(of: ".tailscale.net", with: "")

                self.tailscaleHostname = "\(deviceName).\(tailnetName).ts.net"
                self.tailscaleIP = apiResponse.iPv4

                self.logger.debug(
                    "tailscale running host=\(self.tailscaleHostname ?? "nil") ip=\(self.tailscaleIP ?? "nil")")
            } else {
                self.tailscaleHostname = nil
                self.tailscaleIP = nil
            }
        } else {
            self.isRunning = false
            self.tailscaleHostname = nil
            self.tailscaleIP = nil
            self.logger.debug("tailscale API unavailable; leaving integration idle")
        }

        if self.tailscaleIP == nil, let fallback = TailscaleNetwork.detectTailnetIPv4() {
            self.tailscaleIP = fallback
            if !self.isRunning {
                self.isRunning = true
            }
            self.logger.debug("tailscale interface IP detected via fallback ip=\(fallback, privacy: .public)")
        }

        if previousIP != self.tailscaleIP {
            await GatewayEndpointStore.shared.refresh()
        }
    }

    func openTailscaleApp() {
        if let url = URL(string: "file:///Applications/Tailscale.app") {
            NSWorkspace.shared.open(url)
        }
    }

    func openAppStore() {
        if let url = URL(string: "https://apps.apple.com/us/app/tailscale/id1475387142") {
            NSWorkspace.shared.open(url)
        }
    }

    func openDownloadPage() {
        if let url = URL(string: "https://tailscale.com/download/macos") {
            NSWorkspace.shared.open(url)
        }
    }

    func openSetupGuide() {
        if let url = URL(string: "https://tailscale.com/kb/1017/install/") {
            NSWorkspace.shared.open(url)
        }
    }

    nonisolated static func fallbackTailnetIPv4() -> String? {
        TailscaleNetwork.detectTailnetIPv4()
    }
}
