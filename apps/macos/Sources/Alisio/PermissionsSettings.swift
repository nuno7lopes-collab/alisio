import CoreLocation
import AlisioIPC
import SwiftUI

import AlisioSupport
struct PermissionsSettings: View {
    let status: [Capability: Bool]
    let refresh: () async -> Void
    let openSetup: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                PermissionSectionCard(
                    title: "System run access",
                    subtitle: "Control how much command access agents can get on this Mac.")
                {
                    SystemRunSettingsView()
                }

                PermissionSectionCard(
                    title: "macOS permissions",
                    subtitle: "Turn on only the capabilities you plan to use.")
                {
                    PermissionStatusList(status: self.status, refresh: self.refresh)
                }

                PermissionSectionCard(
                    title: "Location sharing",
                    subtitle: "Choose when location can be used and whether it should be precise.")
                {
                    LocationAccessSettings()
                }

                HStack {
                    Spacer(minLength: 0)
                    Button("Open setup") { self.openSetup() }
                        .buttonStyle(.bordered)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct PermissionSectionCard<Content: View>: View {
    let title: String
    let subtitle: String?
    private let content: Content

    init(
        title: String,
        subtitle: String? = nil,
        @ViewBuilder content: () -> Content)
    {
        self.title = title
        self.subtitle = subtitle
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(self.title)
                    .font(.headline)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            self.content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color(nsColor: .controlBackgroundColor))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(Color.primary.opacity(0.06), lineWidth: 1)))
    }
}

private struct LocationAccessSettings: View {
    @AppStorage(locationModeKey) private var locationModeRaw: String = AlisioLocationMode.off.rawValue
    @AppStorage(locationPreciseKey) private var locationPreciseEnabled: Bool = true
    @State private var lastLocationModeRaw: String = AlisioLocationMode.off.rawValue

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("Location access", selection: self.$locationModeRaw) {
                Text("Off").tag(AlisioLocationMode.off.rawValue)
                Text("While Using").tag(AlisioLocationMode.whileUsing.rawValue)
                Text("Always").tag(AlisioLocationMode.always.rawValue)
            }
            .pickerStyle(.segmented)

            Toggle("Precise location", isOn: self.$locationPreciseEnabled)
                .disabled(self.locationMode == .off)

            VStack(alignment: .leading, spacing: 4) {
                Text("macOS access: \(self.systemAccessLabel)")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)

                Text(self.guidanceText)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if self.shouldShowOpenSettingsButton {
                Button("Open System Settings") {
                    LocationPermissionHelper.openSettings()
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
        }
        .onAppear {
            self.lastLocationModeRaw = self.locationModeRaw
        }
        .onChange(of: self.locationModeRaw) { _, newValue in
            let previous = self.lastLocationModeRaw
            self.lastLocationModeRaw = newValue
            guard let mode = AlisioLocationMode(rawValue: newValue) else { return }
            Task {
                let granted = await self.requestLocationAuthorization(mode: mode)
                if !granted {
                    await MainActor.run {
                        self.locationModeRaw = previous
                        self.lastLocationModeRaw = previous
                    }
                }
            }
        }
    }

    private var locationMode: AlisioLocationMode {
        AlisioLocationMode(rawValue: self.locationModeRaw) ?? .off
    }

    private var authorizationStatus: CLAuthorizationStatus {
        CLLocationManager().authorizationStatus
    }

    private var systemAccessLabel: String {
        guard CLLocationManager.locationServicesEnabled() else {
            return "Location Services off"
        }

        switch self.authorizationStatus {
        case .authorizedAlways:
            return "Always"
        case .authorizedWhenInUse, .authorized:
            return "While Using"
        case .notDetermined:
            return "Not granted"
        case .denied, .restricted:
            return "Blocked"
        @unknown default:
            return "Unknown"
        }
    }

    private var guidanceText: String {
        guard CLLocationManager.locationServicesEnabled() else {
            return "Turn on Location Services in macOS before using location here."
        }

        switch self.locationMode {
        case .off:
            return "Location sharing is off."
        case .whileUsing:
            if PermissionManager.isLocationAuthorized(status: self.authorizationStatus, mode: .whileUsing) {
                return self.locationPreciseEnabled
                    ? "Alisio can use your location while the app is active."
                    : "Alisio can share an approximate location while the app is active."
            }
            return "Allow location in macOS to use this while the app is open."
        case .always:
            if PermissionManager.isLocationAuthorized(status: self.authorizationStatus, mode: .always) {
                return "Alisio can keep using location even when the app is not frontmost."
            }
            if PermissionManager.isLocationAuthorized(status: self.authorizationStatus, mode: .whileUsing) {
                return "macOS is currently allowing only While Using. Open System Settings to restore Always."
            }
            return "Allow Always in macOS if you want background location."
        }
    }

    private var shouldShowOpenSettingsButton: Bool {
        guard self.locationMode != .off else { return false }
        guard CLLocationManager.locationServicesEnabled() else { return true }
        return !PermissionManager.isLocationAuthorized(status: self.authorizationStatus, mode: self.locationMode)
    }

    private func requestLocationAuthorization(mode: AlisioLocationMode) async -> Bool {
        guard mode != .off else { return true }
        guard CLLocationManager.locationServicesEnabled() else {
            await MainActor.run { LocationPermissionHelper.openSettings() }
            return false
        }

        let status = CLLocationManager().authorizationStatus
        let requireAlways = mode == .always
        if PermissionManager.isLocationAuthorized(status: status, requireAlways: requireAlways) {
            return true
        }
        let updated = await LocationPermissionRequester.shared.request(always: requireAlways)
        return PermissionManager.isLocationAuthorized(status: updated, requireAlways: requireAlways)
    }
}

