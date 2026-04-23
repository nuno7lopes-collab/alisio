import Observation
import SwiftUI

@MainActor
struct ChatSessionsSheet: View {
    private enum PendingConfirmation: Identifiable {
        case reset(AlisioChatSessionEntry)
        case compact(AlisioChatSessionEntry)
        case delete(AlisioChatSessionEntry)

        var id: String {
            switch self {
            case let .reset(session):
                return "reset:\(session.key)"
            case let .compact(session):
                return "compact:\(session.key)"
            case let .delete(session):
                return "delete:\(session.key)"
            }
        }

        var title: String {
            switch self {
            case .reset:
                return "Reset chat?"
            case .compact:
                return "Compact chat?"
            case .delete:
                return "Delete chat?"
            }
        }

        var actionTitle: String {
            switch self {
            case .reset:
                return "Reset"
            case .compact:
                return "Compact"
            case .delete:
                return "Delete"
            }
        }

        var isDestructive: Bool {
            switch self {
            case .delete:
                return true
            case .reset, .compact:
                return false
            }
        }

        var message: String {
            switch self {
            case let .reset(session):
                return "Starts a fresh transcript for “\(Self.chatTitle(for: session))”."
            case .compact:
                return "Keeps the recent transcript and archives the older log."
            case let .delete(session):
                return "Deletes “\(Self.chatTitle(for: session))” and archives its transcript."
            }
        }

        private static func chatTitle(for session: AlisioChatSessionEntry) -> String {
            AlisioChatSessionPresentation.title(for: session)
        }
    }

    @Bindable var viewModel: AlisioChatViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var searchText = ""
    @State private var pendingSwitchSessionKey: String?
    @State private var pendingNewChatSourceKey: String?
    @State private var pendingConfirmation: PendingConfirmation?

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
                        self.normalizedSearchText.isEmpty ? "No chats yet" : "No matching chats",
                        systemImage: "bubble.left.and.bubble.right",
                        description: Text(self.emptyStateMessage))
                } else {
                    List(self.filteredSessions) { session in
                        HStack(alignment: .top, spacing: 10) {
                            Button {
                                self.activate(session)
                            } label: {
                                ChatSessionRowView(viewModel: self.viewModel, session: session)
                            }
                            .buttonStyle(.plain)
                            .disabled(!self.viewModel.canSwitchSessions)

                            Menu {
                                if !self.viewModel.isCurrentSession(session) {
                                    Button("Open Chat") {
                                        self.activate(session)
                                    }
                                }

                                Button("Reset Chat") {
                                    self.pendingConfirmation = .reset(session)
                                }
                                .disabled(!self.viewModel.canResetSession(session))

                                Button("Compact Chat") {
                                    self.pendingConfirmation = .compact(session)
                                }
                                .disabled(!self.viewModel.canCompactSession(session))

                                if !self.viewModel.isMainSession(session) {
                                    Button("Delete Chat", role: .destructive) {
                                        self.pendingConfirmation = .delete(session)
                                    }
                                    .disabled(!self.viewModel.canDeleteSession(session))
                                }
                            } label: {
                                Group {
                                    if self.viewModel.isMutatingSession(session) {
                                        ProgressView()
                                            .controlSize(.small)
                                    } else {
                                        Image(systemName: "ellipsis.circle")
                                    }
                                }
                                .frame(width: 18, height: 18)
                            }
                            .menuStyle(.borderlessButton)
                            .fixedSize()
                        }
                        .padding(.vertical, 2)
                    }
                    .overlay {
                        if self.viewModel.isRefreshingSessions {
                            ProgressView()
                                .controlSize(.large)
                        }
                    }
                }
            }
            .navigationTitle("Recent chats")
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
                        self.startNewChat()
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
                            self.startNewChat()
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
                if let message = self.statusMessage?
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
            .confirmationDialog(
                self.pendingConfirmation?.title ?? "",
                isPresented: Binding(
                    get: { self.pendingConfirmation != nil },
                    set: { isPresented in
                        if !isPresented {
                            self.pendingConfirmation = nil
                        }
                    }),
                titleVisibility: .visible)
            {
                if let confirmation = self.pendingConfirmation {
                    Button(confirmation.actionTitle, role: confirmation.isDestructive ? .destructive : nil) {
                        self.confirm(confirmation)
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text(self.pendingConfirmation?.message ?? "")
            }
            .task(id: self.normalizedSearchText) {
                try? await Task.sleep(for: .milliseconds(250))
                guard !Task.isCancelled else { return }
                self.reloadSessions()
            }
            .onChange(of: self.viewModel.sessionKey) { _, newValue in
                if let pendingSwitchSessionKey,
                   self.viewModel.sessionKeysMatch(newValue, pendingSwitchSessionKey)
                {
                    self.pendingSwitchSessionKey = nil
                    self.pendingNewChatSourceKey = nil
                    self.dismiss()
                    return
                }

                if let sourceSessionKey = self.pendingNewChatSourceKey,
                   !self.viewModel.isCreatingSession,
                   !self.viewModel.sessionKeysMatch(newValue, sourceSessionKey)
                {
                    self.pendingNewChatSourceKey = nil
                    self.dismiss()
                }
            }
            .onChange(of: self.viewModel.isCreatingSession) { _, isCreating in
                guard !isCreating else { return }
                guard let sourceSessionKey = self.pendingNewChatSourceKey else { return }
                guard !self.viewModel.sessionKeysMatch(self.viewModel.sessionKey, sourceSessionKey) else { return }
                self.pendingNewChatSourceKey = nil
                self.dismiss()
            }
        }
    }

    private var statusMessage: String? {
        let actionMessage = self.viewModel.sessionActionErrorText?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let actionMessage, !actionMessage.isEmpty {
            return actionMessage
        }
        let listMessage = self.viewModel.sessionListErrorText?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let listMessage, !listMessage.isEmpty {
            return listMessage
        }
        return nil
    }

    private var emptyStateMessage: String {
        if self.normalizedSearchText.isEmpty {
            return "Start a new chat to keep separate threads and pick up past work later."
        }
        return "Try a different search."
    }

    private func reloadSessions() {
        self.viewModel.refreshSessions(
            search: self.normalizedSearchText.isEmpty ? nil : self.normalizedSearchText,
            limit: 200)
    }

    private func activate(_ session: AlisioChatSessionEntry) {
        if self.viewModel.isCurrentSession(session) {
            self.dismiss()
            return
        }
        self.pendingNewChatSourceKey = nil
        self.pendingSwitchSessionKey = session.key
        self.viewModel.switchSession(to: session.key)
    }

    private func startNewChat() {
        self.pendingSwitchSessionKey = nil
        self.pendingNewChatSourceKey = self.viewModel.sessionKey
        self.viewModel.newChat()
    }

    private func confirm(_ confirmation: PendingConfirmation) {
        switch confirmation {
        case let .reset(session):
            self.viewModel.resetSession(sessionKey: session.key)
        case let .compact(session):
            self.viewModel.compactSession(sessionKey: session.key)
        case let .delete(session):
            self.viewModel.deleteSession(sessionKey: session.key)
        }
        self.pendingConfirmation = nil
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

            Text(self.viewModel.sessionSummary(for: self.session))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(2)
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
