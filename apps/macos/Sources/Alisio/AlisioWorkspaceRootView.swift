import AlisioChatUI
import AlisioKit
import SwiftUI
import Observation

import AlisioSupport

private enum AlisioWorkspaceSidebarItem: String, CaseIterable, Identifiable {
    case chat
    case memory
    case apps
    case schedules
    case capabilities
    case connections
    case settings

    var id: String { self.rawValue }

    var title: String {
        switch self {
        case .chat: "Chat"
        case .memory: "Memory"
        case .apps: "Apps"
        case .schedules: "Schedules"
        case .capabilities: "Capabilities"
        case .connections: "Connections"
        case .settings: "Settings"
        }
    }

    var systemImage: String {
        switch self {
        case .chat: "bubble.left.and.bubble.right"
        case .memory: "brain.head.profile"
        case .apps: "link"
        case .schedules: "calendar"
        case .capabilities: "sparkles"
        case .connections: "network"
        case .settings: "gearshape"
        }
    }

    init(route: WorkspaceNavigationState.Route) {
        self = Self(rawValue: route.rawValue) ?? .chat
    }

    @MainActor
    func apply(to navigationState: WorkspaceNavigationState) {
        switch self {
        case .chat:
            navigationState.showChat(sessionKey: navigationState.activeSessionKey ?? "main")
        case .memory:
            navigationState.show(route: .memory)
        case .apps:
            navigationState.show(route: .apps)
        case .schedules:
            navigationState.show(route: .schedules)
        case .capabilities:
            navigationState.show(route: .capabilities)
        case .connections:
            navigationState.show(route: .connections)
        case .settings:
            navigationState.showSettings()
        }
    }
}

@MainActor
struct AlisioWorkspaceChatEnvironment {
    let makeChatViewModel: (String) -> AlisioChatViewModel
    let makeComputerStore: (String) -> MacDesktopComputerStore
    let autoloadChatOnAppear: Bool

    static let live = Self(
        makeChatViewModel: { sessionKey in
            AlisioChatViewModel(sessionKey: sessionKey, transport: MacGatewayChatTransport())
        },
        makeComputerStore: { sessionKey in
            MacDesktopComputerStore(sessionKey: sessionKey)
        },
        autoloadChatOnAppear: true)
}

@MainActor
struct AlisioWorkspaceRootView: View {
    @Bindable var navigationState: WorkspaceNavigationState
    @Bindable var state: AppState

    let presentation: AlisioWorkspacePresentation
    let updater: (any UpdaterProviding)?
    let chatEnvironment: AlisioWorkspaceChatEnvironment

    @Environment(\.colorScheme) private var systemScheme
    @State private var isSidebarCollapsed = false

    private var palette: AlisioPalette {
        AlisioPalette.resolve(theme: .system, systemScheme: self.systemScheme)
    }

    private var currentSidebarItem: AlisioWorkspaceSidebarItem {
        AlisioWorkspaceSidebarItem(route: self.navigationState.route)
    }

    private var resolvedSessionKey: String {
        let trimmed = self.navigationState.activeSessionKey?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? "main" : trimmed
    }

