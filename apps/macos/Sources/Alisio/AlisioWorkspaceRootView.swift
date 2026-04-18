import AlisioChatUI
import SwiftUI
import Observation

import AlisioSupport

private enum AlisioWorkspaceSidebarItem: String, CaseIterable, Identifiable {
    case chat
    case channels
    case automations
    case skills
    case sessions
    case instances
    case settings

    var id: String { self.rawValue }

    var title: String {
        switch self {
        case .chat: "Chat"
        case .channels: "Channels"
        case .automations: "Automations"
        case .skills: "Skills"
        case .sessions: "Sessions"
        case .instances: "Instances"
        case .settings: "Settings"
        }
    }

    var systemImage: String {
        switch self {
        case .chat: "bubble.left.and.bubble.right"
        case .channels: "link"
        case .automations: "calendar"
        case .skills: "sparkles"
        case .sessions: "clock.arrow.circlepath"
        case .instances: "network"
        case .settings: "gearshape"
        }
    }

    init(route: AlisioShellState.Route) {
        switch route {
        case .chat, .home, .onboarding:
            self = .chat
        case .authentications:
            self = .channels
        case .automations:
            self = .automations
        case .agents:
            self = .skills
        case .organization:
            self = .instances
        case .sessions:
            self = .sessions
        case .settings:
            self = .settings
        }
    }

    @MainActor
    func apply(to shellState: AlisioShellState) {
        switch self {
        case .chat:
            shellState.showChat(sessionKey: shellState.activeSessionKey ?? "main")
        case .channels:
            shellState.show(route: .authentications)
        case .automations:
            shellState.show(route: .automations)
        case .skills:
            shellState.show(route: .agents)
        case .sessions:
            shellState.show(route: .sessions)
        case .instances:
            shellState.show(route: .organization)
        case .settings:
            shellState.showSettings(tab: .general)
        }
    }
}

@MainActor
struct AlisioWorkspaceRootView: View {
    @Bindable var shellState: AlisioShellState
    @Bindable var state: AppState

    let presentation: AlisioWorkspacePresentation
    let updater: (any UpdaterProviding)?

    @Environment(\.colorScheme) private var systemScheme

    private var palette: AlisioPalette {
        AlisioPalette.resolve(theme: .system, systemScheme: self.systemScheme)
    }

    private var currentSidebarItem: AlisioWorkspaceSidebarItem {
        AlisioWorkspaceSidebarItem(route: self.shellState.route)
    }

    private var resolvedSessionKey: String {
        let trimmed = self.shellState.activeSessionKey?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? "main" : trimmed
    }

    private var settingsTab: SettingsTab {
        switch self.shellState.settingsSection {
        case .workspace:
            .general
        case .communications:
            .channels
        case .appearance:
            .general
        case .automation:
            .cron
        case .infrastructure:
            .instances
        case .aiAgents:
            .skills
        case .mac:
            .permissions
        case .debug, .logs:
            .debug
        }
    }

    var body: some View {
        Group {
            if self.presentation.isPanel {
                self.panelBody
            } else {
                self.windowBody
            }
        }
        .background(self.palette.canvas.ignoresSafeArea())
    }

    private var windowBody: some View {
        HStack(spacing: 0) {
            self.sidebar
                .frame(width: 228)
            Rectangle()
                .fill(self.palette.separator)
                .frame(width: 1)
            self.stage
        }
    }

