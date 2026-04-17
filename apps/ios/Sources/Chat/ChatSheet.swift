import AlisioChatUI
import AlisioKit
import SwiftUI

struct ChatSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var viewModel: AlisioChatViewModel
    @State private var assistantIdentity: AlisioChatAssistantIdentity
    private let userAccent: Color?
    private let identityRevision: Int
    private let fallbackAssistantIdentity: AlisioChatAssistantIdentity
    private let assistantIdentityResolver: ((String) -> AlisioChatAssistantIdentity)?

    init(
        gateway: GatewayNodeSession,
        sessionKey: String,
        agentName: String? = nil,
        assistantIdentityResolver: ((String) -> AlisioChatAssistantIdentity)? = nil,
        identityRevision: Int = 0,
        agentAvatarURL: String? = nil,
        userAccent: Color? = nil)
    {
        let transport = IOSGatewayChatTransport(gateway: gateway)
        let fallbackAssistantIdentity = AlisioChatAssistantIdentity(
            name: agentName,
            avatarURL: agentAvatarURL)
        self._viewModel = State(
            initialValue: AlisioChatViewModel(
                sessionKey: sessionKey,
                transport: transport))
        self._assistantIdentity = State(
            initialValue: assistantIdentityResolver?(sessionKey) ?? fallbackAssistantIdentity)
        self.userAccent = userAccent
        self.identityRevision = identityRevision
        self.fallbackAssistantIdentity = fallbackAssistantIdentity
        self.assistantIdentityResolver = assistantIdentityResolver
    }

    var body: some View {
        NavigationStack {
            AlisioChatView(
                viewModel: self.viewModel,
                showsSessionSwitcher: true,
                assistantIdentity: self.assistantIdentity,
                userAccent: self.userAccent)
                .navigationTitle(self.chatTitle)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            self.dismiss()
                        } label: {
                            Image(systemName: "xmark")
                        }
                        .accessibilityLabel("Close")
                    }
                }
        }
        .onAppear { self.syncAssistantIdentity(for: self.viewModel.sessionKey) }
        .onChange(of: self.viewModel.sessionKey) { _, next in
            self.syncAssistantIdentity(for: next)
        }
        .onChange(of: self.identityRevision) { _, _ in
            self.syncAssistantIdentity(for: self.viewModel.sessionKey)
        }
    }

    private var chatTitle: String {
        let trimmed = (self.assistantIdentity.name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "Chat" }
        return "Chat (\(trimmed))"
    }

    private func syncAssistantIdentity(for sessionKey: String) {
        let next =
            self.assistantIdentityResolver?(sessionKey) ??
            self.fallbackAssistantIdentity
        if next != self.assistantIdentity {
            self.assistantIdentity = next
        }
    }
}
