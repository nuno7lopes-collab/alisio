import Foundation
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

public struct AlisioChatAssistantIdentity: Equatable, Sendable {
    public let name: String?
    public let avatarURL: String?

    public init(name: String? = nil, avatarURL: String? = nil) {
        self.name = name
        self.avatarURL = avatarURL
    }
}

@MainActor
public struct AlisioChatView: View {
    public enum Style {
        case standard
        case onboarding
        case alisio
    }

    @State private var viewModel: AlisioChatViewModel
    @State private var scrollerBottomID = UUID()
    @State private var scrollPosition: UUID?
    @State private var showSessions = false
    @State private var hasPerformedInitialScroll = false
    @State private var isPinnedToBottom = true
    @State private var lastUserMessageID: UUID?
    private let showsSessionSwitcher: Bool
    private let style: Style
    private let markdownVariant: ChatMarkdownVariant
    private let userAccent: Color?
    private let showsAssistantTrace: Bool
    private let assistantIdentity: AlisioChatAssistantIdentity
    private let autoloadOnAppear: Bool
    private let headerAccessory: AnyView?

    private enum Layout {
        #if os(macOS)
        static let outerPaddingHorizontal: CGFloat = 6
        static let outerPaddingVertical: CGFloat = 0
        static let composerPaddingHorizontal: CGFloat = 0
        static let stackSpacing: CGFloat = 0
        static let messageSpacing: CGFloat = 6
        static let messageListPaddingTop: CGFloat = 12
        static let messageListPaddingBottom: CGFloat = 16
        static let messageListPaddingHorizontal: CGFloat = 6
        #else
        static let outerPaddingHorizontal: CGFloat = 6
        static let outerPaddingVertical: CGFloat = 6
        static let composerPaddingHorizontal: CGFloat = 6
        static let stackSpacing: CGFloat = 6
        static let messageSpacing: CGFloat = 12
        static let messageListPaddingTop: CGFloat = 10
        static let messageListPaddingBottom: CGFloat = 6
        static let messageListPaddingHorizontal: CGFloat = 8
        #endif
    }

    private var outerPaddingHorizontal: CGFloat {
        switch self.style {
        case .standard:
            Layout.outerPaddingHorizontal
        case .onboarding:
            6
        case .alisio:
            0
        }
    }

    private var outerPaddingVertical: CGFloat {
        switch self.style {
        case .standard:
            Layout.outerPaddingVertical
        case .onboarding:
            Layout.outerPaddingVertical
        case .alisio:
            0
        }
    }

    private var composerPaddingHorizontal: CGFloat {
        switch self.style {
        case .standard:
            Layout.composerPaddingHorizontal
        case .onboarding:
            Layout.composerPaddingHorizontal
        case .alisio:
            0
        }
    }

    private var messageSpacing: CGFloat {
        switch self.style {
        case .standard:
            Layout.messageSpacing
        case .onboarding:
            Layout.messageSpacing
        case .alisio:
            18
        }
    }

    private var messageListPaddingTop: CGFloat {
        self.style == .alisio ? 18 : Layout.messageListPaddingTop
    }

    private var messageListPaddingBottom: CGFloat {
        self.style == .alisio ? 28 : Layout.messageListPaddingBottom
    }

    private var messageListPaddingHorizontal: CGFloat {
        self.style == .alisio ? 0 : Layout.messageListPaddingHorizontal
    }

    private var contentMaxWidth: CGFloat {
        self.style == .alisio ? 880 : .infinity
    }

    private var homeComposerMaxWidth: CGFloat {
        self.style == .alisio ? 840 : 760
    }

    public init(
        viewModel: AlisioChatViewModel,
        showsSessionSwitcher: Bool = false,
        style: Style = .standard,
        markdownVariant: ChatMarkdownVariant = .standard,
        assistantIdentity: AlisioChatAssistantIdentity = .init(),
        userAccent: Color? = nil,
        showsAssistantTrace: Bool = false,
        autoloadOnAppear: Bool = true,
        headerAccessory: AnyView? = nil)
    {
        self._viewModel = State(initialValue: viewModel)
        self.showsSessionSwitcher = showsSessionSwitcher
        self.style = style
        self.markdownVariant = markdownVariant
        self.assistantIdentity = assistantIdentity
        self.userAccent = userAccent
        self.showsAssistantTrace = showsAssistantTrace
        self.autoloadOnAppear = autoloadOnAppear
        self.headerAccessory = headerAccessory
    }

