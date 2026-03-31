import AppKit
import Observation
import OpenClawChatUI
import SwiftUI

private let lumeThinkingDefaultsKey = "openclaw.webchat.thinkingLevel"

struct LumeChatStageView: View {
    private struct SidebarSessionItem: Identifiable, Hashable {
        let id: String
        let key: String
        let title: String
        let subtitle: String
        let updatedLabel: String
        let isMain: Bool
    }

    let sessionKey: String
    let accentHex: String?
    let palette: LumePalette
    @Bindable var shellState: LumeShellState
    let connectionLabel: String
    let onSessionKeyChanged: (String) -> Void
    let openSettings: () -> Void
    let openAuthentications: () -> Void

    @State private var sessionItems: [SidebarSessionItem] = []
    @State private var sessionSearchQuery = ""
    @State private var isLoadingSessions = false
    @State private var sessionsError: String?

    private let sessionsTransport = MacGatewayChatTransport()

    private var visibleSessionItems: [SidebarSessionItem] {
        let query = self.sessionSearchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let base = self.sessionItems.isEmpty ? [self.fallbackCurrentSession] : self.sessionItems
        let filtered = query.isEmpty ? base : base.filter {
            $0.title.lowercased().contains(query)
                || $0.subtitle.lowercased().contains(query)
                || $0.key.lowercased().contains(query)
        }
        if filtered.contains(where: { $0.key == self.sessionKey }) {
            return filtered
        }
        return [self.fallbackCurrentSession] + filtered
    }

    private var pinnedSessions: [SidebarSessionItem] {
        let candidates = self.visibleSessionItems.filter { $0.key == self.sessionKey || $0.isMain }
        return Array(Set(candidates)).sorted { lhs, rhs in
            if lhs.key == self.sessionKey { return true }
            if rhs.key == self.sessionKey { return false }
            return lhs.title < rhs.title
        }
    }

    private var recentSessions: [SidebarSessionItem] {
        self.visibleSessionItems.filter { item in
            !self.pinnedSessions.contains(item)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            self.header
            Rectangle()
                .fill(self.palette.separator)
                .frame(height: 1)
            HStack(spacing: 0) {
                self.utilityRail
                Rectangle()
                    .fill(self.palette.separator)
                    .frame(width: 1)
                if !self.shellState.isAssistantSidebarCollapsed {
                    self.sessionsSidebar
                    Rectangle()
                        .fill(self.palette.separator)
                        .frame(width: 1)
                }
                self.conversationStage
            }
        }
        .background(self.palette.stage)
        .task(id: self.sessionKey) {
            await self.reloadSessions()
        }
    }

    private var header: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    Text("Lume")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(self.palette.primaryText)

