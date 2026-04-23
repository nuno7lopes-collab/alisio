import SwiftUI
import Observation

import AlisioSupport

@MainActor
struct WorkspaceSettingsLauncherView: View {
    @Bindable var state: AppState
    @Bindable private var accountStore = AlisioAccountStore.shared
    private let permissionMonitor = PermissionMonitor.shared
    @State private var didRefresh = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                self.infoCard(
                    title: "App settings live in the native Settings window.",
                    message: """
                    Use Settings for runtime, account, permissions, voice wake, and app-level preferences. \
                    Apps, Schedules, Capabilities, Connections, and Chat stay in their own workspace sections.
                    """)

                self.launchCard(
                    title: "General",
                    systemImage: "gearshape",
                    summary: self.generalSummary,
                    detail: self.generalDetail,
                    buttonTitle: "Open General Settings",
                    tab: .general)

                self.launchCard(
                    title: "Permissions",
                    systemImage: "lock.shield",
                    summary: self.permissionsSummary,
                    detail: self.permissionsDetail,
                    buttonTitle: "Open Permissions",
                    tab: .permissions)

                self.launchCard(
                    title: "Voice Wake",
                    systemImage: "waveform.circle",
                    summary: self.voiceWakeSummary,
                    detail: self.voiceWakeDetail,
                    buttonTitle: "Open Voice Wake",
                    tab: .voiceWake)

                self.launchCard(
                    title: "Config",
                    systemImage: "slider.horizontal.3",
                    summary: "Advanced config editing stays outside the main workspace routes.",
                    detail: "Use the native Settings window to inspect the schema-backed config editor without duplicating it here.",
                    buttonTitle: "Open Config",
                    tab: .config)

                if self.state.debugPaneEnabled {
                    self.launchCard(
                        title: "Debug",
                        systemImage: "ant",
                        summary: "Developer-only tools are kept behind the native Settings window.",
                        detail: "This keeps the workspace shell focused on product routes instead of duplicating debug utilities.",
                        buttonTitle: "Open Debug",
                        tab: .debug)
                }

                self.launchCard(
                    title: "About",
                    systemImage: "info.circle",
                    summary: "Version, update, and support details stay with the app-level settings.",
                    detail: "Open the native Settings window when you need build info, update checks, or project links.",
                    buttonTitle: "Open About",
                    tab: .about)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 24)
            .padding(.vertical, 24)
        }
        .task {
            guard !self.didRefresh else { return }
            self.didRefresh = true
            await self.accountStore.refresh(reason: "workspace-settings-launcher")
            await self.permissionMonitor.refreshNow()
        }
    }

    private var generalSummary: String {
        let accountSummary = self.accountStore.isAuthenticated
            ? "Account connected"
            : "Account not connected"
        return "\(accountSummary) · \(self.runtimeSummary)"
    }

    private var generalDetail: String {
        switch self.state.connectionMode {
        case .local:
            "Review local runtime health, launch-at-login, Dock visibility, Canvas, and the signed-in account."
        case .remote:
            "Review the remote gateway target, token, diagnostics, and the signed-in account."
        case .unconfigured:
            "Choose Local or Remote, then review account state and app-level toggles in one place."
        }
    }

    private var runtimeSummary: String {
        switch self.state.connectionMode {
        case .local:
            "local runtime"
        case .remote:
            "remote runtime"
        case .unconfigured:
            "runtime not configured"
        }
    }

    private var permissionsSummary: String {
        let missingCount = self.permissionMonitor.status.values.filter { !$0 }.count
        if self.permissionMonitor.status.isEmpty {
            return "Optional macOS access is managed here."
        }
        if missingCount == 0 {
            return "Optional macOS access is ready where enabled."
        }
        if missingCount == 1 {
            return "1 optional macOS permission is currently off."
        }
        return "\(missingCount) optional macOS permissions are currently off."
    }

    private var permissionsDetail: String {
        if self.permissionMonitor.status.isEmpty {
            return "Use Permissions to review Accessibility, Screen Recording, microphone, location, and similar access when you need those features."
        }
        return "Features ask for macOS access when needed. Use the native Permissions tab to review or change that access later."
    }

    private var voiceWakeSummary: String {
        if self.state.swabbleEnabled || self.state.voicePushToTalkEnabled {
            return PermissionManager.voiceWakePermissionsGranted()
                ? "Voice Wake configured on this Mac."
                : "Voice Wake enabled but missing required macOS permissions."
        }
        return "Voice Wake currently off."
    }

    private var voiceWakeDetail: String {
        "Manage trigger words, language order, microphone selection, and test mode from the native Voice Wake tab."
    }

    private func infoCard(title: String, message: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color(nsColor: .controlBackgroundColor)))
    }

    private func launchCard(
        title: String,
        systemImage: String,
        summary: String,
        detail: String,
        buttonTitle: String,
        tab: SettingsTab) -> some View
    {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: systemImage)
                .font(.title2.weight(.semibold))
                .foregroundStyle(Color.accentColor)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.headline)
                Text(summary)
                    .font(.subheadline.weight(.semibold))
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button(buttonTitle) {
                    SettingsWindowOpener.shared.open(tab: tab)
                }
                .buttonStyle(.link)
                .padding(.top, 2)
            }

            Spacer(minLength: 0)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color(nsColor: .controlBackgroundColor)))
    }
}