    private var sidebarWidth: CGFloat {
        self.isSidebarCollapsed ? 82 : 228
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
                .frame(width: self.sidebarWidth)
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
        VStack(alignment: self.isSidebarCollapsed ? .center : .leading, spacing: 18) {
            HStack(spacing: 12) {
                AlisioBrandMark(palette: self.palette, size: 38)
                if !self.isSidebarCollapsed {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Alisio")
                            .font(.system(size: 22, weight: .bold))
                            .foregroundStyle(self.palette.primaryText)
                    }
                }
                Spacer(minLength: 0)
                Button {
                    withAnimation(.snappy(duration: 0.22)) {
                        self.isSidebarCollapsed.toggle()
                    }
                } label: {
                    Image(systemName: self.isSidebarCollapsed ? "chevron.right" : "chevron.left")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(self.palette.secondaryText)
                        .frame(width: 28, height: 28)
                        .background(
                            Circle()
                                .fill(self.palette.surfaceMuted)
                                .overlay(Circle().strokeBorder(self.palette.border, lineWidth: 1)))
                }
                .buttonStyle(.plain)
                .help(self.isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar")
            }
            .padding(.top, 8)

            VStack(spacing: 8) {
                ForEach(AlisioWorkspaceSidebarItem.allCases) { item in
                    Button {
                        item.apply(to: self.navigationState)
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: item.systemImage)
                                .frame(width: 18)
                            if !self.isSidebarCollapsed {
                                Text(item.title)
                                    .font(.system(size: 14, weight: .semibold))
                            }
                            Spacer(minLength: 0)
                        }
                        .frame(maxWidth: .infinity, alignment: self.isSidebarCollapsed ? .center : .leading)
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
                    .help(item.title)
                }
            }

            Spacer()

            Group {
                if self.isSidebarCollapsed {
                    Circle()
                        .fill(self.state.connectionMode == .local ? self.palette.success : self.palette.warning)
                        .frame(width: 12, height: 12)
                        .help(self.sidebarSummary)
                } else {
                    VStack(alignment: .leading, spacing: 10) {
                        AlisioChip(
                            title: self.state.connectionMode == .local ? "On this Mac" : "Remote",
                            tint: self.state.connectionMode == .local ? self.palette.success : self.palette.warning,
                            palette: self.palette)
                        Text(self.sidebarSummary)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(self.palette.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(18)
                    .background(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(self.palette.surface)
                            .overlay(
                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    .strokeBorder(self.palette.border, lineWidth: 1)))
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 24)
        .background(self.palette.sidebar)
    }

    private var stage: some View {
        VStack(spacing: 0) {
            if self.navigationState.route != .chat {
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
                }
                .padding(.horizontal, 28)
                .padding(.vertical, 20)

                Rectangle()
                    .fill(self.palette.separator)
                    .frame(height: 1)
            }

            self.workspaceContent(compact: false)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .background(self.palette.stage)
    }

    private var sidebarSummary: String {
        switch self.state.connectionMode {
        case .local:
            "Native workspace ready on this Mac."
        case .remote:
            "Native workspace connected remotely."
        case .unconfigured:
            "Finish setup to open the full workspace."
        }
    }

    private var stageTitle: String {
        self.navigationState.route.workspaceTitle
    }

    private var stageSubtitle: String {
        self.navigationState.route.workspaceSubtitle
    }

    @ViewBuilder
    private func workspaceContent(compact: Bool) -> some View {
        switch self.navigationState.route {
        case .chat:
            WorkspaceChatStage(
                sessionKey: self.resolvedSessionKey,
                state: self.state,
                palette: self.palette,
                compact: compact,
                onOpenApps: {
                    self.navigationState.show(route: .apps)
                },
                onSessionChange: { sessionKey in
                    self.navigationState.showChat(sessionKey: sessionKey)
                },
                environment: self.chatEnvironment)
        case .memory:
            MemorySettings()
                .padding(compact ? 14 : 24)
        case .apps:
            AppsSettings()
                .padding(compact ? 14 : 24)
        case .schedules:
            CronSettings()
                .padding(compact ? 14 : 24)
        case .capabilities:
            SkillsSettings(state: self.state)
                .padding(compact ? 14 : 24)
        case .connections:
            InstancesSettings()
                .padding(compact ? 14 : 24)
        case .settings:
            WorkspaceSettingsLauncherView(state: self.state)
                .id("settings-launcher")
                .padding(compact ? 14 : 24)
        }
    }
}

extension WorkspaceNavigationState.Route {
    var workspaceTitle: String {
        switch self {
        case .chat:
            "Chat"
        case .memory:
            "Memory"
        case .apps:
            "Apps"
        case .schedules:
            "Schedules"
        case .capabilities:
            "Capabilities"
        case .connections:
            "Connections"
        case .settings:
            "Settings"
        }
    }

    var workspaceSubtitle: String {
        switch self {
        case .chat:
            "Pick up the main conversation or start a clean new chat."
        case .memory:
            "Read daily notes, topic notes, core memory, and agent files."
        case .apps:
            "Connect real app integrations like Gmail, Calendar, GitHub, Stripe, and YouTube."
        case .schedules:
            "Create, review, and run scheduled work."
        case .capabilities:
            "See what this Mac can do and what still needs setup."
        case .connections:
            "See how this Mac reaches the runtime, whether health is passing, and which nodes are alive."
        case .settings:
            "Open the native Settings window for app-level preferences without duplicating them in the workspace."
        }
    }
}

@MainActor
private struct WorkspaceChatStage: View {
    @Bindable var state: AppState
    @Bindable private var activityStore = WorkActivityStore.shared
    @Bindable private var eventStore = AgentEventStore.shared
    @Bindable private var talkController = TalkModeController.shared

    let sessionKey: String
    let palette: AlisioPalette
    let compact: Bool
    let onOpenApps: @MainActor () -> Void
    let onSessionChange: @MainActor (String) -> Void
    let environment: AlisioWorkspaceChatEnvironment

    @State private var chatViewModel: AlisioChatViewModel
    @State private var computerStore: MacDesktopComputerStore
    @State private var inspectorVisibility = WorkspaceInspectorVisibilityState()

    init(
        sessionKey: String,
        state: AppState,
        palette: AlisioPalette,
        compact: Bool,
        onOpenApps: @escaping @MainActor () -> Void,
        onSessionChange: @escaping @MainActor (String) -> Void,
        environment: AlisioWorkspaceChatEnvironment = .live)
    {
        self.state = state
        self.sessionKey = sessionKey
        self.palette = palette
        self.compact = compact
        self.onOpenApps = onOpenApps
        self.onSessionChange = onSessionChange
        self.environment = environment
        self._chatViewModel = State(initialValue: environment.makeChatViewModel(sessionKey))
        self._computerStore = State(initialValue: environment.makeComputerStore(sessionKey))
    }

    var body: some View {
        VStack(spacing: self.compact ? 0 : 14) {
            if let status = self.bootstrapStatus {
                WorkspaceStatusBanner(
                    title: status.title,
                    message: status.message,
                    palette: self.palette,
                    systemImage: status.systemImage,
                    usesProgressView: status.usesProgressView,
                    tint: status.tint)
                    .padding(.horizontal, self.compact ? 8 : 22)
            }

            Group {
                if self.inspectorVisible, self.supportsInspector {
                    HSplitView {
                        self.chatOnlyStage
                        WorkspaceInspectorPane(
                            state: self.state,
                            chatViewModel: self.chatViewModel,
                            computerStore: self.computerStore,
                            palette: self.palette,
                            sessionKey: self.trackedSessionKey,
                            recentEvents: self.recentEvents,
                            lastToolLabel: self.currentSessionToolActivity?.label,
                            lastToolUpdatedAt: self.currentSessionToolActivity?.lastUpdate,
                            onClose: {
                                self.inspectorVisibility.hide(autoPresent: self.inspectorShouldAutoPresent)
                            })
                            .frame(minWidth: 320, idealWidth: 360, maxWidth: 420)
                    }
                } else {
                    self.chatOnlyStage
                }
            }
        }
        .task(id: self.shouldMonitorComputer) {
            if self.shouldMonitorComputer {
                self.computerStore.activate()
            } else {
                self.computerStore.deactivate()
            }
        }
        .onDisappear {
            self.computerStore.deactivate()
        }
        .onChange(of: self.inspectorShouldAutoPresent) { _, isAutoPresent in
            self.inspectorVisibility.sync(autoPresent: isAutoPresent)
        }
        .onChange(of: self.sessionKey) { _, nextSessionKey in
            self.syncPresentedSession(to: nextSessionKey)
        }
        .onChange(of: self.chatViewModel.sessionKey) { _, nextSessionKey in
            guard !self.matchesSessionKey(nextSessionKey, self.sessionKey) else { return }
            self.onSessionChange(nextSessionKey)
        }
        .onChange(of: self.trackedSessionKey) { previousSessionKey, nextSessionKey in
            guard !self.matchesSessionKey(previousSessionKey, nextSessionKey) else { return }
            self.replaceComputerStore(sessionKey: nextSessionKey)
        }
    }

    private var chatHeaderAccessory: AnyView? {
        guard !self.compact else { return nil }
        return AnyView(
            HStack(spacing: 8) {
                Button("Apps") {
                    self.onOpenApps()
                }
                .buttonStyle(.bordered)
                .controlSize(.small)

                if self.supportsInspector {
                    Button(self.inspectorVisible ? "Hide activity" : "Activity") {
                        if self.inspectorVisible {
                            self.inspectorVisibility.hide(autoPresent: self.inspectorShouldAutoPresent)
                        } else {
                            self.inspectorVisibility.show()
                        }
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            })
    }

    private var chatOnlyStage: some View {
        AlisioChatView(
            viewModel: self.chatViewModel,
            showsSessionSwitcher: true,
            style: .alisio,
            assistantIdentity: .init(name: "Alisio"),
            userAccent: self.palette.accent,
            showsAssistantTrace: true,
            autoloadOnAppear: self.environment.autoloadChatOnAppear,
            headerAccessory: self.chatHeaderAccessory,
            onOpenApps: self.onOpenApps,
            voiceControl: self.voiceControl)
            .padding(self.compact ? 8 : 22)
            .background(self.palette.stage)
    }

    private var voiceControl: AlisioChatVoiceControl? {
        guard self.shouldShowVoiceControl else { return nil }
        return AlisioChatVoiceControl(
            isActive: self.state.talkEnabled,
            label: self.voiceControlLabel,
            onToggle: {
                Task {
                    await self.state.setTalkEnabled(!self.state.talkEnabled)
                }
            })
    }

    private var shouldShowVoiceControl: Bool {
        self.state.connectionMode == .local && voiceWakeSupported
    }

    private var voiceControlLabel: String {
        guard self.state.talkEnabled else { return "Talk off" }
        if self.talkController.isPaused {
            return "Talk paused"
        }
        switch self.talkController.phase {
        case .idle:
            return "Talk on"
        case .listening:
            return "Listening"
        case .thinking:
            return "Thinking"
        case .speaking:
            return "Speaking"
        }
    }

    private var shouldMonitorComputer: Bool {
        !self.compact && self.state.connectionMode == .local
    }

    private var supportsInspector: Bool {
        !self.compact
    }

    private var inspectorVisible: Bool {
        self.inspectorVisibility.isVisible(
            supportsInspector: self.supportsInspector,
            autoPresent: self.inspectorShouldAutoPresent)
    }

    private var trackedSessionKey: String {
        let trimmed = self.chatViewModel.sessionKey.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? self.sessionKey : trimmed
    }

    private var inspectorShouldAutoPresent: Bool {
        if self.chatViewModel.pendingRunCount > 0 || !self.chatViewModel.pendingToolCalls.isEmpty {
            return true
        }
        if self.currentSessionActivity != nil {
            return true
        }
        if self.shouldPresentComputerInspector {
            return true
        }
        return self.chatViewModel.activeErrorText != nil
    }

    private var shouldPresentComputerInspector: Bool {
        guard self.shouldMonitorComputer else { return false }
        guard self.matchesTrackedSession(sessionKey: self.computerStore.sessionKey) else { return false }
        return self.computerStore.shouldAutoPresentPane
    }

    private func syncPresentedSession(to nextSessionKey: String) {
        let trimmed = nextSessionKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        guard !self.matchesSessionKey(trimmed, self.chatViewModel.sessionKey) else { return }
        guard self.chatViewModel.canSwitchSessions else {
            self.onSessionChange(self.trackedSessionKey)
            return
        }
        self.chatViewModel.switchSession(to: trimmed)
    }

    private func replaceComputerStore(sessionKey rawSessionKey: String) {
        let sessionKey = rawSessionKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sessionKey.isEmpty else { return }
        guard !self.matchesSessionKey(self.computerStore.sessionKey, sessionKey) else { return }
        let shouldActivate = self.shouldMonitorComputer
        self.computerStore.deactivate()
        self.computerStore = self.environment.makeComputerStore(sessionKey)
        if shouldActivate {
            self.computerStore.activate()
        }
    }

    private var bootstrapStatus: (
        title: String,
        message: String,
        systemImage: String?,
        usesProgressView: Bool,
        tint: Color?
    )? {
        if self.state.connectionMode == .unconfigured {
            return (
                "Preparing Alisio",
                "Finish setup before opening chat.",
                "gearshape.2",
                false,
                self.palette.warning)
        }

        switch self.chatViewModel.connectionPhase {
        case .bootstrapping:
            return (
                "Opening your chat",
                "Loading recent messages and getting things ready.",
                nil,
                true,
                self.palette.accent)
        case .loading:
            return (
                "Refreshing chat",
                "Updating messages and chat details.",
                nil,
                true,
                self.palette.accent)
        case .reconnecting:
            return (
                "Reconnecting",
                "Restoring the live connection before showing the latest state.",
                "arrow.trianglehead.2.clockwise.rotate.90",
                false,
                self.palette.warning)
        case .firstMessage:
            return (
                "Starting your reply",
                "The first reply in a fresh chat can take a moment.",
                nil,
                true,
                self.palette.accent)
        case .ready:
            return nil
        }
    }

    private var recentEvents: [ControlAgentEvent] {
        Array(self.eventStore.events.reversed().filter { event in
            self.matchesTrackedSession(event: event)
        }.prefix(8))
    }

    private var currentSessionActivity: WorkActivityStore.Activity? {
        self.activityStore.activity(for: self.trackedSessionKey)
    }

    private var currentSessionToolActivity: WorkActivityStore.Activity? {
        guard let activity = self.currentSessionActivity else { return nil }
        guard case .tool = activity.kind else { return nil }
        return activity
    }

    private func matchesTrackedSession(event: ControlAgentEvent) -> Bool {
        self.matchesTrackedSession(sessionKey: event.sessionKey ?? (event.data["sessionKey"]?.value as? String))
    }

    private func matchesTrackedSession(sessionKey raw: String?) -> Bool {
        self.matchesSessionKey(raw, self.trackedSessionKey)
    }

    private func matchesSessionKey(_ lhs: String?, _ rhs: String?) -> Bool {
        let left = lhs?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        let right = rhs?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        guard !left.isEmpty, !right.isEmpty else { return left == right }
        return self.chatViewModel.sessionKeysMatch(left, right)
    }
}

@MainActor
private struct WorkspaceInspectorPane: View {
    @Bindable var state: AppState
    @Bindable var chatViewModel: AlisioChatViewModel
    @Bindable var computerStore: MacDesktopComputerStore
    @Bindable private var gatewayProcessManager = GatewayProcessManager.shared

    let palette: AlisioPalette
    let sessionKey: String
    let recentEvents: [ControlAgentEvent]
    let lastToolLabel: String?
    let lastToolUpdatedAt: Date?
    let onClose: @MainActor () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Activity")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(self.palette.primaryText)
                    Text(self.chatViewModel.currentSessionTitle)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(self.palette.secondaryText)
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
                Button {
                    self.onClose()
                } label: {
                    Image(systemName: "sidebar.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(self.palette.secondaryText)
                        .frame(width: 30, height: 30)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(self.palette.surfaceMuted)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                                        .strokeBorder(self.palette.border, lineWidth: 1)))
                }
                .buttonStyle(.plain)
                .help("Hide activity")
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)

            Rectangle()
                .fill(self.palette.separator)
                .frame(height: 1)

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    WorkspaceInspectorCard(
                        title: "Chat",
                        subtitle: self.chatSummary)
                    {
                        VStack(alignment: .leading, spacing: 8) {
                            self.metaRow("Key", self.sessionKey)
                            self.metaRow("Title", self.chatViewModel.currentSessionTitle)
                            if let sessionId = self.chatViewModel.sessionId, !sessionId.isEmpty {
                                self.metaRow("Session ID", sessionId)
                            }
                            self.metaRow("Runtime", self.runtimeLabel)
                            self.metaRow("Surface", "Mac app")
                            if let lastToolLabel, !lastToolLabel.isEmpty {
                                self.metaRow("Last tool", lastToolLabel)
                            }
                            if let lastToolUpdatedAt {
                                self.metaRow("Updated", lastToolUpdatedAt.formatted(date: .omitted, time: .standard))
                            }
                        }
                    }

                    WorkspaceInspectorCard(
                        title: "Identity",
                        subtitle: self.identitySummary)
                    {
                        VStack(alignment: .leading, spacing: 8) {
                            self.metaRow("Assistant", "Alisio")
                            self.metaRow("Operator", InstanceIdentity.displayName)
                            if self.state.connectionMode == .remote {
                                self.metaRow("Gateway", self.remoteGatewayLabel)
                                if let sshIdentity = self.remoteIdentityLabel {
                                    self.metaRow("SSH key", sshIdentity)
                                }
                            } else {
                                self.metaRow("Gateway", self.gatewayProcessManager.status.label)
                            }
                        }
                    }

                    WorkspaceInspectorCard(
                        title: "Memory",
                        subtitle: self.memorySummary)
                    {
                        VStack(alignment: .leading, spacing: 12) {
                            if let contextUsage = self.chatViewModel.currentSessionContextUsage {
                                VStack(alignment: .leading, spacing: 8) {
                                    HStack(spacing: 8) {
                                        Text("Context")
                                            .font(.system(size: 12, weight: .semibold))
                                            .foregroundStyle(self.palette.tertiaryText)
                                        Spacer()
                                        Text(self.contextUsageLabel(contextUsage))
                                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                                            .foregroundStyle(self.palette.secondaryText)
                                    }
                                    ContextUsageBar(
                                        usedTokens: contextUsage.totalTokens,
                                        contextTokens: contextUsage.contextWindow,
                                        width: nil)
                                    self.metaRow("Messages", "\(self.chatViewModel.messages.count)")
                                    self.metaRow("Thinking", self.chatViewModel.activeThinkingLevelLabel)
                                    self.metaRow("Model", self.chatViewModel.activeModelLabel)
                                }
                            } else {
                                Text("Context usage appears here once the gateway reports token counts for this chat.")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(self.palette.secondaryText)
                            }

                            HStack(spacing: 10) {
                                Button("Compact memory") {
                                    self.chatViewModel.compactSession()
                                }
                                .buttonStyle(AlisioPrimaryButtonStyle(palette: self.palette))
                                .disabled(!self.chatViewModel.canCompactSession)

                                Button("Reset chat") {
                                    self.chatViewModel.resetSession()
                                }
                                .buttonStyle(AlisioGhostButtonStyle(palette: self.palette, isDanger: true))
                                .disabled(!self.chatViewModel.canResetSession)
                            }
                        }
                    }

                    WorkspaceInspectorCard(
                        title: "Connection",
                        subtitle: self.connectionSummary)
                    {
                        VStack(alignment: .leading, spacing: 8) {
                            self.metaRow("Phase", self.connectionPhaseTitle)
                            self.metaRow("Health", self.chatViewModel.healthOK ? "Healthy" : "Degraded")
                            if let lastHistoryRefreshAt = self.chatViewModel.lastHistoryRefreshAt {
                                self.metaRow("Last sync", lastHistoryRefreshAt.formatted(date: .omitted, time: .standard))
                            }
                            if let lastTransportEventAt = self.chatViewModel.lastTransportEventAt {
                                self.metaRow("Last event", lastTransportEventAt.formatted(date: .omitted, time: .standard))
                            }
                            if let lastRecoveryAt = self.chatViewModel.lastRecoveryAt {
                                self.metaRow("Recovered", lastRecoveryAt.formatted(date: .omitted, time: .standard))
                            }
                            if self.state.connectionMode == .local {
                                self.metaRow("Gateway", self.gatewayProcessManager.status.label)
                            } else {
                                self.metaRow("Gateway", self.remoteGatewayLabel)
                            }
                        }
                    }

                    if self.shouldShowRunStatus {
                        WorkspaceInspectorCard(
                            title: "Run state",
                            subtitle: self.runStatusTitle)
                        {
                            VStack(alignment: .leading, spacing: 10) {
                                if let errorText = self.chatViewModel.activeErrorText {
                                    Text(errorText)
                                        .font(.system(size: 12, weight: .medium))
                                        .foregroundStyle(self.palette.danger)
                                } else if self.chatViewModel.connectionPhase == .reconnecting {
                                    Text("The workspace is resyncing after a dropped stream or failed health check.")
                                        .font(.system(size: 12, weight: .medium))
                                        .foregroundStyle(self.palette.secondaryText)
                                } else if self.chatViewModel.connectionPhase == .firstMessage {
                                    Text("The first visible assistant turn is still warming up.")
                                        .font(.system(size: 12, weight: .medium))
                                        .foregroundStyle(self.palette.secondaryText)
                                } else if self.chatViewModel.pendingRunCount > 0 {
                                    Text("Waiting for the assistant, tools, or both to start producing output.")
                                        .font(.system(size: 12, weight: .medium))
                                        .foregroundStyle(self.palette.secondaryText)
                                } else if !self.chatViewModel.pendingToolCalls.isEmpty {
                                    Text("Tools are currently running for this session.")
                                        .font(.system(size: 12, weight: .medium))
                                        .foregroundStyle(self.palette.secondaryText)
                                }
                            }
                        }
                    }

                    if !self.chatViewModel.pendingToolCalls.isEmpty {
                        WorkspaceInspectorCard(
                            title: "Active tools",
                            subtitle: "Live tool calls for this chat")
                        {
                            VStack(alignment: .leading, spacing: 10) {
                                ForEach(self.chatViewModel.pendingToolCalls) { toolCall in
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(self.toolSummary(for: toolCall))
                                            .font(.system(size: 13, weight: .semibold))
                                            .foregroundStyle(self.palette.primaryText)
                                        if let startedAt = toolCall.startedAt {
                                            Text(self.timeString(fromUnixMs: startedAt))
                                                .font(.system(size: 11, weight: .medium))
                                                .foregroundStyle(self.palette.tertiaryText)
                                        }
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(10)
                                    .background(
                                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                                            .fill(self.palette.surfaceMuted))
                                }
                            }
                        }
                    }

                    if self.state.connectionMode == .local {
                        DesktopComputerPane(store: self.computerStore, palette: self.palette)
                    }

                    if !self.recentEvents.isEmpty {
                        WorkspaceInspectorCard(
                            title: "Recent activity",
                            subtitle: "Latest runtime events routed to this chat")
                        {
                            VStack(alignment: .leading, spacing: 10) {
                                ForEach(self.recentEvents, id: \.id) { event in
                                    VStack(alignment: .leading, spacing: 4) {
                                        HStack(spacing: 8) {
                                            Text(self.eventLabel(for: event))
                                                .font(.system(size: 12, weight: .semibold))
                                                .foregroundStyle(self.palette.primaryText)
                                            Spacer()
                                            Text(self.timeString(fromUnixMs: event.ts))
                                                .font(.system(size: 11, weight: .medium))
                                                .foregroundStyle(self.palette.tertiaryText)
                                        }
                                        Text(self.eventDetail(for: event))
                                            .font(.system(size: 12, weight: .medium))
                                            .foregroundStyle(self.palette.secondaryText)
                                            .fixedSize(horizontal: false, vertical: true)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(10)
                                    .background(
                                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                                            .fill(self.palette.surfaceMuted))
                                }
                            }
                        }
                    }
                }
                .padding(18)
            }
        }
        .background(self.palette.surface)
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(self.palette.separator)
                .frame(width: 1)
        }
    }

    private var shouldShowRunStatus: Bool {
        self.chatViewModel.connectionPhase != .ready ||
            self.chatViewModel.pendingRunCount > 0 ||
            !self.chatViewModel.pendingToolCalls.isEmpty ||
            self.chatViewModel.activeErrorText != nil
    }

    private var runStatusTitle: String {
        if self.chatViewModel.activeErrorText != nil {
            return "Blocked"
        }
        if self.chatViewModel.connectionPhase == .reconnecting {
            return "Reconnecting"
        }
        if self.chatViewModel.connectionPhase == .bootstrapping {
            return "Bootstrapping"
        }
        if self.chatViewModel.connectionPhase == .loading {
            return "Refreshing"
        }
        if self.chatViewModel.connectionPhase == .firstMessage {
            return "First reply"
        }
        if !self.chatViewModel.pendingToolCalls.isEmpty {
            return "Tools running"
        }
        if self.chatViewModel.pendingRunCount > 0 {
            return "Response in progress"
        }
        return "Idle"
    }

    private var chatSummary: String {
        let subtitle = self.chatViewModel.currentSessionSubtitle.trimmingCharacters(in: .whitespacesAndNewlines)
        if !subtitle.isEmpty {
            return subtitle
        }
        if self.chatViewModel.connectionPhase == .reconnecting {
            return "The native workspace is recovering this chat before it trusts live state again."
        }
        return "This pane keeps chat, identity, memory, and runtime state visible while you work."
    }

    private var identitySummary: String {
        self.state.connectionMode == .local
            ? "Who owns the chat and which local runtime is serving it."
            : "Who owns the chat and which remote runtime is attached over SSH."
    }

    private var memorySummary: String {
        "Chat context, model selection, and native memory controls."
    }

    private var connectionSummary: String {
        switch self.chatViewModel.connectionPhase {
        case .bootstrapping:
            "Initial load before the workspace trusts the chat."
        case .loading:
            "Refreshing native state from the gateway."
        case .reconnecting:
            "Live transport degraded; the workspace is resyncing."
        case .firstMessage:
            "The first reply is still warming up."
        case .ready:
            "Current health and recency of the native data plane."
        }
    }

    private var runtimeLabel: String {
        switch self.state.connectionMode {
        case .local:
            "This Mac"
        case .remote:
            "Remote"
        case .unconfigured:
            "Unconfigured"
        }
    }

    private var remoteGatewayLabel: String {
        let target = self.state.remoteTarget.trimmingCharacters(in: .whitespacesAndNewlines)
        if !target.isEmpty {
            return target
        }
        let url = self.state.remoteUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        return url.isEmpty ? "Remote gateway" : url
    }

    private var remoteIdentityLabel: String? {
        let trimmed = self.state.remoteIdentity.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return URL(fileURLWithPath: trimmed).lastPathComponent
    }

    private var connectionPhaseTitle: String {
        switch self.chatViewModel.connectionPhase {
        case .bootstrapping:
            "Bootstrapping"
        case .loading:
            "Refreshing"
        case .reconnecting:
            "Reconnecting"
        case .firstMessage:
            "First reply"
        case .ready:
            "Ready"
        }
    }

    private func contextUsageLabel(_ usage: AlisioChatSessionContextUsage) -> String {
        let used = Self.formatCompactTokenCount(usage.totalTokens)
        let total = usage.contextWindow > 0 ? Self.formatCompactTokenCount(usage.contextWindow) : "?"
        return "\(used)/\(total)"
    }

    private func toolSummary(for toolCall: AlisioChatPendingToolCall) -> String {
        let summary = ToolDisplayRegistry.resolve(name: toolCall.name, args: toolCall.args, meta: nil)
        return summary.summaryLine
    }

    private func eventLabel(for event: ControlAgentEvent) -> String {
        if let summary = event.summary?.trimmingCharacters(in: .whitespacesAndNewlines),
           !summary.isEmpty
        {
            return summary
        }

        switch event.stream {
        case "tool":
            let phase = event.data["phase"]?.value as? String ?? "update"
            let name = event.data["name"]?.value as? String ?? "tool"
            return "\(name) · \(phase)"
        case "job":
            let state = event.data["state"]?.value as? String ?? "update"
            return "job · \(state)"
        case "assistant":
            return "assistant"
        default:
            return event.stream
        }
    }

    private func eventDetail(for event: ControlAgentEvent) -> String {
        switch event.stream {
        case "tool":
            let name = event.data["name"]?.value as? String
            let args = event.data["args"].map(AnyCodable.init)
            let summary = ToolDisplayRegistry.resolve(name: name, args: args, meta: event.summary)
            return summary.detailLine ?? "No additional tool detail."
        case "assistant":
            if let text = event.data["text"]?.value as? String {
                let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty {
                    return trimmed
                }
            }
            return "Assistant updated the current reply."
        case "job":
            if let state = event.data["state"]?.value as? String {
                return "Job state: \(state)"
            }
            return "Job activity updated."
        default:
            return "Runtime event received."
        }
    }

    private func timeString(fromUnixMs timestamp: Double) -> String {
        let date = Date(timeIntervalSince1970: timestamp / 1000)
        return date.formatted(date: .omitted, time: .standard)
    }

    private static func formatCompactTokenCount(_ value: Int) -> String {
        guard value >= 1000 else { return "\(value)" }
        let thousands = Double(value) / 1000
        let decimals = value >= 10_000 ? 0 : 1
        return String(format: "%.\(decimals)fk", thousands)
    }

    private func metaRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text(label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(self.palette.tertiaryText)
                .frame(width: 70, alignment: .leading)
            Text(value)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(self.palette.primaryText)
                .lineLimit(2)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
    }
}