                    LumeChip(
                        title: self.connectionLabel,
                        tint: self.connectionLabel == "Connected" ? self.palette.success : self.palette.warning,
                        palette: self.palette)
                }

                Text("Your private desktop layer for local execution, agent sessions, and chat.")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(self.palette.secondaryText)
            }

            Spacer(minLength: 0)

            self.headerButton("Schedules", symbol: "calendar")
            self.headerButton("Tasks", symbol: "checklist")

            Menu {
                Button("Open Settings", action: self.openSettings)
                Button("Open Authentications", action: self.openAuthentications)
                Button(
                    self.shellState.isAssistantSidebarCollapsed ? "Show Conversations" : "Hide Conversations",
                    action: self.shellState.toggleAssistantSidebar)
            } label: {
                HStack(spacing: 6) {
                    Text("Actions")
                    Image(systemName: "chevron.down")
                        .font(.system(size: 11, weight: .bold))
                }
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(self.palette.primaryText)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
            .buttonStyle(LumeGhostButtonStyle(palette: self.palette))
            .menuStyle(.borderlessButton)
        }
        .padding(.horizontal, 26)
        .padding(.vertical, 16)
        .background(self.palette.surface)
    }

    private var utilityRail: some View {
        VStack(spacing: 10) {
            self.utilityButton(symbol: "terminal", isActive: true, action: {})
            self.utilityButton(symbol: "clock.arrow.circlepath", action: {})
            self.utilityButton(symbol: "key", action: self.openAuthentications)
            self.utilityButton(symbol: "gearshape", action: self.openSettings)

            Spacer(minLength: 0)

            self.utilityButton(
                symbol: self.shellState.isAssistantSidebarCollapsed ? "sidebar.right" : "sidebar.left",
                action: self.shellState.toggleAssistantSidebar)
        }
        .frame(width: 54)
        .padding(.vertical, 16)
        .background(self.palette.surface)
    }

    private var sessionsSidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Conversations")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(self.palette.primaryText)
                    Text("\(max(self.sessionItems.count, 1)) active threads")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(self.palette.secondaryText)
                }

                Spacer(minLength: 0)

                Button(action: self.shellState.toggleAssistantSidebar) {
                    Image(systemName: "sidebar.left")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(self.palette.secondaryText)
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 14)

            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(self.palette.tertiaryText)
                TextField("Search conversations", text: self.$sessionSearchQuery)
                    .textFieldStyle(.plain)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(self.palette.primaryText)
            }
            .padding(.horizontal, 12)
            .frame(height: 38)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(self.palette.surfaceMuted)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(self.palette.border, lineWidth: 1)))
            .padding(.horizontal, 16)

            self.runtimeCard
                .padding(.horizontal, 16)
                .padding(.top, 14)

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    self.sessionSection(
                        title: "Pinned",
                        items: self.pinnedSessions.isEmpty ? [self.fallbackCurrentSession] : self.pinnedSessions)

                    if !self.recentSessions.isEmpty {
                        self.sessionSection(title: "Recent", items: self.recentSessions)
                    }

                    if let sessionsError, !sessionsError.isEmpty {
                        Text(sessionsError)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(self.palette.tertiaryText)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 18)
                .padding(.bottom, 18)
            }

            VStack(spacing: 10) {
                self.sidebarShortcut(
                    title: "Authentications",
                    detail: "Connect channels, files, and data sources.",
                    symbol: "key",
                    action: self.openAuthentications)
                self.sidebarShortcut(
                    title: "Settings",
                    detail: "Theme, account, support, and usage.",
                    symbol: "gearshape",
                    action: self.openSettings)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
        .frame(width: 278, maxHeight: .infinity, alignment: .topLeading)
        .background(self.palette.surface)
    }

    private var runtimeCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Circle()
                    .fill(self.connectionLabel == "Connected" ? self.palette.success : self.palette.warning)
                    .frame(width: 8, height: 8)
                Text(self.connectionLabel)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(self.palette.primaryText)
                Spacer(minLength: 0)
                if self.isLoadingSessions {
                    ProgressView()
                        .controlSize(.small)
                }
            }

            Text("Private runtime on this Mac. Sessions, tools, and approvals stay local unless you route them elsewhere.")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(self.palette.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(self.palette.surfaceMuted)
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(self.palette.border, lineWidth: 1)))
    }

    private var conversationStage: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(self.currentSessionTitle)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(self.palette.primaryText)
                    Text(self.currentSessionSubtitle)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(self.palette.secondaryText)
                }

                Spacer(minLength: 0)

                Button(action: self.reloadSessionsTask) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(self.palette.secondaryText)
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 22)
            .padding(.vertical, 12)
            .background(self.palette.surfaceMuted)

            OpenClawChatView(
                viewModel: OpenClawChatViewModel(
                    sessionKey: self.sessionKey,
                    transport: self.sessionsTransport,
                    initialThinkingLevel: UserDefaults.standard.string(forKey: lumeThinkingDefaultsKey) ?? "medium",
                    onThinkingLevelChanged: { level in
                        UserDefaults.standard.set(level, forKey: lumeThinkingDefaultsKey)
                    },
                    onSessionKeyChanged: self.onSessionKeyChanged),
                showsSessionSwitcher: false,
                style: .lume,
                userAccent: Self.color(fromHex: self.accentHex))
                .id(self.sessionKey)
                .padding(.horizontal, 30)
                .padding(.vertical, 18)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(
            LinearGradient(
                colors: [self.palette.stage, self.palette.surface.opacity(0.38)],
                startPoint: .top,
                endPoint: .bottom))
    }

    private var currentSessionTitle: String {
        self.visibleSessionItems.first(where: { $0.key == self.sessionKey })?.title ?? self.fallbackCurrentSession.title
    }

    private var currentSessionSubtitle: String {
        self.visibleSessionItems.first(where: { $0.key == self.sessionKey })?.subtitle ?? self.fallbackCurrentSession.subtitle
    }

    private var fallbackCurrentSession: SidebarSessionItem {
        .init(
            id: self.sessionKey,
            key: self.sessionKey,
            title: self.sessionKey == "main" ? "Primary Session" : self.prettySessionTitle(self.sessionKey),
            subtitle: "Private local thread",
            updatedLabel: "Now",
            isMain: self.sessionKey == "main")
    }

    private func sessionSection(title: String, items: [SidebarSessionItem]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(self.palette.tertiaryText)
                .textCase(.uppercase)

            VStack(spacing: 8) {
                ForEach(items) { item in
                    Button {
                        self.onSessionKeyChanged(item.key)
                    } label: {
                        HStack(alignment: .top, spacing: 10) {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(spacing: 8) {
                                    Text(item.title)
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(self.palette.primaryText)
                                        .lineLimit(1)
                                    if item.isMain {
                                        Text("MAIN")
                                            .font(.system(size: 9, weight: .bold))
                                            .foregroundStyle(Color.black)
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(Capsule().fill(self.palette.warning))
                                    }
                                }

                                Text(item.subtitle)
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(self.palette.secondaryText)
                                    .lineLimit(2)
                            }

                            Spacer(minLength: 0)

                            Text(item.updatedLabel)
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(self.palette.tertiaryText)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(item.key == self.sessionKey ? self.palette.surfaceMuted : self.palette.surface)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                                        .strokeBorder(
                                            item.key == self.sessionKey ? self.palette.border : .clear,
                                            lineWidth: 1)))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func sidebarShortcut(title: String, detail: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: symbol)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(self.palette.secondaryText)
                    .frame(width: 18, height: 18)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(self.palette.primaryText)
                    Text(detail)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(self.palette.secondaryText)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(LumeGhostButtonStyle(palette: self.palette))
    }

    private func headerButton(_ title: String, symbol: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
            Text(title)
        }
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(self.palette.primaryText)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(self.palette.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(self.palette.border, lineWidth: 1)))
    }

    private func utilityButton(symbol: String, isActive: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(isActive ? self.palette.primaryText : self.palette.secondaryText)
                .frame(width: 34, height: 34)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(isActive ? self.palette.surfaceMuted : .clear)
                        .overlay(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .strokeBorder(isActive ? self.palette.border : .clear, lineWidth: 1)))
        }
        .buttonStyle(.plain)
    }

    private func reloadSessionsTask() {
        Task {
            await self.reloadSessions()
        }
    }

    private func reloadSessions() async {
        self.isLoadingSessions = true
        defer { self.isLoadingSessions = false }
        do {
            let response = try await self.sessionsTransport.listSessions(limit: 18)
            self.sessionsError = nil
            self.sessionItems = self.mapSessions(response.sessions)
        } catch {
            self.sessionsError = "Could not refresh sessions just now."
            self.sessionItems = [self.fallbackCurrentSession]
        }
    }

    private func mapSessions(_ entries: [OpenClawChatSessionEntry]) -> [SidebarSessionItem] {
        let sorted = entries.sorted { ($0.updatedAt ?? 0) > ($1.updatedAt ?? 0) }
        var seen = Set<String>()
        var result: [SidebarSessionItem] = []

        for entry in sorted {
            guard seen.insert(entry.key).inserted else { continue }
            result.append(
                .init(
                    id: entry.key,
                    key: entry.key,
                    title: self.title(for: entry),
                    subtitle: self.subtitle(for: entry),
                    updatedLabel: self.relativeLabel(for: entry.updatedAt),
                    isMain: entry.key == "main"))
        }

        if !result.contains(where: { $0.key == self.sessionKey }) {
            result.insert(self.fallbackCurrentSession, at: 0)
        }

        return result
    }

    private func title(for entry: OpenClawChatSessionEntry) -> String {
        let candidates = [entry.displayName, entry.subject, entry.room, entry.space]
        if let resolved = candidates
            .compactMap({ $0?.trimmingCharacters(in: .whitespacesAndNewlines) })
            .first(where: { !$0.isEmpty })
        {
            return resolved
        }
        return self.prettySessionTitle(entry.key)
    }

    private func subtitle(for entry: OpenClawChatSessionEntry) -> String {
        let primary = [entry.surface, entry.kind, entry.modelProvider]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        if !primary.isEmpty {
            return primary.joined(separator: " · ")
        }
        return "Desktop thread"
    }

    private func prettySessionTitle(_ key: String) -> String {
        key
            .replacingOccurrences(of: ":", with: " · ")
            .replacingOccurrences(of: "-", with: " ")
            .split(separator: " ")
            .map { $0.capitalized }
            .joined(separator: " ")
    }

    private func relativeLabel(for updatedAt: Double?) -> String {
        guard let updatedAt else { return "Now" }
        let timestamp = updatedAt > 1_000_000_000_000 ? updatedAt / 1000 : updatedAt
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: Date(timeIntervalSince1970: timestamp), relativeTo: Date())
    }

    private static func color(fromHex hex: String?) -> Color? {
        guard let hex else { return nil }
        let sanitized = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        guard sanitized.count == 6, let value = Int(sanitized, radix: 16) else { return nil }
        let red = Double((value >> 16) & 0xFF) / 255
        let green = Double((value >> 8) & 0xFF) / 255
        let blue = Double(value & 0xFF) / 255
        return Color(red: red, green: green, blue: blue)
    }
}

