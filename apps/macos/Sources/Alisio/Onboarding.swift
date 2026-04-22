import AppKit
import SwiftUI

import AlisioSupport
enum UIStrings {
    static let welcomeTitle = "Welcome to Alisio"
}

@MainActor
final class OnboardingController {
    static let shared = OnboardingController()

    func show() {
        if ProcessInfo.processInfo.isNixMode {
            // Nix mode is fully declarative; onboarding would suggest interactive setup that doesn't apply.
            UserDefaults.standard.set(true, forKey: onboardingSeenKey)
            UserDefaults.standard.set(currentOnboardingVersion, forKey: onboardingVersionKey)
            AppStateStore.shared.onboardingSeen = true
            return
        }
        DockIconManager.shared.temporarilyShowDock()
        NSApp.activate(ignoringOtherApps: true)
        AlisioWindowManager.shared.showSetup()
    }

    func close() {}

    func restart() {
        self.show()
    }
}

struct OnboardingView: View {
    @Bindable var state: AppState
    var permissionMonitor: PermissionMonitor
    @State private var didRefreshPermissions = false

    init(
        state: AppState = AppStateStore.shared,
        permissionMonitor: PermissionMonitor = .shared)
    {
        self.state = state
        self.permissionMonitor = permissionMonitor
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                AlisioOnboardingIcon()
                    .padding(.top, 8)

                VStack(spacing: 10) {
                    Text("Set up this Mac")
                        .font(.largeTitle.weight(.semibold))
                    Text(
                        "Account entry is complete. Finish the runtime and permission checks here, then continue into the workspace.")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 560)
                }

                self.setupCard(
                    title: "Runtime",
                    summary: self.runtimeSummary,
                    detail: self.runtimeDetail,
                    systemImage: self.runtimeIcon,
                    tint: self.runtimeTint,
                    actionTitle: "Open General Settings")
                {
                    self.openSettings(tab: .general)
                }

                self.setupCard(
                    title: "Permissions",
                    summary: self.permissionsSummary,
                    detail: self.permissionsDetail,
                    systemImage: self.permissionsIcon,
                    tint: self.permissionsTint,
                    actionTitle: "Open Permissions")
                {
                    self.openSettings(tab: .permissions)
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("What changed")
                        .font(.headline)
                    Text(
                        "The Mac app no longer uses the old first-run wizard for providers, channels, or apps. Runtime setup lives in Settings, and the workspace is the main product surface.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(18)
                .background(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(Color(nsColor: .controlBackgroundColor)))

                HStack(spacing: 12) {
                    Button("Open Settings") {
                        self.openSettings(tab: .general)
                    }
                    .buttonStyle(.bordered)

                    Button(self.continueButtonTitle) {
                        self.finish()
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding(.horizontal, 28)
            .padding(.vertical, 24)
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color(nsColor: .windowBackgroundColor))
        .task {
            guard !self.didRefreshPermissions else { return }
            self.didRefreshPermissions = true
            await self.permissionMonitor.refreshNow()
        }
    }

    private var runtimeSummary: String {
        switch self.state.connectionMode {
        case .local:
            "This Mac is set to run the local Alisio runtime."
        case .remote:
            "This Mac is attached to a remote Alisio runtime."
        case .unconfigured:
            "No runtime is configured yet."
        }
    }

    private var runtimeDetail: String {
        switch self.state.connectionMode {
        case .local:
            "Use Settings → General to review launchd, local runtime health, and CLI install state."
        case .remote:
            "Use Settings → General to edit the remote endpoint, auth token, and connection diagnostics."
        case .unconfigured:
            "Choose Local or Remote in Settings → General. You can still enter the workspace and configure it later."
        }
    }

    private var runtimeIcon: String {
        switch self.state.connectionMode {
        case .local:
            "laptopcomputer"
        case .remote:
            "network"
        case .unconfigured:
            "gearshape.2"
        }
    }

    private var runtimeTint: Color {
        switch self.state.connectionMode {
        case .local, .remote:
            .green
        case .unconfigured:
            .orange
        }
    }

    private var missingPermissionsCount: Int {
        self.permissionMonitor.status.values.filter { !$0 }.count
    }

    private var permissionsSummary: String {
        if self.missingPermissionsCount == 0 {
            return "macOS permissions look ready."
        }
        if self.missingPermissionsCount == 1 {
            return "1 macOS permission still needs review."
        }
        return "\(self.missingPermissionsCount) macOS permissions still need review."
    }

    private var permissionsDetail: String {
        if self.missingPermissionsCount == 0 {
            return "Use Settings → Permissions any time you want to change Accessibility, Screen Recording, microphone, location, or other device access."
        }
        return "Review Settings → Permissions to enable only the capabilities this Mac should expose."
    }

    private var permissionsIcon: String {
        self.missingPermissionsCount == 0 ? "checkmark.shield" : "lock.shield"
    }

    private var permissionsTint: Color {
        self.missingPermissionsCount == 0 ? .green : .orange
    }

    private var continueButtonTitle: String {
        self.state.connectionMode == .unconfigured ? "Continue Anyway" : "Continue to Workspace"
    }

    private func openSettings(tab: SettingsTab) {
        SettingsWindowOpener.shared.open(tab: tab)
    }

    private func finish() {
        UserDefaults.standard.set(true, forKey: onboardingSeenKey)
        UserDefaults.standard.set(currentOnboardingVersion, forKey: onboardingVersionKey)
        AppStateStore.shared.onboardingSeen = true
        AlisioWindowManager.shared.showPreferredChat()
    }

    @ViewBuilder
    private func setupCard(
        title: String,
        summary: String,
        detail: String,
        systemImage: String,
        tint: Color,
        actionTitle: String,
        action: @escaping () -> Void) -> some View
    {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: systemImage)
                .font(.title2.weight(.semibold))
                .foregroundStyle(tint)
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
                Button(actionTitle, action: action)
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