#if DEBUG
@MainActor
private extension AlisioWorkspaceChatEnvironment {
    static func previewReadyLocal() -> Self {
        let sessionKey = "main"
        return Self(
            makeChatViewModel: { _ in
                AlisioChatViewModel.preview(
                    sessionKey: sessionKey,
                    sessionId: "sess-main",
                    messages: Self.previewTranscript(),
                    sessions: [Self.previewSessionEntry(key: sessionKey)],
                    thinkingLevel: "medium",
                    healthOK: true)
            },
            makeComputerStore: { _ in
                MacDesktopComputerStore.preview(
                    sessionKey: sessionKey,
                    sessionState: .running,
                    runtime: MacNodeComputerRuntimeHealthPayload(
                        connectionState: .running,
                        launchCount: 1,
                        helper: nil,
                        lastError: nil),
                    lastUpdatedAt: Date())
            },
            autoloadChatOnAppear: false)
    }

    static func previewFirstReply() -> Self {
        let sessionKey = "main"
        return Self(
            makeChatViewModel: { _ in
                AlisioChatViewModel.preview(
                    sessionKey: sessionKey,
                    sessionId: "sess-main",
                    messages: [Self.previewUserMessage()],
                    sessions: [Self.previewSessionEntry(key: sessionKey)],
                    thinkingLevel: "low",
                    healthOK: true,
                    pendingRunCount: 1)
            },
            makeComputerStore: { _ in
                MacDesktopComputerStore.preview(sessionKey: sessionKey)
            },
            autoloadChatOnAppear: false)
    }