struct LumeDeepResearchStageView: View {
    let palette: LumePalette

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Deep Research")
                        .font(.system(size: 34, weight: .semibold))
                        .foregroundStyle(self.palette.primaryText)
                    Text("A cleaner surface for long-form research briefs, source gathering, synthesis, and handoff. This stays intentionally light until the workflow engine is ready.")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(self.palette.secondaryText)
                        .frame(maxWidth: 760, alignment: .leading)
                }

                HStack(spacing: 16) {
                    self.researchCard(
                        title: "Research Brief",
                        text: "Start from a problem, a company, or a thesis and shape the brief before the agent runs.")
                    self.researchCard(
                        title: "Source Coverage",
                        text: "Web, docs, notes, and local artifacts can converge into one structured output.")
                    self.researchCard(
                        title: "Human Review",
                        text: "Keep findings, evidence, and next actions ready for a decision maker.")
                }

                LumePanel(palette: self.palette) {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Coming next")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(self.palette.primaryText)
                        Text("Research runs, source collections, and report delivery live here next. For now the page is a design-ready placeholder so the shell already feels like a coherent product.")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(self.palette.secondaryText)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(28)
        }
        .background(self.palette.stage)
    }

    private func researchCard(title: String, text: String) -> some View {
        LumePanel(palette: self.palette) {
            VStack(alignment: .leading, spacing: 12) {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(self.palette.primaryText)
                Text(text)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(self.palette.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, minHeight: 138, alignment: .topLeading)
        }
        .frame(maxWidth: .infinity)
    }
}

