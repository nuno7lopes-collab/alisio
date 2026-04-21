import AlisioChatUI
import AlisioKit
import SwiftUI
import Observation

import AlisioSupport

private enum AlisioWorkspaceSidebarItem: String, CaseIterable, Identifiable {
    case chat
    case apps
    case automations
    case capabilities
    case connections
    case settings

    var id: String { self.rawValue }

    var title: String {
        switch self {
        case .chat: "Chat"
        case .apps: "Apps"
        case .automations: "Automations"
        case .capabilities: "Capabilities"
        case .connections: "Connections"
        case .settings: "Settings"
        }
    }

    var systemImage: String {
        switch self {
        case .chat: "bubble.left.and.bubble.right"
        case .apps: "link"
        case .automations: "calendar"
        case .capabilities: "sparkles"
        case .connections: "network"
        case .settings: "gearshape"
        }
    }

    init(route: AlisioShellState.Route) {
        switch route {
        case .chat, .home, .onboarding, .sessions:
            self = .chat
        case .authentications:
            self = .apps
        case .automations:
            self = .automations
        case .agents:
            self = .capabilities
        case .organization:
            self = .connections
        case .settings:
            self = .settings
        }
    }

    @MainActor
    func apply(to shellState: AlisioShellState) {
        switch self {
        case .chat:
            shellState.showChat(sessionKey: shellState.activeSessionKey ?? "main")
        case .apps:
            shellState.show(route: .authentications)
        case .automations:
            shellState.show(route: .automations)
        case .capabilities:
            shellState.show(route: .agents)
        case .connections:
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
        case .workspace, .appearance:
            .general
        case .communications:
            .channels
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
                    Text("Native macOS workspace")
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
                    title: self.state.connectionMode == .local ? "Local runtime" : "Remote runtime",
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
        case .chat, .home, .sessions:
            "Chat"
        case .authentications:
            "Apps"
        case .automations:
            "Automations"
        case .agents:
            "Capabilities"
        case .organization:
            "Connections"
        case .settings:
            "Settings"
        case .onboarding:
            "Welcome"
        }
    }

    private var stageSubtitle: String {
        switch self.shellState.route {
        case .chat, .home, .sessions:
            "Native chat, memory, and a real macOS inspector for computer use."
        case .authentications:
            "Configure connected apps and account surfaces."
        case .automations:
            "Review and edit scheduled automations."
        case .agents:
            "Manage skills and agent behavior."
        case .organization:
            "Inspect connections and local infrastructure."
        case .settings:
            "Adjust app, lifecycle, and permission behavior."
        case .onboarding:
            "Complete the desktop setup and permissions."
        }
    }