    static func previewRemoteReconnect() -> Self {
        let sessionKey = "work"
        return Self(
            makeChatViewModel: { _ in
                AlisioChatViewModel.preview(
                    sessionKey: sessionKey,
                    sessionId: "sess-work",
                    messages: Self.previewTranscript(),
                    sessions: [Self.previewSessionEntry(key: sessionKey, displayName: "work", provider: "openai")],
                    thinkingLevel: "high",
                    healthOK: false,
                    isRecoveringConnection: true,
                    lastHistoryRefreshAt: Date().addingTimeInterval(-50),
                    lastTransportEventAt: Date().addingTimeInterval(-24),
                    lastRecoveryAt: Date())
            },
            makeComputerStore: { _ in
                MacDesktopComputerStore.preview(
                    sessionKey: sessionKey,
                    runtime: MacNodeComputerRuntimeHealthPayload(
                        connectionState: .interrupted,
                        launchCount: 0,
                        helper: nil,
                        lastError: nil))
            },
            autoloadChatOnAppear: false)
    }

    private static func previewTranscript() -> [AlisioChatMessage] {
        [
            self.previewUserMessage(),
            AlisioChatMessage(
                role: "assistant",
                content: [
                    AlisioChatMessageContent(
                        type: "text",
                        text: "The native stage is consolidated and the right pane keeps chat, memory, and connection state visible.",
                        thinking: nil,
                        thinkingSignature: nil,
                        mimeType: nil,
                        fileName: nil,
                        content: nil),
                ],
                timestamp: Date().timeIntervalSince1970 * 1000),
        ]
    }