struct PermissionStatusList: View {
    let status: [Capability: Bool]
    let refresh: () async -> Void
    var compact: Bool = false
    var showRefresh: Bool = true
    @State private var pendingCapability: Capability?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(Capability.allCases.enumerated()), id: \.element) { index, cap in
                PermissionRow(
                    capability: cap,
                    status: self.status[cap] ?? false,
                    isPending: self.pendingCapability == cap,
                    compact: self.compact)
                {
                    Task { await self.handle(cap) }
                }

                if index < Capability.allCases.count - 1 {
                    Divider()
                        .padding(.leading, self.compact ? 42 : 48)
                }
            }

            if self.showRefresh {
                HStack {
                    Spacer(minLength: 0)
                    Button {
                        Task { await self.refresh() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .font(.footnote)
                    .padding(.top, 12)
                    .help("Refresh status")
                }
            }
        }
    }

    @MainActor
    private func handle(_ cap: Capability) async {
        guard self.pendingCapability == nil else { return }
        self.pendingCapability = cap
        defer { self.pendingCapability = nil }

        _ = await PermissionManager.ensure([cap], interactive: true)
        await self.refreshStatusTransitions()
    }

    @MainActor
    private func refreshStatusTransitions() async {
        await self.refresh()

        // TCC and notification settings can settle after the prompt closes or when the app regains focus.
        for delay in [300_000_000, 900_000_000, 1_800_000_000] {
            try? await Task.sleep(nanoseconds: UInt64(delay))
            await self.refresh()
        }
    }
}

private struct PermissionDetails {
    let title: String
    let subtitle: String
    let icon: String
}

struct PermissionRow: View {
    let capability: Capability
    let status: Bool
    let isPending: Bool
    let compact: Bool
    let action: () -> Void

    init(
        capability: Capability,
        status: Bool,
        isPending: Bool = false,
        compact: Bool = false,
        action: @escaping () -> Void)
    {
        self.capability = capability
        self.status = status
        self.isPending = isPending
        self.compact = compact
        self.action = action
    }

    var body: some View {
        HStack(alignment: .center, spacing: self.compact ? 10 : 12) {
            ZStack {
                Circle()
                    .fill(self.status ? Color.green.opacity(0.14) : Color.secondary.opacity(0.12))
                    .frame(width: self.iconSize, height: self.iconSize)
                Image(systemName: self.details.icon)
                    .font(.system(size: self.compact ? 13 : 14, weight: .semibold))
                    .foregroundStyle(self.status ? Color.green : Color.secondary)
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(self.details.title)
                    .font(self.compact ? .callout.weight(.semibold) : .body.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                Text(self.details.subtitle)
                    .font(self.compact ? .caption : .caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .layoutPriority(1)

            self.trailingControl
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.vertical, self.compact ? 10 : 12)
    }

    private var trailingControl: some View {
        Group {
            if self.status {
                PermissionStateCapsule(
                    title: "On",
                    systemImage: "checkmark.circle.fill",
                    tint: .green)
            } else if self.isPending {
                HStack(spacing: 6) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Checking")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                }
                .frame(minWidth: self.compact ? 82 : 96, alignment: .trailing)
            } else {
                Button(self.compact ? "Allow" : "Allow access") { self.action() }
                    .buttonStyle(.bordered)
                    .controlSize(self.compact ? .small : .regular)
            }
        }
    }

    private var iconSize: CGFloat {
        self.compact ? 28 : 32
    }

    private var details: PermissionDetails {
        switch self.capability {
        case .appleScript:
            return PermissionDetails(
                title: "Automation",
                subtitle: "Control other apps when an action needs it.",
                icon: "applescript")
        case .notifications:
            return PermissionDetails(
                title: "Notifications",
                subtitle: "Show desktop alerts for agent activity.",
                icon: "bell")
        case .accessibility:
            return PermissionDetails(
                title: "Accessibility",
                subtitle: "Interact with buttons, menus, and other UI elements.",
                icon: "hand.raised")
        case .screenRecording:
            return PermissionDetails(
                title: "Screen Recording",
                subtitle: "Capture the screen for context, screenshots, and recordings.",
                icon: "display")
        case .microphone:
            return PermissionDetails(
                title: "Microphone",
                subtitle: "Listen for Voice Wake and record audio when asked.",
                icon: "mic")
        case .speechRecognition:
            return PermissionDetails(
                title: "Speech Recognition",
                subtitle: "Transcribe wake phrases on-device.",
                icon: "waveform")
        case .camera:
            return PermissionDetails(
                title: "Camera",
                subtitle: "Take photos or short clips from the camera.",
                icon: "camera")
        case .location:
            return PermissionDetails(
                title: "Location",
                subtitle: "Share this Mac's location when you choose to.",
                icon: "location")
        }
    }
}

private struct PermissionStateCapsule: View {
    let title: String
    let systemImage: String
    let tint: Color

    var body: some View {
        Label(self.title, systemImage: self.systemImage)
            .font(.caption.weight(.semibold))
            .foregroundStyle(self.tint)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                Capsule()
                    .fill(self.tint.opacity(0.12)))
    }
}

#if DEBUG
struct PermissionsSettings_Previews: PreviewProvider {
    static var previews: some View {
        PermissionsSettings(
            status: [
                .appleScript: true,
                .notifications: true,
                .accessibility: false,
                .screenRecording: false,
                .microphone: true,
                .speechRecognition: false,
            ],
            refresh: {},
            openSetup: {})
            .frame(width: SettingsTab.windowWidth, height: SettingsTab.windowHeight)
    }
}
#endif
