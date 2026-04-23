import AppKit
import Observation
import SwiftUI

import AlisioSupport
struct SettingsRootView: View {
    @Bindable var state: AppState
    @Bindable var navigation: SettingsNavigationModel
    @Bindable private var accountStore = AlisioAccountStore.shared
    private let permissionMonitor = PermissionMonitor.shared
    @State private var monitoringPermissions = false
    @State private var permissionsState: PermissionsSettings.State = .loading
    @State private var snapshotPaths: (configPath: String?, stateDir: String?) = (nil, nil)
    let updater: UpdaterProviding?
    private let isPreview = ProcessInfo.processInfo.isPreview
    private let isNixMode = ProcessInfo.processInfo.isNixMode

    init(
        state: AppState,
        updater: UpdaterProviding?,
        navigation: SettingsNavigationModel = SettingsNavigationModel(),
        initialTab: SettingsTab? = nil)
    {
        self.state = state
        self.updater = updater
        self.navigation = navigation
        self.navigation.select(initialTab ?? navigation.selectedTab, debugEnabled: state.debugPaneEnabled)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if self.isNixMode {
                self.nixManagedBanner
            }
            TabView(selection: self.$navigation.selectedTab) {
                GeneralSettings(state: self.state)
                    .tabItem { Label("General", systemImage: "gearshape") }
                    .tag(SettingsTab.general)

                PermissionsSettings(
                    state: self.permissionsState,
                    refresh: self.refreshPerms)
                    .tabItem { Label("Permissions", systemImage: "lock.shield") }
                    .tag(SettingsTab.permissions)

                VoiceWakeSettings(state: self.state, isActive: self.navigation.selectedTab == .voiceWake)
                    .tabItem { Label("Voice Wake", systemImage: "waveform.circle") }
                    .tag(SettingsTab.voiceWake)

                ConfigSettings()
                    .tabItem { Label("Config", systemImage: "slider.horizontal.3") }
                    .tag(SettingsTab.config)

                if self.state.debugPaneEnabled {
                    DebugSettings(state: self.state)
                        .tabItem { Label("Debug", systemImage: "ant") }
                        .tag(SettingsTab.debug)
                }

                AboutSettings(updater: self.updater)
                    .tabItem { Label("About", systemImage: "info.circle") }
                    .tag(SettingsTab.about)
            }
        }
        .padding(.horizontal, 28)
        .padding(.vertical, 22)
        .frame(width: SettingsTab.windowWidth, height: SettingsTab.windowHeight, alignment: .topLeading)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onAppear {
            self.navigation.select(self.navigation.selectedTab, debugEnabled: self.state.debugPaneEnabled)
            self.updatePermissionMonitoring(for: self.navigation.selectedTab)
        }
        .onChange(of: self.state.debugPaneEnabled) { _, enabled in
            if !enabled, self.navigation.selectedTab == .debug {
                self.navigation.selectedTab = .general
            }
        }
        .onChange(of: self.navigation.selectedTab) { _, newValue in
            self.updatePermissionMonitoring(for: newValue)
            if newValue == .permissions {
                Task { await self.refreshPerms() }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            guard self.navigation.selectedTab == .permissions else { return }
            Task { await self.refreshPerms() }
        }
        .onDisappear { self.stopPermissionMonitoring() }
        .task {
            guard !self.isPreview else { return }
            await self.accountStore.refresh(reason: "settings-root")
            if self.navigation.selectedTab == .permissions {
                await self.refreshPerms()
            } else {
                let latest = self.permissionMonitor.status
                self.permissionsState = latest.isEmpty ? .empty : .loaded(latest)
            }
        }
        .task(id: self.state.connectionMode) {
            guard !self.isPreview else { return }
            await self.refreshSnapshotPaths()
        }
    }

    private var nixManagedBanner: some View {
        // Prefer gateway-resolved paths; fall back to local env defaults if disconnected.
        let configPath = self.snapshotPaths.configPath ?? AlisioPaths.configURL.path
        let stateDir = self.snapshotPaths.stateDir ?? AlisioPaths.stateDirURL.path

        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: "gearshape.2.fill")
                    .foregroundStyle(.secondary)
                Text("Managed by Nix")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text("Config: \(configPath)")
                Text("State:  \(stateDir)")
            }
            .font(.caption.monospaced())
            .foregroundStyle(.secondary)
            .textSelection(.enabled)
            .lineLimit(1)
            .truncationMode(.middle)
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 10)
        .background(Color.gray.opacity(0.12))
        .cornerRadius(10)
    }

    @MainActor
    private func refreshSnapshotPaths() async {
        let paths = await GatewayConnection.shared.snapshotPaths()
        self.snapshotPaths = paths
    }

    @MainActor
    private func refreshPerms() async {
        if self.isPreview {
            self.permissionsState = self.permissionMonitor.status.isEmpty ? .empty : .loaded(self.permissionMonitor.status)
            return
        }
        self.permissionsState = .loading
        await self.permissionMonitor.refreshNow()
        let latest = self.permissionMonitor.status
        self.permissionsState = latest.isEmpty ? .empty : .loaded(latest)
    }

    private func updatePermissionMonitoring(for tab: SettingsTab) {
        guard !self.isPreview else { return }
        PermissionMonitoringSupport.setMonitoring(tab == .permissions, monitoring: &self.monitoringPermissions)
    }

    private func stopPermissionMonitoring() {
        PermissionMonitoringSupport.stopMonitoring(&self.monitoringPermissions)
    }
}

enum SettingsTab: CaseIterable {
    case general, permissions, voiceWake, config, debug, about
    static let windowWidth: CGFloat = 824
    static let windowHeight: CGFloat = 790
    var title: String {
        switch self {
        case .general: "General"
        case .permissions: "Permissions"
        case .voiceWake: "Voice Wake"
        case .config: "Config"
        case .debug: "Debug"
        case .about: "About"
        }
    }

    var systemImage: String {
        switch self {
        case .general: "gearshape"
        case .permissions: "lock.shield"
        case .voiceWake: "waveform.circle"
        case .config: "slider.horizontal.3"
        case .debug: "ant"
        case .about: "info.circle"
        }
    }
}

#if DEBUG
struct SettingsRootView_Previews: PreviewProvider {
    static var previews: some View {
        ForEach(SettingsTab.allCases, id: \.self) { tab in
            SettingsRootView(
                state: .preview,
                updater: DisabledUpdaterController(),
                navigation: SettingsNavigationModel(selectedTab: tab))
                .previewDisplayName(tab.title)
                .frame(width: SettingsTab.windowWidth, height: SettingsTab.windowHeight)
                .environment(TailscaleService.shared)
        }
    }
}
#endif