    private static func previewUserMessage() -> AlisioChatMessage {
        AlisioChatMessage(
            role: "user",
            content: [
                AlisioChatMessageContent(
                    type: "text",
                    text: "Finish the native macOS workspace hardening.",
                    thinking: nil,
                    thinkingSignature: nil,
                    mimeType: nil,
                    fileName: nil,
                    content: nil),
            ],
            timestamp: Date().addingTimeInterval(-45).timeIntervalSince1970 * 1000)
    }

    private static func previewSessionEntry(
        key: String,
        displayName: String? = "Main",
        provider: String? = "anthropic") -> AlisioChatSessionEntry
    {
        AlisioChatSessionEntry(
            key: key,
            kind: "direct",
            displayName: displayName,
            surface: "mac",
            subject: nil,
            room: nil,
            space: nil,
            updatedAt: Date().timeIntervalSince1970 * 1000,
            sessionId: "sess-\(key)",
            systemSent: false,
            abortedLastRun: false,
            thinkingLevel: "medium",
            verboseLevel: "info",
            inputTokens: 4200,
            outputTokens: 1600,
            totalTokens: 5800,
            modelProvider: provider,
            model: provider == "openai" ? "gpt-5.4" : "claude-opus-4-6",
            contextTokens: 200_000)
    }
}