@MainActor
struct LumeAuthenticationsStageView: View {
    let palette: LumePalette
    @Bindable var shellState: LumeShellState

    private let gridColumns = [
        GridItem(.flexible(minimum: 280, maximum: .infinity), spacing: 18),
        GridItem(.flexible(minimum: 280, maximum: .infinity), spacing: 18),
    ]

    private var filteredIntegrations: [LumeIntegration] {
        let search = self.shellState.authSearchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return LumeMockData.integrations.filter { integration in
            let matchesSearch = search.isEmpty
                || integration.title.lowercased().contains(search)
                || integration.vendorLabel.lowercased().contains(search)

            let matchesFilter: Bool = switch self.shellState.authFilter {
            case .all:
                true
            case .authorized:
                self.shellState.isAuthorized(integration)
            case .google:
                integration.group == .googleWorkspace
            case .microsoft:
                integration.group == .microsoft365
            case .social:
                integration.group == .socialMedia
            case .storage:
                integration.group == .fileStorage
            case .development:
                integration.group == .development
            }

            return matchesSearch && matchesFilter
        }
    }

    private var groupedIntegrations: [(group: LumeIntegrationGroup, items: [LumeIntegration])] {
        let lookup = Dictionary(grouping: self.filteredIntegrations, by: \.group)
        return LumeIntegrationGroup.allCases.compactMap { group in
            guard let items = lookup[group], !items.isEmpty else { return nil }
            return (group: group, items: items)
        }
    }

    private var authorizedIntegrations: [LumeIntegration] {
        LumeMockData.integrations.filter { self.shellState.isAuthorized($0) }
    }