    @ViewBuilder
    private func workspaceContent(compact: Bool) -> some View {
        switch self.shellState.route {
        case .onboarding:
            OnboardingView(state: self.state, shellOnboarding: self.shellState.onboardingState)
                .padding(compact ? 14 : 24)
        case .home, .chat, .sessions:
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
    @Bindable private var activityStore = WorkActivityStore.shared
    @Bindable private var eventStore = AgentEventStore.shared

    let sessionKey: String
    let palette: AlisioPalette
    let compact: Bool

    @State private var chatViewModel: AlisioChatViewModel
    @State private var computerStore: MacDesktopComputerStore
    @State private var inspectorVisible = false
    @State private var lastDismissedActivityID: String?

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
        VStack(spacing: self.compact ? 0 : 14) {
            if !self.compact {
                self.chatHeader
                    .padding(.horizontal, 22)
                    .padding(.top, 20)
            }

            if let status = self.bootstrapStatus {
                WorkspaceStatusBanner(
                    title: status.title,
                    message: status.message,
                    palette: self.palette)
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
                            sessionKey: self.sessionKey,
                            recentEvents: self.recentEvents,
                            lastToolLabel: self.activityStore.lastToolLabel,
                            lastToolUpdatedAt: self.activityStore.lastToolUpdatedAt)
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
            self.syncInspectorVisibility()
        }
        .onDisappear {
            self.computerStore.deactivate()
        }
        .onChange(of: self.inspectorActivityID) { _, _ in
            self.syncInspectorVisibility()
        }
        .onChange(of: self.state.connectionMode) { _, _ in
            self.syncInspectorVisibility()
        }
        .onAppear {
            self.syncInspectorVisibility()
        }
    }

    private var chatHeader: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Workspace")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(self.palette.primaryText)
                Text(self.chatHeaderSubtitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(self.palette.secondaryText)
            }
            Spacer()
            AlisioChip(
                title: self.state.connectionMode == .local ? "This Mac" : "Remote",
                tint: self.state.connectionMode == .local ? self.palette.success : self.palette.warning,
                palette: self.palette)
            if self.inspectorVisible {
                Button("Hide pane") {
                    self.lastDismissedActivityID = self.inspectorActivityID
                    self.inspectorVisible = false
                }
                .buttonStyle(AlisioGhostButtonStyle(palette: self.palette))
            } else {
                Button("Show pane") {
                    self.lastDismissedActivityID = nil
                    self.inspectorVisible = true
                }
                .buttonStyle(AlisioPrimaryButtonStyle(palette: self.palette))
            }
        }
    }

    private var chatHeaderSubtitle: String {
        if self.state.connectionMode == .local {
            return self.inspectorActivityID == nil
                ? "Computer use and tool output appear here when the runtime becomes active."
                : "The inspector is following live computer use and tool activity for this session."
        }
        return "Tool activity and run state stay visible here even when the runtime is remote."
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

    private var shouldMonitorComputer: Bool {
        !self.compact && self.state.connectionMode == .local
    }

    private var supportsInspector: Bool {
        !self.compact
    }

    private var bootstrapStatus: (title: String, message: String)? {
        if self.chatViewModel.isLoading {
            switch self.state.connectionMode {
            case .local:
                return (
                    "Connecting to the local runtime",
                    "Loading session history, health, and available models before the first turn.")
            case .remote:
                return (
                    "Connecting to the remote runtime",
                    "Loading session history over the current control connection before the first turn.")
            case .unconfigured:
                return (
                    "Preparing Alisio",
                    "The workspace is waiting for a configured runtime.")
            }
        }

        let hasVisibleReply = self.chatViewModel.streamingAssistantText?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .isEmpty == false
        if self.chatViewModel.messages.isEmpty,
           self.chatViewModel.pendingRunCount > 0,
           !hasVisibleReply,
           self.chatViewModel.pendingToolCalls.isEmpty
        {
            return (
                "Starting the first response",
                "The first turn can take longer while the runtime warms up and tools attach to the session.")
        }

        return nil
    }

    private var inspectorActivityID: String? {
        var parts: [String] = []

        if !self.chatViewModel.pendingToolCalls.isEmpty {
            let startedAt = self.chatViewModel.pendingToolCalls
                .compactMap(\.startedAt)
                .max() ?? 0
            let ids = self.chatViewModel.pendingToolCalls.map(\.toolCallId).sorted().joined(separator: ",")
            parts.append("pending-tools:\(ids):\(Int(startedAt))")
        }

        if let lastToolUpdatedAt = self.activityStore.lastToolUpdatedAt {
            parts.append("activity:\(Int(lastToolUpdatedAt.timeIntervalSince1970 * 1000))")
        }

        if let lastUpdatedAt = self.computerStore.lastUpdatedAt {
            parts.append("computer-frame:\(Int(lastUpdatedAt.timeIntervalSince1970 * 1000))")
        }

        if let errorText = self.computerStore.errorText?.trimmingCharacters(in: .whitespacesAndNewlines),
           !errorText.isEmpty
        {
            parts.append("computer-error:\(errorText)")
        }

        if let errorText = self.chatViewModel.errorText?.trimmingCharacters(in: .whitespacesAndNewlines),
           !errorText.isEmpty
        {
            parts.append("chat-error:\(errorText)")
        }

        if self.chatViewModel.pendingRunCount > 0 {
            parts.append("pending-run:\(self.chatViewModel.pendingRunCount)")
        }

        if let eventID = self.recentEvents.first?.id {
            parts.append("event:\(eventID)")
        }

        guard !parts.isEmpty else { return nil }
        return parts.joined(separator: "|")
    }

    private var recentEvents: [ControlAgentEvent] {
        Array(self.eventStore.events.reversed().filter { event in
            self.matchesCurrentSession(event: event)
        }.prefix(8))
    }

    private func matchesCurrentSession(event: ControlAgentEvent) -> Bool {
        let raw = event.data["sessionKey"]?.value as? String
        let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if trimmed.isEmpty {
            return self.sessionKey == "main" || self.sessionKey == "agent:main:main"
        }
        return trimmed == self.sessionKey ||
            (trimmed == "agent:main:main" && self.sessionKey == "main") ||
            (trimmed == "main" && self.sessionKey == "agent:main:main")
    }

    private func syncInspectorVisibility() {
        guard self.supportsInspector else {
            self.inspectorVisible = false
            return
        }

        guard let activityID = self.inspectorActivityID else {
            return
        }

        guard activityID != self.lastDismissedActivityID else {
            return
        }

        self.inspectorVisible = true
    }
}