struct AlisioWorkspaceRootView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            AlisioWorkspaceRootView(
                navigationState: self.workspaceState(sessionKey: "main"),
                state: .preview,
                presentation: .window,
                updater: nil,
                chatEnvironment: AlisioWorkspaceChatEnvironment.previewReadyLocal())
                .previewDisplayName("Native Workspace · Ready")
                .frame(width: 1360, height: 860)

            AlisioWorkspaceRootView(
                navigationState: self.workspaceState(sessionKey: "main"),
                state: .preview,
                presentation: .window,
                updater: nil,
                chatEnvironment: AlisioWorkspaceChatEnvironment.previewFirstReply())
                .previewDisplayName("Native Workspace · First Reply")
                .frame(width: 1360, height: 860)

            AlisioWorkspaceRootView(
                navigationState: self.remoteWorkspaceState(sessionKey: "work"),
                state: self.remotePreviewState(),
                presentation: .window,
                updater: nil,
                chatEnvironment: AlisioWorkspaceChatEnvironment.previewRemoteReconnect())
                .previewDisplayName("Native Workspace · Remote Reconnect")
                .frame(width: 1360, height: 860)
        }
    }

    fileprivate static func workspaceState(sessionKey: String) -> WorkspaceNavigationState {
        let state = WorkspaceNavigationState()
        state.showChat(sessionKey: sessionKey)
        return state
    }

    fileprivate static func remoteWorkspaceState(sessionKey: String) -> WorkspaceNavigationState {
        let state = WorkspaceNavigationState()
        state.showChat(sessionKey: sessionKey)
        return state
    }

    fileprivate static func remotePreviewState() -> AppState {
        let state = AppState.preview
        state.connectionMode = .remote
        state.remoteTarget = "ops@example.net"
        state.remoteUrl = "wss://gateway.example.net"
        state.remoteIdentity = "~/.ssh/workspace-prod"
        return state
    }
}

