import AppKit
import SwiftUI

import AlisioSupport
struct InstancesSettings: View {
    var store: InstancesStore

    init(store: InstancesStore = .shared) {
        self.store = store
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            self.header
            if let err = store.lastError {
                Text("Error: \(err)")
                    .foregroundStyle(.red)
            } else if let info = store.statusMessage {
                Text(info)
                    .foregroundStyle(.secondary)
            }
            if self.store.instances.isEmpty {
                Text("No instances reported yet.")
                    .foregroundStyle(.secondary)
            } else {
                List(self.store.instances) { inst in
                    self.instanceRow(inst)
                }
                .listStyle(.inset)
            }
            Spacer()
        }
        .onAppear { self.store.start() }
        .onDisappear { self.store.stop() }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Connected Instances")
                    .font(.headline)
                Text("Latest presence beacons from Alisio nodes. Updated periodically.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            SettingsRefreshButton(isLoading: self.store.isLoading) {
                Task { await self.store.refresh() }
            }
        }
    }

    @ViewBuilder
    private func instanceRow(_ inst: InstanceInfo) -> some View {
        let isGateway = (inst.mode ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "gateway"
        let prettyPlatform = inst.platform.flatMap { self.prettyPlatform($0) }
        let device = DeviceModelCatalog.presentation(
            deviceFamily: inst.deviceFamily,
            modelIdentifier: inst.modelIdentifier)

        HStack(alignment: .top, spacing: 12) {
            self.leadingDeviceIcon(inst, device: device)
                .frame(width: 28, height: 28, alignment: .center)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(inst.host ?? "unknown host").font(.subheadline.bold())
                    self.presenceIndicator(inst)
                    if let ip = inst.ip { Text("(") + Text(ip).monospaced() + Text(")") }
                }

                HStack(spacing: 8) {
                    if let version = inst.version {
                        self.label(icon: "shippingbox", text: version)
                    }

                    if let device {
                        // Avoid showing generic device-family labels when a concrete model is available.
                        let family = (inst.deviceFamily ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                        let isGeneric = !family.isEmpty && device.title == family
                        if !isGeneric {
                            if let prettyPlatform {
                                self.label(icon: device.symbol, text: "\(device.title) · \(prettyPlatform)")
                            } else {
                                self.label(icon: device.symbol, text: device.title)
                            }
                        } else if let prettyPlatform, let platform = inst.platform {
                            self.label(icon: self.platformIcon(platform), text: prettyPlatform)
                        }
                    } else if let prettyPlatform, let platform = inst.platform {
                        self.label(icon: self.platformIcon(platform), text: prettyPlatform)
                    }

                    if let mode = inst.mode { self.label(icon: "network", text: mode) }
                }
                .layoutPriority(1)

                if !isGateway, self.shouldShowUpdateRow(inst) {
                    HStack(spacing: 8) {
                        Spacer(minLength: 0)

                        // Last local input is helpful for interactive nodes, but noisy/meaningless for the gateway.
                        if let secs = inst.lastInputSeconds {
                            self.label(icon: "clock", text: "\(secs)s ago")
                        }

                        if let update = self.updateSummaryText(inst, isGateway: isGateway) {
                            self.label(icon: "arrow.clockwise", text: update)
                                .help(self.presenceUpdateSourceHelp(inst.reason ?? ""))
                        }
                    }
                    .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 6)
        .help(inst.text)
        .contextMenu {
            Button("Copy Debug Summary") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(inst.text, forType: .string)
            }
        }
    }

    private func label(icon: String?, text: String) -> some View {
        HStack(spacing: 4) {
            if let icon {
                if self.isSystemSymbolAvailable(icon) {
                    Image(systemName: icon).foregroundStyle(.secondary).font(.caption)
                }
            }
            Text(text)
        }
        .font(.footnote)
    }

    private func presenceIndicator(_ inst: InstanceInfo) -> some View {
        let status = self.presenceStatus(for: inst)
        return HStack(spacing: 4) {
            Circle()
                .fill(status.color)
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
            Text(status.label)
                .foregroundStyle(.secondary)
        }
        .font(.caption)
        .help("Presence updated \(inst.ageDescription).")
        .accessibilityLabel("\(status.label) presence")
    }

    private func presenceStatus(for inst: InstanceInfo) -> (label: String, color: Color) {
        let nowMs = Date().timeIntervalSince1970 * 1000
        let ageSeconds = max(0, Int((nowMs - inst.ts) / 1000))
        if ageSeconds <= 120 { return ("Active", .green) }
        if ageSeconds <= 300 { return ("Idle", .yellow) }
        return ("Stale", .gray)
    }

    @ViewBuilder
    private func leadingDeviceIcon(_ inst: InstanceInfo, device: DevicePresentation?) -> some View {
        let symbol = self.leadingDeviceSymbol(inst, device: device)
        Image(systemName: symbol)
            .font(.system(size: 26, weight: .regular))
            .foregroundStyle(.secondary)
            .accessibilityHidden(true)
    }

    private func leadingDeviceSymbol(_ inst: InstanceInfo, device: DevicePresentation?) -> String {
        if let title = device?.title.lowercased() {
            if title.contains("mac studio") {
                return self.safeSystemSymbol("macstudio", fallback: "desktopcomputer")
            }
            if title.contains("macbook") {
                return self.safeSystemSymbol("laptopcomputer", fallback: "laptopcomputer")
            }
        }

        if let symbol = device?.symbol {
            return self.safeSystemSymbol(symbol, fallback: "cpu")
        }

        if let platform = inst.platform {
            return self.safeSystemSymbol(self.platformIcon(platform), fallback: "cpu")
        }

        return "cpu"
    }

    private func shouldShowUpdateRow(_ inst: InstanceInfo) -> Bool {
        if inst.lastInputSeconds != nil { return true }
        if self.updateSummaryText(inst, isGateway: false) != nil { return true }
        return false
    }

    private func safeSystemSymbol(_ preferred: String, fallback: String) -> String {
        if self.isSystemSymbolAvailable(preferred) { return preferred }
        return fallback
    }

    private func isSystemSymbolAvailable(_ name: String) -> Bool {
        NSImage(systemSymbolName: name, accessibilityDescription: nil) != nil
    }

    private func platformIcon(_ raw: String) -> String {
        let (prefix, _) = PlatformLabelFormatter.parse(raw)
        switch prefix {
        case "macos":
            return "laptopcomputer"
        default:
            return "cpu"
        }
    }

    private func prettyPlatform(_ raw: String) -> String? {
        PlatformLabelFormatter.pretty(raw)
    }

    private func presenceUpdateSourceShortText(_ reason: String) -> String? {
        let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        switch trimmed {
        case "self":
            return "Self"
        case "connect":
            return "Connect"
        case "disconnect":
            return "Disconnect"
        case "node-connected":
            return "Node connect"
        case "node-disconnected":
            return "Node disconnect"
        case "launch":
            return "Launch"
        case "periodic":
            return "Heartbeat"
        case "instances-refresh":
            return "Instances"
        case "seq gap":
            return "Resync"
        default:
            return trimmed
        }
    }

    private func updateSummaryText(_ inst: InstanceInfo, isGateway: Bool) -> String? {
        // For gateway rows, omit the "updated via/by" provenance entirely.
        if isGateway {
            return nil
        }

        let age = inst.ageDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !age.isEmpty else { return nil }

        let source = self.presenceUpdateSourceShortText(inst.reason ?? "")
        if let source, !source.isEmpty {
            return "\(age) · \(source)"
        }
        return age
    }

    private func presenceUpdateSourceHelp(_ reason: String) -> String {
        let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return "Why this presence entry was last updated (debug marker)."
        }
        return "Why this presence entry was last updated (debug marker). Raw: \(trimmed)"
    }
}

#if DEBUG
struct InstancesSettings_Previews: PreviewProvider {
    static var previews: some View {
        InstancesSettings(store: .preview())
            .frame(width: SettingsTab.windowWidth, height: SettingsTab.windowHeight)
    }
}
#endif