    public var body: some View {
        ZStack {
            if self.style == .standard {
                AlisioChatTheme.background
                    .ignoresSafeArea()
            }

            VStack(spacing: Layout.stackSpacing) {
                if self.showsSessionHeader {
                    self.sessionHeader
                        .padding(.horizontal, self.outerPaddingHorizontal)
                        .padding(.top, self.style == .alisio ? 6 : 0)
                }

                if self.showsCenteredHome {
                    self.centeredHome
                        .padding(.horizontal, self.outerPaddingHorizontal)
                } else {
                    self.messageList
                        .padding(.horizontal, self.outerPaddingHorizontal)
                    self.composer
                        .frame(maxWidth: self.contentMaxWidth)
                        .padding(.horizontal, self.composerPaddingHorizontal)
                }
            }
            .padding(.vertical, self.outerPaddingVertical)
            .frame(maxWidth: .infinity)
            .frame(maxHeight: .infinity, alignment: .top)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .onAppear {
            guard self.autoloadOnAppear else { return }
            self.viewModel.load()
        }
        .sheet(isPresented: self.$showSessions) {
            if self.showsSessionSwitcher {
                ChatSessionsSheet(viewModel: self.viewModel)
            } else {
                EmptyView()
            }
        }
    }

    private var composer: some View {
        AlisioChatComposer(
            viewModel: self.viewModel,
            style: self.style,
            showsSessionSwitcher: self.showsSessionSwitcher)
    }

    private var showsSessionHeader: Bool {
        self.style == .alisio
    }

    private var showsCenteredHome: Bool {
        self.style == .alisio &&
            !self.viewModel.isLoading &&
            self.activeErrorText == nil &&
            self.showsEmptyState
    }

    private var sessionHeader: some View {
        HStack(alignment: .center, spacing: 14) {
            Group {
                if self.showsSessionSwitcher {
                    Button {
                        self.showSessions = true
                    } label: {
                        self.sessionSummaryCard(showsDisclosure: true)
                    }
                    .buttonStyle(.plain)
                    .keyboardShortcut("j", modifiers: [.command, .shift])
                } else {
                    self.sessionSummaryCard(showsDisclosure: false)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if let headerAccessory {
                headerAccessory
            }

            Button {
                self.viewModel.newChat()
            } label: {
                if self.viewModel.isCreatingSession {
                    ProgressView()
                        .controlSize(.small)
                        .frame(width: 12, height: 12)
                } else {
                    Label("New chat", systemImage: "square.and.pencil")
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
            .disabled(!self.viewModel.canCreateSession)
            .keyboardShortcut("n", modifiers: [.command])
        }
        .padding(.horizontal, self.style == .alisio ? 6 : 0)
        .padding(.bottom, self.style == .alisio ? 12 : 0)
    }

    private func sessionSummaryCard(showsDisclosure: Bool) -> some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Text("Current chat")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.secondary)

                    if let status = self.currentSessionStatus {
                        self.headerBadge(status.title, tint: status.tint)
                    }
                }

                Text(self.currentSessionTitle)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)

                Text(self.currentSessionSubtitle)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 8) {
                    if self.isMainSession {
                        self.headerBadge("Main", tint: Color.accentColor)
                    } else if self.isFreshSession {
                        self.headerBadge("Fresh", tint: Color.white.opacity(0.75))
                    }

                    if let usage = self.viewModel.currentSessionContextUsage {
                        self.headerBadge("Context \(self.contextUsageLabel(usage))", tint: Color(chatHex: 0x7A8CFF))
                    }
                }
            }

            Spacer(minLength: 0)