    private var integrationCountRequiringInput: Int {
        self.filteredIntegrations.filter { integration in
            guard integration.requiredInput != nil else { return false }
            return self.shellState.integrationInput(for: integration.id)
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .isEmpty
        }.count
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                self.header
                self.spotlightPanel
                self.summaryRow
                self.authorizedSection

                ForEach(self.groupedIntegrations, id: \.group.id) { group in
                    VStack(alignment: .leading, spacing: 14) {
                        HStack(spacing: 8) {
                            Text(group.group.rawValue)
                                .font(.system(size: 24, weight: .semibold))
                                .foregroundStyle(self.palette.primaryText)
                            Text("(\(group.items.count))")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(self.palette.tertiaryText)
                        }

                        LazyVGrid(columns: self.gridColumns, spacing: 18) {
                            ForEach(group.items) { integration in
                                LumeIntegrationCard(
                                    integration: integration,
                                    isAuthorized: self.shellState.isAuthorized(integration),
                                    inputValue: self.shellState.integrationInput(for: integration.id),
                                    palette: self.palette,
                                    onInputChange: { value in
                                        self.shellState.setIntegrationInput(value, for: integration.id)
                                    },
                                    onToggleAuthorization: {
                                        if self.shellState.isAuthorized(integration) {
                                            self.shellState.disconnect(integration)
                                        } else {
                                            self.shellState.connect(integration)
                                            if let url = integration.externalURL {
                                                NSWorkspace.shared.open(url)
                                            }
                                        }
                                    })
                            }
                        }
                    }
                }
            }
            .padding(28)
        }
        .background(self.palette.stage)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 20) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Your Authentications")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(self.palette.primaryText)
                Text("Bring channels, workspace tools, file storage, and data sources into one clean control surface. Where a concrete path already exists, the card opens the real vendor destination and keeps local device state in sync.")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(self.palette.secondaryText)
                    .frame(maxWidth: 760, alignment: .leading)
            }

            Spacer(minLength: 0)

            HStack(spacing: 10) {
                TextField(
                    "Search by platform or service…",
                    text: self.$shellState.authSearchQuery)
                    .textFieldStyle(.plain)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(self.palette.primaryText)
                    .padding(.horizontal, 12)
                    .frame(width: 220, height: 36)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(self.palette.surface)
                            .overlay(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .strokeBorder(self.palette.border, lineWidth: 1)))

                Menu {
                    ForEach(LumeShellState.AuthFilter.allCases) { filter in
                        Button(filter.rawValue) {
                            self.shellState.authFilter = filter
                        }
                    }
                } label: {
                    HStack(spacing: 8) {
                        Text(self.shellState.authFilter.rawValue)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 11, weight: .bold))
                    }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(self.palette.primaryText)
                    .padding(.horizontal, 12)
                    .frame(width: 120, height: 36)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(self.palette.surface)
                            .overlay(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .strokeBorder(self.palette.border, lineWidth: 1)))
                }
                .menuStyle(.borderlessButton)

                Button {
                    self.shellState.authSearchQuery = ""
                    self.shellState.authFilter = .all
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(self.palette.primaryText)
                        .frame(width: 36, height: 36)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(self.palette.surface)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                                        .strokeBorder(self.palette.border, lineWidth: 1)))
                }
                .buttonStyle(.plain)

                Button {
                    self.shellState.clearAuthorizedIntegrations()
                } label: {
                    Image(systemName: "trash")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(self.palette.danger))
                }
                .buttonStyle(.plain)
                .opacity(self.authorizedIntegrations.isEmpty ? 0.45 : 1)
                .disabled(self.authorizedIntegrations.isEmpty)
            }
        }
    }

    private var spotlightPanel: some View {
        LumePanel(palette: self.palette) {
            HStack(alignment: .top, spacing: 22) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Recommended next")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(self.palette.primaryText)
                    Text("If you want the first usable stack fast, start with Gmail Read, Google Calendar, Google Drive, GitHub, and WhatsApp Business.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(self.palette.secondaryText)
                        .frame(maxWidth: 520, alignment: .leading)
                }

                Spacer(minLength: 0)

                VStack(alignment: .leading, spacing: 10) {
                    Text("Fast stack")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(self.palette.tertiaryText)
                        .textCase(.uppercase)

                    HStack(spacing: 8) {
                        self.quickStartChip("Gmail")
                        self.quickStartChip("Calendar")
                        self.quickStartChip("Drive")
                        self.quickStartChip("GitHub")
                        self.quickStartChip("WhatsApp")
                    }
                }
            }
        }
    }

    private var summaryRow: some View {
        HStack(spacing: 16) {
            self.summaryCard(title: "Connected", value: "\(self.authorizedIntegrations.count)", detail: "Already linked in this device")
            self.summaryCard(title: "Visible", value: "\(self.filteredIntegrations.count)", detail: "Current search and filter scope")
            self.summaryCard(title: "Needs Setup", value: "\(self.integrationCountRequiringInput)", detail: "Requires tenant, subdomain, or workspace data")
        }
    }

    private var authorizedSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Text("Authorized")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(self.palette.primaryText)
                Text("(\(self.authorizedIntegrations.count))")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(self.palette.tertiaryText)
            }

            if self.authorizedIntegrations.isEmpty {
                LumePanel(palette: self.palette) {
                    Text("No services are connected yet. Use any card below to start building the account layer for this device.")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(self.palette.secondaryText)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                LazyVGrid(columns: self.gridColumns, spacing: 18) {
                    ForEach(self.authorizedIntegrations) { integration in
                        LumePanel(palette: self.palette, padding: 0) {
                            HStack(spacing: 14) {
                                LumeIntegrationMark(integration: integration, palette: self.palette)
                                Text(integration.title)
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(self.palette.primaryText)
                                Spacer(minLength: 0)
                                if let url = integration.externalURL {
                                    Button {
                                        NSWorkspace.shared.open(url)
                                    } label: {
                                        Image(systemName: "arrow.up.right.square")
                                            .font(.system(size: 13, weight: .semibold))
                                            .foregroundStyle(self.palette.secondaryText)
                                            .frame(width: 34, height: 34)
                                            .background(
                                                Circle()
                                                    .fill(self.palette.surfaceMuted)
                                                    .overlay(Circle().strokeBorder(self.palette.border, lineWidth: 1)))
                                    }
                                    .buttonStyle(.plain)
                                }
                                Button {
                                    self.shellState.disconnect(integration)
                                } label: {
                                    Image(systemName: "trash")
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(self.palette.danger)
                                        .frame(width: 34, height: 34)
                                        .background(
                                            Circle()
                                                .fill(self.palette.surfaceMuted)
                                                .overlay(Circle().strokeBorder(self.palette.border, lineWidth: 1)))
                                }
                                .buttonStyle(.plain)
                            }
                            .padding(.horizontal, 18)
                            .padding(.vertical, 16)
                        }
                    }
                }
            }
        }
    }

    private func summaryCard(title: String, value: String, detail: String) -> some View {
        LumePanel(palette: self.palette) {
            VStack(alignment: .leading, spacing: 8) {
                Text(title)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(self.palette.secondaryText)
                Text(value)
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(self.palette.primaryText)
                Text(detail)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(self.palette.tertiaryText)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity)
    }

    private func quickStartChip(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(self.palette.primaryText)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(
                Capsule()
                    .fill(self.palette.surfaceMuted)
                    .overlay(
                        Capsule()
                            .strokeBorder(self.palette.border, lineWidth: 1)))
    }
}

struct LumeIntegrationCard: View {
    let integration: LumeIntegration
    let isAuthorized: Bool
    let inputValue: String
    let palette: LumePalette
    let onInputChange: (String) -> Void
    let onToggleAuthorization: () -> Void

