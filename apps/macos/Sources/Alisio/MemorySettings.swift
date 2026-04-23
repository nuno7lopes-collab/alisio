import SwiftUI

import AlisioSupport

struct MemorySettings: View {
    @State private var model: MemorySettingsModel
    @State private var searchText = ""
    @State private var searchTask: Task<Void, Never>?

    init(model: MemorySettingsModel = MemorySettingsModel()) {
        self._model = State(initialValue: model)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            self.header
            HStack(spacing: 12) {
                self.sidebar
                    .frame(width: 320)
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
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Memory")
                    .font(.headline)
                Text("Read daily notes, topic notes, core memory, and agent files.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
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

    private var sidebar: some View {
        SettingsSidebarScroll {
            VStack(alignment: .leading, spacing: 12) {
                self.searchField

                switch self.model.listState {
                case .loading:
                    self.stateCard(
                        title: "Loading memory…",
                        message: "Checking the canonical memory files for this agent.",
                        systemImage: "brain.head.profile",
                        showsProgress: true)
                case let .error(message):
                    self.stateCard(
                        title: "Memory could not be loaded.",
                        message: message,
                        systemImage: "exclamationmark.triangle.fill",
                        tint: .orange,
                        actionTitle: "Try again")
                    {
                        Task { await self.model.refresh() }
                    }
                case let .empty(message):
                    self.stateCard(
                        title: message,
                        message: "When memory files are available, they appear here.",
                        systemImage: "doc.text")
                case .filteredEmpty:
                    self.stateCard(
                        title: "No files match this search.",
                        message: "Try a different term to search titles and file content.",
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
                        } else if let message = self.model.statusMessage?.nonEmpty {
                            Text(message)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }

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
                    }
                }
            }
        }
    }

    private var detail: some View {
        Group {
            if let item = self.model.selectedItem {
                if self.model.isLoadingSelectedDocument && self.model.selectedDocument?.item.id != item.id {
                    self.stateCard(
                        title: "Loading file…",
                        message: "Reading the selected file from the gateway.",
                        systemImage: "doc.text",
                        showsProgress: true)
                } else if let error = self.model.detailError?.nonEmpty {
                    self.stateCard(
                        title: "The file could not be opened.",
                        message: error,
                        systemImage: "exclamationmark.triangle.fill",
                        tint: .orange,
                        actionTitle: "Try again")
                    {
                        Task { await self.model.reloadSelectedDocument() }
                    }
                } else if let document = self.model.selectedDocument, document.item.id == item.id {
                    self.documentDetail(document)
                } else {
                    self.stateCard(
                        title: "Preparing file…",
                        message: "The selected file appears here as soon as it loads.",
                        systemImage: "doc.text",
                        showsProgress: true)
                }
            } else {
                switch self.model.listState {
                case .loading:
                    self.stateCard(
                        title: "Preparing details…",
                        message: "The selected file appears here as soon as memory loads.",
                        systemImage: "doc.text",
                        showsProgress: true)
                case .error:
                    self.stateCard(
                        title: "No file to show.",
                        message: "When memory loads again, the selected file appears here.",
                        systemImage: "rectangle.on.rectangle.slash")
                case .empty:
                    self.stateCard(
                        title: "Nothing to show yet.",
                        message: "When memory files exist, the selected file appears here.",
                        systemImage: "doc.text")
                case .filteredEmpty:
                    self.stateCard(
                        title: "No matching file selected.",
                        message: "Clear or change the search to read a file.",
                        systemImage: "magnifyingglass")
                case .list:
                    self.stateCard(
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
            TextField("Search files and content", text: self.$searchText)
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
        .background(Color.secondary.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func sidebarRow(_ item: MemorySurfaceItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Image(systemName: item.section.systemImage)
                    .foregroundStyle(.secondary)
                    .frame(width: 14)
                Text(item.title)
                    .font(.body.weight(.medium))
                    .lineLimit(1)
            }

            Text(self.metadataLine(for: item))
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        .padding(.vertical, 4)
    }

    private func documentDetail(_ document: MemoryWorkspaceFileDocument) -> some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Label(document.item.title, systemImage: document.item.section.systemImage)
                            .font(.title3.weight(.semibold))
                        Spacer()
                        if self.model.isLoadingSelectedDocument {
                            ProgressView()
                                .controlSize(.small)
                        }
                    }

                    Text(document.item.path)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)

                    Text(self.detailSummary(for: document))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Divider()

                if document.content.isEmpty {
                    Text("This file is empty.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                } else {
                    Text(document.content)
                        .font(.system(.body, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 24)
            .padding(.vertical, 18)
        }
    }

    func stateCard(
        title: String,
        message: String,
        systemImage: String,
        tint: Color = .secondary,
        showsProgress: Bool = false,
        actionTitle: String? = nil,
        action: (() -> Void)? = nil) -> some View
    {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                if showsProgress {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Image(systemName: systemImage)
                        .foregroundStyle(tint)
                }

                Text(title)
                    .font(.headline)
            }

            Text(message)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.bordered)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(16)
        .background(Color.secondary.opacity(0.06))
        .cornerRadius(12)
    }

    private func scheduleSearch(_ query: String) {
        self.searchTask?.cancel()
        self.searchTask = Task {
            try? await Task.sleep(nanoseconds: 250_000_000)
            guard !Task.isCancelled else { return }
            await self.model.search(query: query)
        }
    }

    private func metadataLine(for item: MemorySurfaceItem) -> String {
        var parts = [item.path]
        if let size = item.size {
            parts.append(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
        }
        if let updatedAtMs = item.updatedAtMs {
            let date = Date(timeIntervalSince1970: Double(updatedAtMs) / 1000)
            parts.append("Updated \(RelativeDateTimeFormatter().localizedString(for: date, relativeTo: .now))")
        }
        return parts.joined(separator: " · ")
    }

    private func detailSummary(for document: MemoryWorkspaceFileDocument) -> String {
        var parts = ["Agent \(document.agentId)"]
        if let size = document.size {
            parts.append(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
        }
        if let updatedAtMs = document.updatedAtMs {
            let date = Date(timeIntervalSince1970: Double(updatedAtMs) / 1000)
            parts.append("Updated \(RelativeDateTimeFormatter().localizedString(for: date, relativeTo: .now))")
        }
        return parts.joined(separator: " · ")
    }
}