@MainActor
private struct WorkspaceInspectorPane: View {
    @Bindable var state: AppState
    @Bindable var chatViewModel: AlisioChatViewModel
    @Bindable var computerStore: MacDesktopComputerStore

    let palette: AlisioPalette
    let sessionKey: String
    let recentEvents: [ControlAgentEvent]
    let lastToolLabel: String?
    let lastToolUpdatedAt: Date?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                WorkspaceInspectorCard(
                    title: "Session",
                    subtitle: self.sessionSummary)
                {
                    VStack(alignment: .leading, spacing: 8) {
                        self.metaRow("Session", self.sessionKey)
                        self.metaRow("Runtime", self.state.connectionMode == .local ? "This Mac" : "Remote")
                        if let lastToolLabel, !lastToolLabel.isEmpty {
                            self.metaRow("Last tool", lastToolLabel)
                        }
                        if let lastToolUpdatedAt {
                            self.metaRow("Updated", lastToolUpdatedAt.formatted(date: .omitted, time: .standard))
                        }
                    }
                }

                if self.shouldShowRunStatus {
                    WorkspaceInspectorCard(
                        title: "Run state",
                        subtitle: self.runStatusTitle)
                    {
                        VStack(alignment: .leading, spacing: 10) {
                            if let errorText = self.chatViewModel.errorText?.trimmingCharacters(in: .whitespacesAndNewlines),
                               !errorText.isEmpty
                            {
                                Text(errorText)
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(self.palette.danger)
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
                        subtitle: "Live tool calls for this session")
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
                        subtitle: "Latest runtime events routed to this session")
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
        .background(self.palette.surface)
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(self.palette.separator)
                .frame(width: 1)
        }
    }

    private var shouldShowRunStatus: Bool {
        self.chatViewModel.pendingRunCount > 0 ||
            !self.chatViewModel.pendingToolCalls.isEmpty ||
            ((self.chatViewModel.errorText?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) == false)
    }

    private var runStatusTitle: String {
        if let errorText = self.chatViewModel.errorText?.trimmingCharacters(in: .whitespacesAndNewlines),
           !errorText.isEmpty
        {
            return "Blocked"
        }
        if !self.chatViewModel.pendingToolCalls.isEmpty {
            return "Tools running"
        }
        if self.chatViewModel.pendingRunCount > 0 {
            return "Response in progress"
        }
        return "Idle"
    }

    private var sessionSummary: String {
        if self.chatViewModel.pendingRunCount > 0 {
            return "The session is live and waiting for the next visible update."
        }
        if !self.chatViewModel.pendingToolCalls.isEmpty {
            return "Tool output is still in flight."
        }
        return "This pane opens automatically when the runtime starts doing real work."
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

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ProgressView()
                .controlSize(.small)
                .tint(self.palette.accent)
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

                if self.store.needsObservationPermission || self.store.needsControlPermission {
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