    private var isReadyToConnect: Bool {
        guard let requiredInput = self.integration.requiredInput else { return true }
        return !self.inputValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || requiredInput.placeholder.isEmpty
    }

    var body: some View {
        LumePanel(palette: self.palette, padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top, spacing: 14) {
                    LumeIntegrationMark(integration: self.integration, palette: self.palette)
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            Text(self.integration.title)
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(self.palette.primaryText)

                            if self.isAuthorized {
                                Text("AUTHORIZED")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundStyle(self.palette.success)
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 3)
                                    .background(
                                        Capsule()
                                            .fill(self.palette.success.opacity(0.12)))
                            }
                        }
                        if let description = self.integration.description {
                            Text(description)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(self.palette.secondaryText)
                        }
                    }
                    Spacer(minLength: 0)

                    Button(self.isAuthorized ? "Disconnect" : self.integration.vendorLabel) {
                        self.onToggleAuthorization()
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(self.isAuthorized ? self.palette.danger : .white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(
                                self.isAuthorized
                                    ? AnyShapeStyle(self.palette.surfaceMuted)
                                    : AnyShapeStyle(Color(hex: self.integration.tintHex == 0xFFFFFF ? 0x2C2F36 : self.integration.tintHex)))
                            .overlay(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .strokeBorder(
                                        self.isAuthorized ? self.palette.danger.opacity(0.28) : .clear,
                                        lineWidth: 1)))
                    .disabled(!self.isReadyToConnect)
                }
                .padding(.horizontal, 18)
                .padding(.top, 18)
                .padding(.bottom, 14)

                if let requiredInput = self.integration.requiredInput {
                    HStack(spacing: 8) {
                        TextField(requiredInput.placeholder, text: Binding(
                            get: { self.inputValue },
                            set: { self.onInputChange($0) }))
                            .textFieldStyle(.plain)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(self.palette.primaryText)

                        if let suffix = requiredInput.suffix {
                            Text(suffix)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(self.palette.tertiaryText)
                        }
                    }
                    .padding(.horizontal, 14)
                    .frame(height: 40)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(self.palette.surfaceMuted)
                            .overlay(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .strokeBorder(self.palette.border, lineWidth: 1)))
                    .padding(.horizontal, 18)
                    .padding(.bottom, 12)
                }

                if let disclaimer = self.integration.disclaimer {
                    Text(disclaimer)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(self.palette.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 18)
                        .padding(.bottom, 18)
                }
            }
            .frame(minHeight: 176)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
    }
}

struct LumeIntegrationMark: View {
    let integration: LumeIntegration
    let palette: LumePalette

    var body: some View {
        Text(self.integration.mark)
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(self.integration.tintHex == 0xFFFFFF ? Color.black : .white)
            .frame(width: 28, height: 28)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Color(hex: self.integration.tintHex)))
    }
}