    private var panelBody: some View {
        self.workspaceContent(compact: true)
            .background(self.palette.surface)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(self.palette.border, lineWidth: 1))
            .padding(1)
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 12) {
                AlisioBrandMark(palette: self.palette, size: 38)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Alisio")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(self.palette.primaryText)
                    Text("Desktop workspace")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(self.palette.secondaryText)
                }
            }
            .padding(.top, 8)

            VStack(spacing: 8) {
                ForEach(AlisioWorkspaceSidebarItem.allCases) { item in
                    Button {
                        item.apply(to: self.shellState)
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: item.systemImage)
                                .frame(width: 18)
                            Text(item.title)
                                .font(.system(size: 14, weight: .semibold))
                            Spacer(minLength: 0)
                        }
                        .foregroundStyle(
                            self.currentSidebarItem == item
                                ? self.palette.primaryText
                                : self.palette.secondaryText)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                        .background(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(self.currentSidebarItem == item ? self.palette.surfaceMuted : .clear)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                                        .strokeBorder(
                                            self.currentSidebarItem == item ? self.palette.border : .clear,
                                            lineWidth: 1)))
                    }
                    .buttonStyle(.plain)
                }
            }

            Spacer()

            VStack(alignment: .leading, spacing: 10) {
                AlisioChip(
                    title: self.state.connectionMode == .local ? "Local mode" : "Remote mode",
                    tint: self.state.connectionMode == .local ? self.palette.success : self.palette.warning,
                    palette: self.palette)
                Text(self.resolvedSessionKey)
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundStyle(self.palette.tertiaryText)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .padding(18)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(self.palette.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .strokeBorder(self.palette.border, lineWidth: 1)))
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 24)
        .background(self.palette.sidebar)
    }

    private var stage: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(self.stageTitle)
                        .font(.system(size: 24, weight: .bold))
                        .foregroundStyle(self.palette.primaryText)
                    Text(self.stageSubtitle)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(self.palette.secondaryText)
                }
                Spacer()
                if self.shellState.route == .chat || self.shellState.route == .home {
                    AlisioChip(title: self.resolvedSessionKey, tint: self.palette.accent, palette: self.palette)
                }
            }
            .padding(.horizontal, 28)
            .padding(.vertical, 20)

            Rectangle()
                .fill(self.palette.separator)
                .frame(height: 1)

            self.workspaceContent(compact: false)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .background(self.palette.stage)
    }

    private var stageTitle: String {
        switch self.shellState.route {
        case .chat, .home:
            "Chat"
        case .authentications:
            "Channels"
        case .automations:
            "Automations"
        case .agents:
            "Skills"
        case .organization:
            "Instances"
        case .sessions:
            "Sessions"
        case .settings:
            "Settings"
        case .onboarding:
            "Welcome"
        }
    }

    private var stageSubtitle: String {
        switch self.shellState.route {
        case .chat, .home:
            "Native macOS chat with local computer control."
        case .authentications:
            "Configure connected channels and integrations."
        case .automations:
            "Review and edit scheduled automations."
        case .agents:
            "Manage skills and AI agent behavior."
        case .organization:
            "Inspect instances and local infrastructure."
        case .sessions:
            "Inspect reusable conversation state."
        case .settings:
            "Adjust app, gateway, and permission settings."
        case .onboarding:
            "Complete the local desktop setup."
        }
    }

    @ViewBuilder
    private func workspaceContent(compact: Bool) -> some View {
        switch self.shellState.route {
        case .onboarding:
            OnboardingView(state: self.state, shellOnboarding: self.shellState.onboardingState)
                .padding(compact ? 14 : 24)
        case .home, .chat:
            WorkspaceChatStage(
                sessionKey: self.resolvedSessionKey,
                state: self.state,
                palette: self.palette,
                compact: compact)
                .id("chat-\(self.resolvedSessionKey)-\(compact ? "panel" : "window")-\(self.state.connectionMode.rawValue)")
        case .authentications:
            ChannelsSettings()
                .padding(compact ? 14 : 24)
        case .automations:
            CronSettings()
                .padding(compact ? 14 : 24)
        case .agents:
            SkillsSettings(state: self.state)
                .padding(compact ? 14 : 24)
        case .organization:
            InstancesSettings()
                .padding(compact ? 14 : 24)
        case .sessions:
            SessionsSettings()
                .padding(compact ? 14 : 24)
        case .settings:
            SettingsRootView(state: self.state, updater: self.updater, initialTab: self.settingsTab)
                .id("settings-\(self.settingsTab.title)")
                .padding(compact ? 14 : 24)
        }
    }
}

@MainActor
private struct WorkspaceChatStage: View {
    @Bindable var state: AppState