#endif

@MainActor
private struct WorkspaceInspectorCard<Content: View>: View {
    let title: String
    let subtitle: String?
    let content: Content

    init(title: String, subtitle: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.subtitle = subtitle
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(self.title)
                    .font(.system(size: 16, weight: .semibold))
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.secondary)
                }
            }

            self.content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color(nsColor: .controlBackgroundColor))
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(Color.primary.opacity(0.06), lineWidth: 1)))
    }
}

@MainActor
private struct WorkspaceStatusBanner: View {
    let title: String
    let message: String
    let palette: AlisioPalette
    let systemImage: String?
    let usesProgressView: Bool
    let tint: Color?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Group {
                if self.usesProgressView {
                    ProgressView()
                        .controlSize(.small)
                        .tint(self.tint ?? self.palette.accent)
                } else if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(self.tint ?? self.palette.warning)
                }
            }
            .padding(.top, 2)
            VStack(alignment: .leading, spacing: 4) {
                Text(self.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(self.palette.primaryText)
                Text(self.message)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(self.palette.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(self.palette.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(self.palette.border, lineWidth: 1)))
    }
}

@MainActor
private struct DesktopComputerPane: View {
    @Bindable var store: MacDesktopComputerStore

    let palette: AlisioPalette

    var body: some View {
        WorkspaceInspectorCard(
            title: "Computer",
            subtitle: self.store.statusLabel)
        {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("computer use")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(self.palette.tertiaryText)
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

                if self.store.showsPermissionActions {
                    VStack(alignment: .leading, spacing: 10) {
                        if let restartHint = self.store.permissionRestartHint {
                            Button {
                                DebugActions.restartApp()
                            } label: {
                                Label("Restart Alisio", systemImage: "arrow.clockwise")
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 10)
                            }
                            .buttonStyle(AlisioPrimaryButtonStyle(palette: self.palette))
                            Text(restartHint)
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(self.palette.secondaryText)
                        } else {
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
                        }
                    }
                }

                HStack(spacing: 10) {
                    if self.store.sessionState == .running {
                        Button("Pause") { self.store.pause() }
                            .buttonStyle(AlisioGhostButtonStyle(palette: self.palette))
                            .disabled(self.store.isBusy)
                    } else if self.store.sessionState == .paused {
                        Button("Resume") { self.store.resume() }
                            .buttonStyle(AlisioPrimaryButtonStyle(palette: self.palette))
                            .disabled(self.store.isBusy)
                    } else {
                        Button("Start") { self.store.start() }
                            .buttonStyle(AlisioPrimaryButtonStyle(palette: self.palette))
                            .disabled(!self.store.canStartSession || self.store.isBusy)
                    }

                    Button("Stop") { self.store.stop() }
                        .buttonStyle(AlisioGhostButtonStyle(palette: self.palette, isDanger: true))
                        .disabled(self.store.sessionState == .stopped || self.store.isBusy)
                }
            }
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
        if let blockingSummary = self.store.blockingSummary {
            return blockingSummary
        }
        if let errorText = self.store.errorText, !errorText.isEmpty {
            return errorText
        }
        if let restartHint = self.store.permissionRestartHint {
            return restartHint
        }
        if self.store.needsObservationPermission {
            return "Grant Screen Recording to observe this Mac."
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
            if self.store.runtime.connectionState == .starting {
                return "computer helper cold start in progress"
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
