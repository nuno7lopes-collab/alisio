import SwiftUI

import AlisioSupport

private enum MemoryNavigationMode: String, CaseIterable, Identifiable {
    case list
    case graph

    var id: Self { self }

    var title: String {
        switch self {
        case .list:
            "List"
        case .graph:
            "Graph"
        }
    }
}

struct MemorySettings: View {
    let showsHeader: Bool
    @State private var model: MemorySettingsModel
    @State private var searchText = ""
    @State private var searchTask: Task<Void, Never>?
    @State private var navigationMode: MemoryNavigationMode = .list

    init(
        model: MemorySettingsModel = MemorySettingsModel(),
        showsHeader: Bool = true)
    {
        self.showsHeader = showsHeader
        self._model = State(initialValue: model)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            self.header
            HStack(spacing: 12) {
                self.sidebar
                    .frame(width: self.navigationMode == .graph ? 420 : 320)
                    .frame(maxHeight: .infinity, alignment: .topLeading)
                Divider()
                self.detail
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
        .task { await self.model.refresh() }
        .onChange(of: self.searchText) { _, newValue in
            self.scheduleSearch(newValue)
        }
        .onDisappear {
            self.searchTask?.cancel()
        }
    }

    private var header: some View {
        WorkspaceRouteHeader(
            title: "Memory",
            subtitle: "Read the visible canonical memory for the selected agent.",
            showsTitle: self.showsHeader)
        {
            HStack(spacing: 10) {
                if self.model.agents.count > 1 {
                    Picker("Agent", selection: Binding(
                        get: { self.model.selectedAgentID ?? "" },
                        set: { newValue in
                            guard !newValue.isEmpty else { return }
                            Task { await self.model.selectAgent(newValue) }
                        }))
                    {
                        ForEach(self.model.agents) { agent in
                            Text(agent.displayName)
                                .tag(agent.id)
                        }
                    }
                    .pickerStyle(.menu)
                    .frame(width: 220)
                } else if let agent = self.model.selectedAgent {
                    Label(agent.displayName, systemImage: "person")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                if self.model.isLoading {
                    ProgressView()
                } else {
                    Button {
                        Task { await self.model.refresh() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
    }

    private var sidebar: some View {
        SettingsSidebarScroll {
            VStack(alignment: .leading, spacing: 12) {
                self.searchField
                self.navigationModePicker

                switch self.model.listState {
                case .loading:
                    WorkspaceStateCard(
                        title: "Loading memory…",
                        message: "Reading the visible canonical catalog for this agent.",
                        systemImage: "brain.head.profile",
                        showsProgress: true)
                case let .error(message):
                    WorkspaceStateCard(
                        title: "Couldn't load memory.",
                        message: message,
                        systemImage: "exclamationmark.triangle.fill",
                        tone: .caution,
                        actionTitle: "Reload")
                    {
                        Task { await self.model.refresh() }
                    }
                case let .empty(message):
                    WorkspaceStateCard(
                        title: "No memory yet.",
                        message: message,
                        systemImage: "doc.text")
                case .filteredEmpty:
                    WorkspaceStateCard(
                        title: "No matches.",
                        message: "Try another search term.",
                        systemImage: "magnifyingglass")
                case .list:
                    VStack(alignment: .leading, spacing: 8) {
                        if self.model.isSearching {
                            HStack(spacing: 8) {
                                ProgressView()
                                    .controlSize(.small)
                                Text("Searching…")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                        } else if let notice = self.model.searchNotice?.nonEmpty {
                            Text(notice)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        } else if let message = self.model.statusMessage?.nonEmpty {
                            Text(message)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }

                        switch self.navigationMode {
                        case .list:
                            List(selection: Binding(
                                get: { self.model.selectedItemID },
                                set: { newValue in
                                    Task { await self.model.selectItem(newValue) }
                                }))
                            {
                                ForEach(self.model.sections) { group in
                                    Section(group.section.title) {
                                        ForEach(group.items) { item in
                                            self.sidebarRow(item)
                                                .tag(item.id)
                                        }
                                    }
                                }
                            }
                            .listStyle(.inset)
                        case .graph:
                            self.graphNavigator
                        }
                    }
                }
            }
        }
    }

    private var detail: some View {
        Group {
            if let item = self.model.selectedItem {
                if self.model.isLoadingSelectedDocument && self.model.selectedDocument?.item.id != item.id {
                    WorkspaceStateCard(
                        title: "Loading file…",
                        message: "Reading the selected canonical file.",
                        systemImage: "doc.text",
                        showsProgress: true)
                } else if let error = self.model.detailError?.nonEmpty {
                    WorkspaceStateCard(
                        title: "Couldn't open this file.",
                        message: error,
                        systemImage: "exclamationmark.triangle.fill",
                        tone: .caution,
                        actionTitle: "Reload")
                    {
                        Task { await self.model.reloadSelectedDocument() }
                    }
                } else if let document = self.model.selectedDocument, document.item.id == item.id {
                    self.documentDetail(document)
                } else {
                    WorkspaceStateCard(
                        title: "Preparing file…",
                        message: "The selected file appears here as soon as it is ready.",
                        systemImage: "doc.text",
                        showsProgress: true)
                }
            } else {
                switch self.model.listState {
                case .loading:
                    WorkspaceStateCard(
                        title: "Preparing details…",
                        message: "Pick a file as soon as the catalog finishes loading.",
                        systemImage: "doc.text",
                        showsProgress: true)
                case .error:
                    WorkspaceStateCard(
                        title: "No file to show.",
                        message: "Reload memory to open a file.",
                        systemImage: "rectangle.on.rectangle.slash")
                case let .empty(message):
                    WorkspaceStateCard(
                        title: "No memory yet.",
                        message: message,
                        systemImage: "doc.text")
                case .filteredEmpty:
                    WorkspaceStateCard(
                        title: "No match selected.",
                        message: "Clear or change the search to read a file.",
                        systemImage: "magnifyingglass")
                case .list:
                    WorkspaceStateCard(
                        title: "Choose a file.",
                        message: "The file content appears here.",
                        systemImage: "list.bullet.rectangle")
                }
            }
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
            TextField("Search memory", text: self.$searchText)
                .textFieldStyle(.plain)
            if self.searchText.nonEmpty != nil {
                Button {
                    self.searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help("Clear search")
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 9)
        .background(Color.secondary.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var navigationModePicker: some View {
        Picker("View", selection: self.$navigationMode) {
            ForEach(MemoryNavigationMode.allCases) { mode in
                Text(mode.title)
                    .tag(mode)
            }
        }
        .pickerStyle(.segmented)
    }

    private func sidebarRow(_ item: MemorySurfaceItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(item.title)
                .font(.body.weight(.medium))
                .lineLimit(1)

            if let subtitle = self.sidebarSubtitle(for: item).nonEmpty {
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 6)
    }

    private var graphNavigator: some View {
        let projection = self.model.graphProjection
        return VStack(alignment: .leading, spacing: 10) {
            if projection.lanes.isEmpty {
                WorkspaceStateCard(
                    title: "No graph for this view.",
                    message: "Change the search or list selection to see the catalog links.",
                    systemImage: "point.3.connected.trianglepath.dotted")
            } else {
                ForEach(projection.lanes) { lane in
                    self.graphLane(lane)
                }
            }
        }
    }

    private func graphLane(_ lane: MemoryGraphLane) -> some View {
        WorkspaceSurfaceCard(padding: 12) {
            VStack(alignment: .leading, spacing: 10) {
                self.graphNodeButton(lane.sectionNode)

                ForEach(Array(lane.documentNodes.enumerated()), id: \.element.id) { index, node in
                    HStack(alignment: .top, spacing: 10) {
                        self.graphConnector(isLast: index == lane.documentNodes.count - 1)
                        self.graphNodeButton(node)
                    }
                }
            }
        }
    }

    private func graphNodeButton(_ node: MemoryGraphNode) -> some View {
        Button {
            Task { await self.model.selectGraphNode(node) }
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Image(systemName: node.kind == .section ? node.section.systemImage : "doc.text")
                        .foregroundStyle(node.isSelected ? Color.accentColor : .secondary)
                        .frame(width: 14)
                    Text(node.title)
                        .font(node.kind == .section ? .body.weight(.semibold) : .callout.weight(.medium))
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)
                        .lineLimit(2)
                }

                if let subtitle = node.subtitle?.nonEmpty {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                        .lineLimit(node.kind == .section ? 1 : 2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10)
            .padding(.vertical, 9)
            .background(node.isSelected ? Color.accentColor.opacity(0.12) : Color.secondary.opacity(0.05))
            .overlay {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(
                        node.isSelected ? Color.accentColor.opacity(0.3) : Color.secondary.opacity(0.08),
                        lineWidth: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(node.relatedItemID == nil)
    }

    private func graphConnector(isLast: Bool) -> some View {
        let lineColor = Color.secondary.opacity(0.35)
        return VStack(spacing: 0) {
            Rectangle()
                .fill(lineColor)
                .frame(width: 1, height: 10)
            HStack(spacing: 0) {
                Rectangle()
                    .fill(lineColor)
                    .frame(width: 14, height: 1)
                Circle()
                    .fill(lineColor)
                    .frame(width: 5, height: 5)
            }
            Rectangle()
                .fill(lineColor.opacity(isLast ? 0 : 1))
                .frame(width: 1, height: 18)
        }
        .frame(width: 20, alignment: .leading)
    }

    private func documentDetail(_ document: MemoryWorkspaceFileDocument) -> some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(document.item.title)
                            .font(.system(size: 24, weight: .semibold))
                        Spacer()
                        if self.model.isLoadingSelectedDocument {
                            ProgressView()
                                .controlSize(.small)
                        }
                    }

                    if let label = self.detailLabel(for: document.item).nonEmpty {
                        Text(label)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }

                    Text(document.item.path)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }

                Divider()

                if document.content.isEmpty {
                    Text("This file is empty.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                } else {
                    Text(document.content)
                        .font(.body)
                        .lineSpacing(5)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 28)
            .padding(.vertical, 24)
        }
    }

    private func scheduleSearch(_ query: String) {
        self.searchTask?.cancel()
        self.searchTask = Task {
            try? await Task.sleep(nanoseconds: 250_000_000)
            guard !Task.isCancelled else { return }
            await self.model.search(query: query)
        }
    }

    private func sidebarSubtitle(for item: MemorySurfaceItem) -> String {
        if let snippet = self.model.searchMatchesByItemID[item.id]?.snippet.nonEmpty {
            return self.compactSnippet(snippet)
        }

        switch item.kind {
        case "topic_note", "daily_note":
            return item.kindTitle
        case "agent_instructions", "agent_tools", "agent_heartbeat":
            return item.path
        default:
            return ""
        }
    }

    private func detailLabel(for item: MemorySurfaceItem) -> String {
        let label = item.kindTitle
        if label.caseInsensitiveCompare(item.title) == .orderedSame {
            return ""
        }
        return label
    }

    private func compactSnippet(_ value: String) -> String {
        value
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