struct LumeOrganizationStageView: View {
    let palette: LumePalette

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Organization")
                        .font(.system(size: 34, weight: .semibold))
                        .foregroundStyle(self.palette.primaryText)
                    Text("Your personal layer stays central, but the company layer can already start to take shape. Create a new organization or join an existing one without forcing the full multi-tenant stack yet.")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(self.palette.secondaryText)
                        .frame(maxWidth: 760, alignment: .leading)
                }

                HStack(spacing: 18) {
                    self.organizationCard(
                        symbol: "building.2",
                        title: "Create Organization",
                        detail: "Open a new company workspace for members, policies, shared contacts, and integrations that belong to the business.",
                        emphasis: "Start from scratch",
                        isPrimary: true,
                        action: { self.openMailto(subject: "Create organization") })
                    self.organizationCard(
                        symbol: "person.2.badge.plus",
                        title: "Join Organization",
                        detail: "Accept an invite or join an existing workspace without losing your personal local setup.",
                        emphasis: "Use an invite link",
                        isPrimary: false,
                        action: { self.openMailto(subject: "Join organization") })
                }

                HStack(spacing: 16) {
                    self.infoCard(title: "Personal first", detail: "Your account remains the entry point and the local runtime keeps living on this device.")
                    self.infoCard(title: "Ready for teams", detail: "As soon as the org layer lands, this same shell can absorb members, permissions, and shared data.")
                    self.infoCard(title: "No lock-in", detail: "Nothing here forces full cloud dependence or heavy multi-tenancy too early. It is just the right surface.")
                }
            }
            .padding(28)
        }
        .background(self.palette.stage)
    }

    private func organizationCard(
        symbol: String,
        title: String,
        detail: String,
        emphasis: String,
        isPrimary: Bool,
        action: @escaping () -> Void) -> some View
    {
        LumePanel(palette: self.palette, padding: 0) {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Image(systemName: symbol)
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(isPrimary ? .white : self.palette.primaryText)
                        .frame(width: 52, height: 52)
                        .background(
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .fill(isPrimary ? AnyShapeStyle(self.palette.accent) : AnyShapeStyle(self.palette.surfaceMuted)))
                    Spacer(minLength: 0)
                    Text(emphasis)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(isPrimary ? self.palette.accent : self.palette.secondaryText)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(
                            Capsule()
                                .fill(isPrimary ? self.palette.accent.opacity(0.12) : self.palette.surfaceMuted))
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text(title)
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(self.palette.primaryText)
                    Text(detail)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(self.palette.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if isPrimary {
                    Button(action: action) {
                        Text(title)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                    }
                        .buttonStyle(LumePrimaryButtonStyle(palette: self.palette))
                        .frame(maxWidth: .infinity)
                } else {
                    Button(action: action) {
                        Text(title)
                            .font(.system(size: 14, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                    }
                        .buttonStyle(LumeGhostButtonStyle(palette: self.palette))
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, minHeight: 248, alignment: .topLeading)
        }
    }

    private func infoCard(title: String, detail: String) -> some View {
        LumePanel(palette: self.palette) {
            VStack(alignment: .leading, spacing: 8) {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(self.palette.primaryText)
                Text(detail)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(self.palette.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity)
    }

    private func openMailto(subject: String) {
        guard
            let encoded = subject.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
            let url = URL(string: "mailto:support@lume.ai?subject=\(encoded)")
        else { return }
        NSWorkspace.shared.open(url)
    }
}

@MainActor
struct LumeSettingsStageView: View {
    let palette: LumePalette
    @Bindable var shellState: LumeShellState
    let profile: LumeProfileSummary

    var body: some View {
        HStack(spacing: 0) {
            self.sidebar
            Rectangle()
                .fill(self.palette.separator)
                .frame(width: 1)
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(spacing: 10) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(self.palette.secondaryText)
                        Text("Settings")
                            .font(.system(size: 34, weight: .semibold))
                            .foregroundStyle(self.palette.primaryText)
                    }
                    self.content
                }
                .padding(28)
            }
        }
        .background(self.palette.stage)
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(LumeShellState.SettingsSection.allCases) { section in
                Button {
                    self.shellState.settingsSection = section
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: section.symbolName)
                            .frame(width: 18)
                        Text(section.title)
                            .font(.system(size: 14, weight: .semibold))
                        Spacer(minLength: 0)
                    }
                    .foregroundStyle(
                        self.shellState.settingsSection == section
                            ? self.palette.primaryText
                            : self.palette.secondaryText)
                    .padding(.horizontal, 14)
                    .frame(height: 44)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(self.shellState.settingsSection == section ? self.palette.surfaceMuted : .clear))
                }
                .buttonStyle(.plain)
            }

            Spacer(minLength: 0)
        }
        .padding(18)
        .frame(width: 240, maxHeight: .infinity, alignment: .topLeading)
    }

    @ViewBuilder
    private var content: some View {
        switch self.shellState.settingsSection {
        case .general:
            self.generalSettings
        case .account:
            self.accountSettings
        case .creditUsage:
            self.creditUsageSettings
        case .support:
            self.supportSettings
        case .followUs:
            self.followUsSettings
        }
    }

    private var generalSettings: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 10) {
                Text("Appearance")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(self.palette.primaryText)

                self.settingsPickerRow(
                    icon: "moon.stars",
                    title: "Theme",
                    subtitle: "Choose how Lume looks on this Mac.",
                    options: LumeThemeChoice.allCases,
                    selection: Binding(
                        get: { self.shellState.preferredTheme },
                        set: { self.shellState.setTheme($0) }),
                    label: \.title)
            }

            VStack(alignment: .leading, spacing: 10) {
                Text("Language")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(self.palette.primaryText)

                self.settingsPickerRow(
                    icon: "globe",
                    title: "Language",
                    subtitle: "Choose the primary interface language.",
                    options: LumeLanguageChoice.allCases,
                    selection: Binding(
                        get: { self.shellState.preferredLanguage },
                        set: { self.shellState.setLanguage($0) }),
                    label: \.title)
            }
        }
    }

    private var accountSettings: some View {
        VStack(alignment: .leading, spacing: 18) {
            LumePanel(palette: self.palette) {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Profile Information")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(self.palette.primaryText)
                    HStack(alignment: .top, spacing: 26) {
                        VStack(alignment: .leading, spacing: 8) {
                            self.profileRow(title: "User", value: self.profile.fullName)
                            self.profileRow(title: "Joined", value: self.profile.joinedLabel)
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            self.profileRow(title: "Email", value: self.profile.email)
                        }
                    }
                    HStack(spacing: 12) {
                        self.secondaryControl("Manage Account") {
                            self.openMailto(subject: "Manage account")
                        }
                        self.dangerControl("Sign Out") {}
                    }
                }
            }

            LumePanel(palette: self.palette) {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Subscription")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(self.palette.primaryText)
                    HStack {
                        Text("Current Plan")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(self.palette.secondaryText)
                        Spacer(minLength: 0)
                        Text(self.profile.planName)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(self.palette.success)
                    }
                    Button {
                        self.openMailto(subject: "Upgrade plan")
                    } label: {
                        Text("Upgrade Plan")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                    }
                    .buttonStyle(LumePrimaryButtonStyle(palette: self.palette, tint: self.palette.success))
                }
            }

            LumePanel(palette: self.palette) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Delete Account")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(self.palette.danger)
                        Text("Permanently delete your account and all data.")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(self.palette.secondaryText)
                    }
                    Spacer(minLength: 0)
                    self.dangerControl("Delete Account") {
                        self.openMailto(subject: "Delete account request")
                    }
                        .frame(width: 180)
                }
            }
        }
    }

    private var creditUsageSettings: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 16) {
                self.usageCard(title: "Monthly Credits", value: "1,200", detail: "Plan allowance")
                self.usageCard(title: "Used This Month", value: "214", detail: "Across chat and tools")
                self.usageCard(title: "Remaining", value: "986", detail: "Before next reset")
            }
            LumePanel(palette: self.palette) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Current Usage")
                        .font(.system(size: 16, weight: .semibold))
                    GeometryReader { proxy in
                        ZStack(alignment: .leading) {
                            Capsule()
                                .fill(self.palette.surfaceMuted)
                            Capsule()
                                .fill(self.palette.accent)
                                .frame(width: proxy.size.width * 0.18)
                        }
                    }
                    .frame(height: 10)
                    Text("18% of the current monthly allocation used.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(self.palette.secondaryText)
                }
            }
        }
    }

    private var supportSettings: some View {
        VStack(alignment: .leading, spacing: 18) {
            LumePanel(palette: self.palette) {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Support")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(self.palette.primaryText)
                    Link(destination: URL(string: "mailto:support@lume.ai")!) {
                        HStack(spacing: 8) {
                            Image(systemName: "envelope")
                            Text("support@lume.ai")
                        }
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(self.palette.accent)
                    }
                    Text("Use this channel for onboarding questions, bugs, billing, and more specific support requests.")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(self.palette.secondaryText)
                    self.secondaryControl("Open Support Email") {
                        self.openMailto(subject: "Support")
                    }
                }
            }

            LumePanel(palette: self.palette) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Support hours")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(self.palette.primaryText)
                    Text("Async support during business days. Product, billing, and partnership requests can all start in the same inbox.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(self.palette.secondaryText)
                }
            }
        }
    }

    private var followUsSettings: some View {
        VStack(alignment: .leading, spacing: 18) {
            LumePanel(palette: self.palette) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Follow Us")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(self.palette.primaryText)
                    Text("Keep the brand layer ready with product news, launches, and community touchpoints.")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(self.palette.secondaryText)
                }
            }

            LazyVGrid(columns: [
                GridItem(.flexible(minimum: 200)),
                GridItem(.flexible(minimum: 200)),
            ], spacing: 16) {
                ForEach(LumeMockData.followLinks) { link in
                    Link(destination: link.url) {
                        HStack(spacing: 12) {
                            Text(link.mark)
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(width: 26, height: 26)
                                .background(
                                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                                        .fill(self.palette.accent))
                            Text(link.title)
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(self.palette.primaryText)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 14)
                        .background(
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .fill(self.palette.surface)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                                        .strokeBorder(self.palette.border, lineWidth: 1)))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func settingsPickerRow<Value: Hashable & Identifiable, Options: RandomAccessCollection>(
        icon: String,
        title: String,
        subtitle: String,
        options: Options,
        selection: Binding<Value>,
        label: KeyPath<Value, String>) -> some View
        where Options.Element == Value
    {
        LumePanel(palette: self.palette) {
            HStack(spacing: 16) {
                Image(systemName: icon)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(self.palette.secondaryText)
                    .frame(width: 34, height: 34)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(self.palette.surfaceMuted))

                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(self.palette.primaryText)
                    Text(subtitle)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(self.palette.secondaryText)
                }

                Spacer(minLength: 0)

                Picker(title, selection: selection) {
                    ForEach(Array(options), id: \.id) { option in
                        Text(option[keyPath: label]).tag(option)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
            }
        }
    }

    private func profileRow(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(self.palette.secondaryText)
            Text(value)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(self.palette.primaryText)
        }
    }

    private func usageCard(title: String, value: String, detail: String) -> some View {
        LumePanel(palette: self.palette) {
            VStack(alignment: .leading, spacing: 8) {
                Text(title)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(self.palette.secondaryText)
                Text(value)
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(self.palette.primaryText)
                Text(detail)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(self.palette.secondaryText)
            }
        }
    }

    private func secondaryControl(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
        }
            .buttonStyle(LumeGhostButtonStyle(palette: self.palette))
    }

    private func dangerControl(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
        }
            .buttonStyle(LumeGhostButtonStyle(palette: self.palette, isDanger: true))
    }

    private func openMailto(subject: String) {
        guard
            let encoded = subject.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
            let url = URL(string: "mailto:support@lume.ai?subject=\(encoded)")
        else { return }
        NSWorkspace.shared.open(url)
    }
}