    let sessionKey: String
    let palette: AlisioPalette
    let compact: Bool

    @State private var chatViewModel: AlisioChatViewModel
    @State private var computerStore: MacDesktopComputerStore
    @State private var computerPanePresented = false

    init(sessionKey: String, state: AppState, palette: AlisioPalette, compact: Bool) {
        self.state = state
        self.sessionKey = sessionKey
        self.palette = palette
        self.compact = compact
        self._chatViewModel = State(
            initialValue: AlisioChatViewModel(
                sessionKey: sessionKey,
                transport: MacGatewayChatTransport()))
        self._computerStore = State(initialValue: MacDesktopComputerStore(sessionKey: sessionKey))
    }

    var body: some View {
        VStack(spacing: self.compact ? 0 : 12) {
            if self.showsComputerToggle {
                self.computerToolbar
                    .padding(.horizontal, 22)
                    .padding(.top, 18)
            }

            Group {
                if !self.showsComputerToggle || !self.computerPanePresented {
                    self.chatOnlyStage
                } else {
                    HSplitView {
                        self.chatOnlyStage
                        DesktopComputerPane(store: self.computerStore, palette: self.palette)
                            .frame(minWidth: 320, idealWidth: 360, maxWidth: 420)
                    }
                }
            }
        }
        .task {
            if self.showsComputerToggle {
                self.computerStore.activate()
            } else {
                self.computerStore.deactivate()
                self.computerPanePresented = false
            }
        }
        .onDisappear {
            self.computerStore.deactivate()
        }
        .onChange(of: self.state.connectionMode) { _, newValue in
            if newValue == .local, !self.compact {
                self.computerStore.activate()
            } else {
                self.computerStore.deactivate()
                self.computerPanePresented = false
            }
        }
        .onChange(of: self.computerStore.shouldAutoPresentPane) { _, shouldPresent in
            if shouldPresent {
                self.computerPanePresented = true
            }
        }
    }

    private var chatOnlyStage: some View {
        AlisioChatView(
            viewModel: self.chatViewModel,
            showsSessionSwitcher: true,
            style: .alisio,
            assistantIdentity: .init(name: "Alisio"),
            userAccent: self.palette.accent,
            showsAssistantTrace: true)
            .padding(self.compact ? 8 : 22)
            .background(self.palette.stage)
    }

    private var showsComputerToggle: Bool {
        !self.compact && self.state.connectionMode == .local
    }

    private var computerToolbar: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Computer")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(self.palette.primaryText)
                Text(self.computerToolbarSubtitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(self.palette.secondaryText)
            }
            Spacer()
            Group {
                if self.computerPanePresented {
                    Button("Hide computer") {
                        self.computerPanePresented = false
                    }
                    .buttonStyle(AlisioGhostButtonStyle(palette: self.palette))
                } else {
                    Button("Show computer") {
                        self.computerPanePresented = true
                    }
                    .buttonStyle(AlisioPrimaryButtonStyle(palette: self.palette))
                }
            }
        }
    }

    private var computerToolbarSubtitle: String {
        if self.computerStore.needsObservationPermission {
            return "Screen Recording required for local observation."
        }
        if self.computerStore.needsControlPermission {
            return "Observation is ready. Accessibility is still required for control actions."
        }
        return self.computerStore.statusLabel
    }
}

@MainActor
private struct DesktopComputerPane: View {
    @Bindable var store: MacDesktopComputerStore

