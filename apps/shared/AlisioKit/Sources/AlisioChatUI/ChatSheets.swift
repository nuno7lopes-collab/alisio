import Observation
import SwiftUI

@MainActor
struct ChatSessionsSheet: View {
    @Bindable var viewModel: AlisioChatViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var searchText = ""

    private var normalizedSearchText: String {
        self.searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var filteredSessions: [AlisioChatSessionEntry] {
        let query = self.normalizedSearchText.lowercased()
        guard !query.isEmpty else { return self.viewModel.sessionChoices }
        return self.viewModel.sessionChoices.filter { session in
            self.viewModel.sessionSearchText(for: session).lowercased().contains(query)
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if self.filteredSessions.isEmpty, !self.viewModel.isRefreshingSessions {
                    ContentUnavailableView(
                        "No Chats",
                        systemImage: "bubble.left.and.bubble.right",
                        description: Text(self.emptyStateMessage))
                } else {
                    List(self.filteredSessions) { session in
                        Button {
                            self.viewModel.switchSession(to: session.key)
                            self.dismiss()
                        } label: {
                            ChatSessionRowView(viewModel: self.viewModel, session: session)
                        }
                        .buttonStyle(.plain)
                        .disabled(!self.viewModel.canSwitchSessions)
                    }
                    .overlay {
                        if self.viewModel.isRefreshingSessions {
                            ProgressView()
                                .controlSize(.large)
                        }
                    }
                }
            }
            .navigationTitle("Chats")
            .searchable(text: self.$searchText, prompt: "Search chats")
            .toolbar {
                #if os(macOS)
                ToolbarItemGroup(placement: .primaryAction) {
                    Button {
                        self.reloadSessions()
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(self.viewModel.isRefreshingSessions)

                    Button {
                        self.viewModel.newChat()
                        self.dismiss()
                    } label: {
                        if self.viewModel.isCreatingSession {
                            ProgressView().controlSize(.small)
                        } else {
                            Label("New Chat", systemImage: "square.and.pencil")
                        }
                    }
                    .disabled(!self.viewModel.canCreateSession)

                    Button {
                        self.dismiss()
                    } label: {
                        Image(systemName: "xmark")
                    }
                }
                #else
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        self.reloadSessions()
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(self.viewModel.isRefreshingSessions)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: 12) {
                        Button("New Chat") {
                            self.viewModel.newChat()
                            self.dismiss()
                        }
                        .disabled(!self.viewModel.canCreateSession)

                        Button {
                            self.dismiss()
                        } label: {
                            Image(systemName: "xmark")
                        }
                    }
                }
                #endif
            }
            .overlay(alignment: .bottom) {
                if let message = self.viewModel.sessionListErrorText?
                    .trimmingCharacters(in: .whitespacesAndNewlines),
                   !message.isEmpty
                {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(
                            Capsule(style: .continuous)
                                .fill(AlisioChatTheme.subtleCard))
                        .padding(.bottom, 12)
                }
            }
            .task(id: self.normalizedSearchText) {
                try? await Task.sleep(for: .milliseconds(250))
                guard !Task.isCancelled else { return }
                self.reloadSessions()
            }
        }
    }

    private var emptyStateMessage: String {
        if self.normalizedSearchText.isEmpty {
            return "Start a new chat or refresh to load recent sessions."
        }
        return "Try a different search."
    }

    private func reloadSessions() {
        self.viewModel.refreshSessions(
            search: self.normalizedSearchText.isEmpty ? nil : self.normalizedSearchText,
            limit: 200)
    }
}

private struct ChatSessionRowView: View {
    let viewModel: AlisioChatViewModel
    let session: AlisioChatSessionEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(self.viewModel.sessionTitle(for: self.session))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)

                if self.viewModel.isCurrentSession(self.session) {
                    self.badge("Current", tint: .accentColor)
                } else if self.viewModel.isMainSession(self.session) {
                    self.badge("Main", tint: .secondary)
                }

                Spacer(minLength: 8)

                if let updatedAt = self.session.updatedAt, updatedAt > 0 {
                    Text(Date(timeIntervalSince1970: updatedAt / 1000).formatted(
                        date: .abbreviated,
                        time: .shortened))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: true, vertical: false)
                }
            }

            if let preview = self.viewModel.sessionPreviewText(for: self.session) {
                Text(preview)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            } else {
                Text(self.session.key)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }

    private func badge(_ title: String, tint: Color) -> some View {
        Text(title)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(tint.opacity(0.12))
            .clipShape(Capsule(style: .continuous))
    }
}