            if showsDisclosure {
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Color(chatHex: 0x15171C))
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)))
        .contentShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var centeredHome: some View {
        VStack(spacing: 24) {
            Spacer(minLength: 24)

            VStack(spacing: 24) {
                VStack(spacing: 10) {
                    Text(self.homeTitle)
                        .font(.system(size: 30, weight: .bold))
                        .foregroundStyle(.primary)

                    Text(self.homeSubtitle)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 660)
                }

                self.composer
                    .frame(maxWidth: self.homeComposerMaxWidth)

                if !self.resumeCandidates.isEmpty {
                    self.homeResumeSection
                        .frame(maxWidth: 920)
                }

                self.homeShortcuts
            }
            .frame(maxWidth: 920)

            Spacer(minLength: 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var homeShortcuts: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                self.homeShortcutLabel(text: "Cmd-Shift-J Choose chat")
                self.homeShortcutLabel(text: "Cmd-N New chat")
                self.homeShortcutLabel(text: "Return Send")
                self.homeShortcutLabel(text: "Shift-Return New line")
            }

            VStack(spacing: 8) {
                self.homeShortcutLabel(text: "Cmd-Shift-J Choose chat")
                self.homeShortcutLabel(text: "Cmd-N New chat")
                self.homeShortcutLabel(text: "Return Send")
                self.homeShortcutLabel(text: "Shift-Return New line")
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func homeShortcutLabel(text: String) -> some View {
        Text(text)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                Capsule(style: .continuous)
                    .fill(AlisioChatTheme.subtleCard)
                    .overlay(
                        Capsule(style: .continuous)
                            .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)))
    }

    private var homeTitle: String {
        "What do you want to do next?"
    }

    private var homeSubtitle: String {
        if self.resumeCandidates.contains(where: self.viewModel.isMainSession(_:)) {
            return "Start something new in this chat, then jump back into your main context whenever you need it."
        }
        if !self.resumeCandidates.isEmpty {
            return "Start fresh here or pick up a recent conversation without losing your place."
        }
        return "Use this chat for a focused thread. Your main workspace conversation stays available when you need it."
    }

    private var homeResumeSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(self.resumeSectionTitle)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.primary)

                Text(self.resumeSectionSubtitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.secondary)
            }

            LazyVGrid(columns: self.resumeColumns, spacing: 12) {
                ForEach(self.resumeCandidates) { session in
                    self.resumeCard(for: session)
                }
            }
        }
    }

    private var resumeSectionTitle: String {
        if self.resumeCandidates.contains(where: self.viewModel.isMainSession(_:)) {
            return "Resume context"
        }
        return "Recent chats"
    }

    private var resumeSectionSubtitle: String {
        if self.resumeCandidates.contains(where: self.viewModel.isMainSession(_:)) {
            return "Jump back into the main chat or keep going in another recent thread."
        }
        return "Pick up a recent conversation without losing your place."
    }

    private var resumeCandidates: [AlisioChatSessionEntry] {
        Array(self.viewModel.sessionChoices.filter { !self.viewModel.isCurrentSession($0) }.prefix(3))
    }

    private var resumeColumns: [GridItem] {
        let count = max(1, min(self.resumeCandidates.count, 3))
        return Array(repeating: GridItem(.flexible(minimum: 220), spacing: 12, alignment: .top), count: count)
    }

    private func resumeCard(for session: AlisioChatSessionEntry) -> some View {
        Button {
            self.viewModel.switchSession(to: session.key)
        } label: {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 8) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(self.viewModel.sessionTitle(for: session))
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(.primary)
                            .lineLimit(1)

                        if let updatedAt = self.updatedLabel(for: session) {
                            Text(updatedAt)
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }

                    Spacer(minLength: 8)

                    if self.viewModel.isMainSession(session) {
                        self.headerBadge("Main", tint: Color.accentColor)
                    }
                }

                Text(self.viewModel.sessionSummary(for: session))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.leading)
                    .lineLimit(3)

                if let usage = AlisioChatSessionContextUsage(session: session) {
                    self.headerBadge("Context \(self.contextUsageLabel(usage))", tint: Color(chatHex: 0x7A8CFF))
                }
            }
            .frame(maxWidth: .infinity, minHeight: 124, alignment: .topLeading)
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(Color(chatHex: 0x14161A))
                    .overlay(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)))
        }
        .buttonStyle(.plain)
        .disabled(!self.viewModel.canSwitchSessions)
    }

    private func headerBadge(_ title: String, tint: Color) -> some View {
        Text(title)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(
                Capsule(style: .continuous)
                    .fill(tint.opacity(0.14))
                    .overlay(
                        Capsule(style: .continuous)
                            .strokeBorder(tint.opacity(0.18), lineWidth: 1)))
    }

    private var currentSessionTitle: String {
        self.viewModel.currentSessionTitle
    }

    private var currentSessionSubtitle: String {
        self.viewModel.currentSessionSubtitle
    }

    private var currentSessionStatus: (title: String, tint: Color)? {
        if self.viewModel.connectionPhase == .reconnecting {
            return ("Reconnecting", Color(chatHex: 0xF0A245))
        }
        if self.viewModel.connectionPhase == .firstMessage {
            return ("Preparing reply", Color(chatHex: 0x7A8CFF))
        }
        if !self.viewModel.pendingToolCalls.isEmpty || self.viewModel.pendingRunCount > 0 {
            return ("Working", Color(chatHex: 0x7A8CFF))
        }
        return nil
    }

    private var isMainSession: Bool {
        guard let session = self.viewModel.currentSessionEntry else {
            return self.viewModel.isMainSessionKey(self.viewModel.sessionKey)
        }
        return self.viewModel.isMainSession(session)
    }

    private var isFreshSession: Bool {
        guard let session = self.viewModel.currentSessionEntry else {
            return self.viewModel.messages.isEmpty
        }
        return self.viewModel.isCurrentSession(session) && session.updatedAt == nil && session.sessionId == nil
    }

    private func updatedLabel(for session: AlisioChatSessionEntry) -> String? {
        guard let updatedAt = session.updatedAt, updatedAt > 0 else { return nil }
        return Date(timeIntervalSince1970: updatedAt / 1000).formatted(date: .abbreviated, time: .shortened)
    }

    private func contextUsageLabel(_ usage: AlisioChatSessionContextUsage) -> String {
        let used = Self.formatCompactTokenCount(usage.totalTokens)
        let total = usage.contextWindow > 0 ? Self.formatCompactTokenCount(usage.contextWindow) : "?"
        return "\(used)/\(total)"
    }

    private static func formatCompactTokenCount(_ value: Int) -> String {
        guard value >= 1_000 else { return "\(value)" }

        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = value >= 100_000 ? 0 : 1

        if value >= 1_000_000 {
            let short = formatter.string(from: NSNumber(value: Double(value) / 1_000_000)) ?? "\(value)"
            return "\(short)M"
        }

        let short = formatter.string(from: NSNumber(value: Double(value) / 1_000)) ?? "\(value)"
        return "\(short)k"
    }

    private var messageList: some View {
        ZStack {
            ScrollView {
                LazyVStack(spacing: self.messageSpacing) {
                    self.messageListRows

                    Color.clear
                        #if os(macOS)
                        .frame(height: self.messageListPaddingBottom)
                        #else
                        .frame(height: self.messageListPaddingBottom + 1)
                        #endif
                        .id(self.scrollerBottomID)
                }
                // Use scroll targets for stable auto-scroll without ScrollViewReader relayout glitches.
                .scrollTargetLayout()
                .frame(maxWidth: self.contentMaxWidth)
                .frame(maxWidth: .infinity)
                .padding(.top, self.messageListPaddingTop)
                .padding(.horizontal, self.messageListPaddingHorizontal)
            }
            #if !os(macOS)
            .scrollDismissesKeyboard(.interactively)
            #endif
            // Keep the scroll pinned to the bottom for new messages.
            .scrollPosition(id: self.$scrollPosition, anchor: .bottom)
            .onChange(of: self.scrollPosition) { _, position in
                guard let position else { return }
                self.isPinnedToBottom = position == self.scrollerBottomID
            }

            if self.viewModel.isLoading {
                ProgressView()
                    .controlSize(.large)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            self.messageListOverlay
        }
        // Ensure the message list claims vertical space on the first layout pass.
        .frame(maxHeight: .infinity, alignment: .top)
        .layoutPriority(1)
        .simultaneousGesture(
            TapGesture().onEnded {
                self.dismissKeyboardIfNeeded()
            })
        .onChange(of: self.viewModel.isLoading) { _, isLoading in
            guard !isLoading, !self.hasPerformedInitialScroll else { return }
            self.scrollPosition = self.scrollerBottomID
            self.hasPerformedInitialScroll = true
            self.isPinnedToBottom = true
        }
        .onChange(of: self.viewModel.sessionKey) { _, _ in
            self.hasPerformedInitialScroll = false
            self.isPinnedToBottom = true
        }
        .onChange(of: self.viewModel.isSending) { _, isSending in
            // Scroll to bottom when user sends a message, even if scrolled up.
            guard isSending, self.hasPerformedInitialScroll else { return }
            self.isPinnedToBottom = true
            withAnimation(.snappy(duration: 0.22)) {
                self.scrollPosition = self.scrollerBottomID
            }
        }
        .onChange(of: self.viewModel.messages.count) { _, _ in
            guard self.hasPerformedInitialScroll else { return }
            if let lastMessage = self.viewModel.messages.last,
               lastMessage.role.lowercased() == "user",
               lastMessage.id != self.lastUserMessageID {
                self.lastUserMessageID = lastMessage.id
                self.isPinnedToBottom = true
                withAnimation(.snappy(duration: 0.22)) {
                    self.scrollPosition = self.scrollerBottomID
                }
                return
            }

            guard self.isPinnedToBottom else { return }
            withAnimation(.snappy(duration: 0.22)) {
                self.scrollPosition = self.scrollerBottomID
            }
        }
        .onChange(of: self.viewModel.pendingRunCount) { _, _ in
            guard self.hasPerformedInitialScroll, self.isPinnedToBottom else { return }
            withAnimation(.snappy(duration: 0.22)) {
                self.scrollPosition = self.scrollerBottomID
            }
        }
        .onChange(of: self.viewModel.streamingAssistantText) { _, _ in
            guard self.hasPerformedInitialScroll, self.isPinnedToBottom else { return }
            withAnimation(.snappy(duration: 0.22)) {
                self.scrollPosition = self.scrollerBottomID
            }
        }
    }

    @ViewBuilder
    private var messageListRows: some View {
        ForEach(self.visibleMessages) { msg in
            ChatMessageBubble(
                message: msg,
                style: self.style,
                markdownVariant: self.markdownVariant,
                assistantIdentity: self.assistantIdentity,
                userAccent: self.userAccent,
                showsAssistantTrace: self.showsAssistantTrace)
                .frame(
                    maxWidth: .infinity,
                    alignment: msg.role.lowercased() == "user" ? .trailing : .leading)
        }

        if self.viewModel.pendingRunCount > 0 {
            HStack {
                ChatTypingIndicatorBubble(style: self.style, assistantIdentity: self.assistantIdentity)
                    .equatable()
                Spacer(minLength: 0)
            }
        }

        if !self.viewModel.pendingToolCalls.isEmpty {
            ChatPendingToolsBubble(
                toolCalls: self.viewModel.pendingToolCalls,
                assistantIdentity: self.assistantIdentity)
                .equatable()
                .frame(maxWidth: .infinity, alignment: .leading)
        }

        if let text = self.viewModel.streamingAssistantText,
           AssistantTextParser.hasVisibleContent(in: text, includeThinking: self.showsAssistantTrace)
        {
            ChatStreamingAssistantBubble(
                text: text,
                markdownVariant: self.markdownVariant,
                assistantIdentity: self.assistantIdentity,
                showsAssistantTrace: self.showsAssistantTrace)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var visibleMessages: [AlisioChatMessage] {
        let base: [AlisioChatMessage]
        if self.style == .onboarding {
            guard let first = self.viewModel.messages.first else { return [] }
            base = first.role.lowercased() == "user" ? Array(self.viewModel.messages.dropFirst()) : self.viewModel
                .messages
        } else {
            base = self.viewModel.messages
        }
        return self.mergeToolResults(in: base).filter(self.shouldDisplayMessage(_:))
    }

    @ViewBuilder
    private var messageListOverlay: some View {
        if self.viewModel.isLoading {
            EmptyView()
        } else if let error = self.activeErrorText {
            let presentation = self.errorPresentation(for: error)
            if self.hasVisibleMessageListContent {
                VStack(spacing: 0) {
                    ChatNoticeBanner(
                        systemImage: presentation.systemImage,
                        title: presentation.title,
                        message: error,
                        tint: presentation.tint,
                        dismiss: { self.viewModel.dismissError() },
                        refresh: { self.viewModel.refresh() })
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 10)
                .padding(.top, 8)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            } else {
                ChatNoticeCard(
                    systemImage: presentation.systemImage,
                    title: presentation.title,
                    message: error,
                    tint: presentation.tint,
                    actionTitle: "Refresh",
                    action: { self.viewModel.refresh() })
                    .padding(.horizontal, 24)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else if self.showsEmptyState {
            ChatNoticeCard(
                systemImage: "bubble.left.and.bubble.right.fill",
                title: self.emptyStateTitle,
                message: self.emptyStateMessage,
                tint: .accentColor,
                actionTitle: nil,
                action: nil)
                .padding(.horizontal, 24)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var activeErrorText: String? {
        self.viewModel.activeErrorText
    }

    private var hasVisibleMessageListContent: Bool {
        if !self.visibleMessages.isEmpty {
            return true
        }
        if let text = self.viewModel.streamingAssistantText,
           AssistantTextParser.hasVisibleContent(in: text, includeThinking: self.showsAssistantTrace)
        {
            return true
        }
        if self.viewModel.pendingRunCount > 0 {
            return true
        }
        if !self.viewModel.pendingToolCalls.isEmpty {
            return true
        }
        return false
    }

    private var showsEmptyState: Bool {
        self.viewModel.messages.isEmpty &&
            !(self.viewModel.streamingAssistantText.map {
                AssistantTextParser.hasVisibleContent(in: $0, includeThinking: self.showsAssistantTrace)
            } ?? false) &&
            self.viewModel.pendingRunCount == 0 &&
            self.viewModel.pendingToolCalls.isEmpty
    }

    private var emptyStateTitle: String {
        "Start a conversation"
    }

    private var emptyStateMessage: String {
        #if os(macOS)
        "Type a message below to get started.\nReturn sends • Shift-Return adds a line break."
        #else
        "Type a message below to get started."
        #endif
    }

    private func errorPresentation(for error: String) -> (title: String, systemImage: String, tint: Color) {
        let lower = error.lowercased()
        if lower.contains("not connected") || lower.contains("socket") {
            return ("Disconnected", "wifi.slash", .orange)
        }
        if lower.contains("timed out") {
            return ("Timed out", "clock.badge.exclamationmark", .orange)
        }
        return ("Error", "exclamationmark.triangle.fill", .orange)
    }

    private func mergeToolResults(in messages: [AlisioChatMessage]) -> [AlisioChatMessage] {
        var result: [AlisioChatMessage] = []
        result.reserveCapacity(messages.count)

        for message in messages {
            guard self.isToolResultMessage(message) else {
                result.append(message)
                continue
            }

            guard let toolCallId = message.toolCallId,
                  let last = result.last,
                  self.toolCallIds(in: last).contains(toolCallId)
            else {
                result.append(message)
                continue
            }

            let toolText = self.toolResultText(from: message)
            if toolText.isEmpty {
                continue
            }

            var content = last.content
            content.append(
                AlisioChatMessageContent(
                    type: "tool_result",
                    text: toolText,
                    thinking: nil,
                    thinkingSignature: nil,
                    mimeType: nil,
                    fileName: nil,
                    content: nil,
                    id: toolCallId,
                    name: message.toolName,
                    arguments: nil))

            let merged = AlisioChatMessage(
                id: last.id,
                role: last.role,
                content: content,
                timestamp: last.timestamp,
                toolCallId: last.toolCallId,
                toolName: last.toolName,
                usage: last.usage,
                stopReason: last.stopReason)
            result[result.count - 1] = merged
        }

        return result
    }

    private func isToolResultMessage(_ message: AlisioChatMessage) -> Bool {
        let role = message.role.lowercased()
        return role == "toolresult" || role == "tool_result"
    }

    private func shouldDisplayMessage(_ message: AlisioChatMessage) -> Bool {
        if self.hasInlineAttachments(in: message) {
            return true
        }

        let primaryText = self.primaryText(in: message)
        if !primaryText.isEmpty {
            if message.role.lowercased() == "user" {
                return true
            }
            if AssistantTextParser.hasVisibleContent(in: primaryText, includeThinking: self.showsAssistantTrace) {
                return true
            }
        }

        guard self.showsAssistantTrace else {
            return false
        }

        if self.isToolResultMessage(message) {
            return !primaryText.isEmpty
        }

        return !self.toolCalls(in: message).isEmpty || !self.inlineToolResults(in: message).isEmpty
    }

    private func primaryText(in message: AlisioChatMessage) -> String {
        let parts = message.content.compactMap { content -> String? in
            let kind = (content.type ?? "text").lowercased()
            guard kind == "text" || kind.isEmpty else { return nil }
            return content.text
        }
        return parts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func hasInlineAttachments(in message: AlisioChatMessage) -> Bool {
        message.content.contains { content in
            switch content.type ?? "text" {
            case "file", "attachment":
                true
            default:
                false
            }
        }
    }

    private func toolCalls(in message: AlisioChatMessage) -> [AlisioChatMessageContent] {
        message.content.filter { content in
            let kind = (content.type ?? "").lowercased()
            if ["toolcall", "tool_call", "tooluse", "tool_use"].contains(kind) {
                return true
            }
            return content.name != nil && content.arguments != nil
        }
    }

    private func inlineToolResults(in message: AlisioChatMessage) -> [AlisioChatMessageContent] {
        message.content.filter { content in
            let kind = (content.type ?? "").lowercased()
            return kind == "toolresult" || kind == "tool_result"
        }
    }

    private func toolCallIds(in message: AlisioChatMessage) -> Set<String> {
        var ids = Set<String>()
        for content in self.toolCalls(in: message) {
            if let id = content.id {
                ids.insert(id)
            }
        }
        if let toolCallId = message.toolCallId {
            ids.insert(toolCallId)
        }
        return ids
    }

    private func toolResultText(from message: AlisioChatMessage) -> String {
        self.primaryText(in: message)
    }

    private func dismissKeyboardIfNeeded() {
        #if canImport(UIKit)
        UIApplication.shared.sendAction(
            #selector(UIResponder.resignFirstResponder),
            to: nil,
            from: nil,
            for: nil)
        #endif
    }
}

private struct ChatNoticeCard: View {
    let systemImage: String
    let title: String
    let message: String
    let tint: Color
    let actionTitle: String?
    let action: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(self.tint.opacity(0.16))
                Image(systemName: self.systemImage)
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(self.tint)
            }
            .frame(width: 52, height: 52)

            Text(self.title)
                .font(.headline)

            Text(self.message)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .lineLimit(4)
                .frame(maxWidth: 360)

            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
            }
        }
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(AlisioChatTheme.subtleCard)
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.12), lineWidth: 1)))
        .shadow(color: .black.opacity(0.14), radius: 18, y: 8)
    }
}

private struct ChatNoticeBanner: View {
    let systemImage: String
    let title: String
    let message: String
    let tint: Color
    let dismiss: () -> Void
    let refresh: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: self.systemImage)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(self.tint)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 3) {
                Text(self.title)
                    .font(.caption.weight(.semibold))

                Text(self.message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            Spacer(minLength: 0)

            Button(action: self.refresh) {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .help("Refresh")

            Button(action: self.dismiss) {
                Image(systemName: "xmark")
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .help("Dismiss")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(AlisioChatTheme.subtleCard)
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.12), lineWidth: 1)))
    }
}