    let palette: AlisioPalette

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Computer")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(self.palette.primaryText)
                    Text(self.store.statusLabel)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(self.palette.secondaryText)
                }
                Spacer()
                AlisioChip(
                    title: self.connectionStateTitle,
                    tint: self.connectionTint,
                    palette: self.palette)
            }

            self.frameCard

            VStack(alignment: .leading, spacing: 8) {
                if let context = self.store.observation?.context {
                    self.metaRow("App", context.activeApp?.name ?? context.activeApp?.bundleId ?? "Unknown")
                    self.metaRow("Window", context.activeWindow?.title ?? "Unknown")
                    self.metaRow(
                        "Display",
                        "\(Int(context.display.logicalWidth))×\(Int(context.display.logicalHeight)) @ \(String(format: "%.2f", context.display.scale))x")
                } else {
                    self.metaRow("Session", self.store.sessionKey)
                }

                if let updatedAt = self.store.lastUpdatedAt {
                    self.metaRow("Last frame", updatedAt.formatted(date: .omitted, time: .standard))
                }
            }

            if self.store.needsObservationPermission || self.store.needsControlPermission {
                VStack(alignment: .leading, spacing: 10) {
                    if self.store.needsObservationPermission {
                        Button {
                            self.store.requestObservationPermission()
                        } label: {
                            Label("Grant Screen Recording", systemImage: "display")
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 10)
                        }
                        .buttonStyle(AlisioPrimaryButtonStyle(palette: self.palette))
                    }

                    if self.store.needsControlPermission {
                        Button {
                            self.store.requestControlPermission()
                        } label: {
                            Label("Grant Accessibility", systemImage: "hand.tap")
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 10)
                        }
                        .buttonStyle(AlisioGhostButtonStyle(palette: self.palette))
                    }

                    if let restartHint = self.store.permissionRestartHint {
                        Text(restartHint)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(self.palette.secondaryText)
                    }
                }
            }

            HStack(spacing: 10) {
                if self.store.sessionState == .running {
                    Button("Pause") { self.store.pause() }
                        .buttonStyle(AlisioGhostButtonStyle(palette: self.palette))
                } else if self.store.sessionState == .paused {
                    Button("Resume") { self.store.resume() }
                        .buttonStyle(AlisioPrimaryButtonStyle(palette: self.palette))
                } else {
                    Button("Start") { self.store.start() }
                        .buttonStyle(AlisioPrimaryButtonStyle(palette: self.palette))
                        .disabled(!self.store.canStartSession)
                }

                Button("Stop") { self.store.stop() }
                    .buttonStyle(AlisioGhostButtonStyle(palette: self.palette, isDanger: true))
                    .disabled(self.store.sessionState == .stopped)
            }
        }
        .padding(22)
        .background(self.palette.surface)
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(self.palette.separator)
                .frame(width: 1)
        }
    }

    @ViewBuilder
    private var frameCard: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(self.palette.surfaceMuted)
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(self.palette.border, lineWidth: 1))

            if let frameImage = self.store.frameImage {
                Image(nsImage: frameImage)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .padding(12)
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "desktopcomputer")
                        .font(.system(size: 28, weight: .medium))
                        .foregroundStyle(self.palette.secondaryText)
                    Text(self.emptyStateText)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(self.palette.secondaryText)
                        .multilineTextAlignment(.center)
                }
                .padding(24)
            }
        }
        .frame(minHeight: 260)
    }

    private var emptyStateText: String {
        if let errorText = self.store.errorText, !errorText.isEmpty {
            return errorText
        }
        if self.store.needsObservationPermission {
            return "Grant Screen Recording to observe the Mac."
        }
        switch self.store.sessionState {
        case .running:
            return "Waiting for the first frame."
        case .paused:
            return "Session paused."
        case .stopped:
            if self.store.needsControlPermission {
                return "Observation is ready. Grant Accessibility to allow local control actions."
            }
            return "Computer session stopped."
        }
    }

    private var connectionStateTitle: String {
        switch self.store.runtime.connectionState {
        case .idle:
            "Idle"
        case .starting:
            "Starting"
        case .running:
            "Ready"
        case .interrupted:
            "Interrupted"
        case .invalidated:
            "Invalidated"
        case .disabled:
            "Disabled"
        }
    }

    private var connectionTint: Color {
        switch self.store.runtime.connectionState {
        case .running:
            self.palette.success
        case .starting, .idle:
            self.palette.warning
        case .interrupted, .invalidated, .disabled:
            self.palette.danger
        }
    }

    private func metaRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text(label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(self.palette.tertiaryText)
                .frame(width: 72, alignment: .leading)
            Text(value)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(self.palette.primaryText)
                .lineLimit(2)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
    }
}
