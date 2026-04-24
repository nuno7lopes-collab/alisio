import Observation
import SwiftUI

import AlisioSupport

// The product surface is "Capabilities"; gateway-reported skills are the backing data model.
struct CapabilitiesSettings: View {
    enum ListState: Equatable {
        case loading
        case error(String)
        case empty(String)
        case filteredEmpty
        case list
    }

    @Bindable var state: AppState
    let showsHeader: Bool
    @State private var model = CapabilitiesSettingsModel()
    @State private var envEditor: EnvEditorState?
    @State private var filter: CapabilitiesFilter = .all

    init(
        state: AppState = AppStateStore.shared,
        model: CapabilitiesSettingsModel = CapabilitiesSettingsModel(),
        showsHeader: Bool = true)
    {
        self.state = state
        self.showsHeader = showsHeader
        self._model = State(initialValue: model)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            self.header
            self.content
            Spacer(minLength: 0)
        }
        .task(id: self.state.connectionMode) { await self.model.refresh() }
        .sheet(item: self.$envEditor) { editor in
            EnvEditorView(editor: editor) { value in
                await self.model.updateEnv(
                    skillKey: editor.skillKey,
                    envKey: editor.envKey,
                    value: value,
                    isPrimary: editor.isPrimary)
            }
        }
    }

    private var trimmedError: String? {
        let trimmed = self.model.error?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private var trimmedEmptyMessage: String? {
        let trimmed = self.model.emptyMessage?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private var trimmedStaleMessage: String? {
        let trimmed = self.model.staleMessage?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    var listState: ListState {
        self.listState(for: self.filter)
    }

    private func listState(for filter: CapabilitiesFilter) -> ListState {
        let filteredCapabilities = self.filteredCapabilities(for: filter)
        if !self.model.skills.isEmpty {
            return filteredCapabilities.isEmpty ? .filteredEmpty : .list
        }

        if self.model.isLoading || !self.model.hasLoadedOnce {
            return .loading
        }

        if let error = self.trimmedError {
            return .error(error)
        }

        return .empty(self.trimmedEmptyMessage ?? CapabilitiesSettingsModel.emptyCapabilitiesMessage)
    }

    private var header: some View {
        WorkspaceRouteHeader(
            title: "Capabilities",
            subtitle: "See what is ready to use and what still needs setup.",
            showsTitle: self.showsHeader)
        {
            HStack(spacing: 10) {
                self.headerFilter
                Button {
                    Task { await self.model.refresh() }
                } label: {
                    HStack(spacing: 6) {
                        if self.model.isLoading {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                }
                .buttonStyle(.bordered)
                .disabled(self.model.isLoading)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch self.listState {
        case .loading:
            WorkspaceStateCard(
                title: "Loading capabilities…",
                message: "Checking the current connection.",
                systemImage: "arrow.triangle.2.circlepath",
                showsProgress: true)
        case let .error(message):
            WorkspaceStateCard(
                title: "Capabilities could not be loaded.",
                message: message,
                systemImage: "exclamationmark.triangle.fill",
                tone: .caution,
                actionTitle: "Refresh")
            {
                Task { await self.model.refresh() }
            }
        case let .empty(message):
            if message == CapabilitiesSettingsModel.signedOutMessage {
                WorkspaceStateCard(
                    title: message,
                    message: "Capabilities appear here after you sign in.",
                    systemImage: "person.crop.circle.badge.exclamationmark")
            } else {
                WorkspaceStateCard(
                    title: message,
                    message: "Refresh if you expect something to be available here.",
                    systemImage: "sparkles")
            }
        case .filteredEmpty:
            WorkspaceStateCard(
                title: "No capabilities match this filter.",
                message: "Try another filter to see the remaining capabilities.",
                systemImage: "line.3.horizontal.decrease.circle")
        case .list:
            self.capabilitiesList
        }
    }

    private var capabilitiesList: some View {
        VStack(alignment: .leading, spacing: 8) {
            if self.model.isLoading {
                InlineMessage(
                    message: "Checking the current state…",
                    tone: .secondary,
                    showsProgress: true)
            } else if let staleMessage = self.trimmedStaleMessage {
                InlineMessage(
                    message: "Showing the last confirmed state. \(staleMessage)",
                    tone: .warning)
            } else if let error = self.trimmedError {
                InlineMessage(message: error, tone: .error)
            }

            List {
                ForEach(self.filteredCapabilities) { skill in
                    CapabilityRow(
                        skill: skill,
                        isBusy: self.model.isBusy(skill: skill),
                        busyLabel: self.model.operationLabel(skill: skill),
                        notice: self.model.feedback(skill: skill),
                        isInteractive: self.model.canInteract && !self.model.isLoading,
                        connectionMode: self.state.connectionMode,
                        onToggleEnabled: { enabled in
                            Task { await self.model.setEnabled(skillKey: skill.skillKey, enabled: enabled) }
                        },
                        onInstall: { option, target in
                            Task { await self.model.install(skill: skill, option: option, target: target) }
                        },
                        onSwitchToLocal: {
                            self.state.connectionMode = .local
                        },
                        onSetEnv: { envKey, isPrimary in
                            self.envEditor = EnvEditorState(
                                skillKey: skill.skillKey,
                                skillName: skill.name,
                                envKey: envKey,
                                isPrimary: isPrimary,
                                homepage: skill.homepage)
                        })
                }
            }
            .listStyle(.inset)
        }
    }

    private var headerFilter: some View {
        Picker("Filter", selection: self.$filter) {
            ForEach(CapabilitiesFilter.allCases) { filter in
                Text(filter.title)
                    .tag(filter)
            }
        }
        .labelsHidden()
        .pickerStyle(.menu)
        .frame(width: 160, alignment: .trailing)
    }

    private var filteredCapabilities: [SkillStatus] {
        self.filteredCapabilities(for: self.filter)
    }

    private func filteredCapabilities(for filter: CapabilitiesFilter) -> [SkillStatus] {
        self.model.skills.filter { skill in
            switch filter {
            case .all:
                true
            case .ready:
                !skill.disabled && skill.eligible
            case .needsSetup:
                !skill.disabled && !skill.eligible
            case .disabled:
                skill.disabled
            }
        }
    }
}

private enum CapabilitiesFilter: String, CaseIterable, Identifiable {
    case all
    case ready
    case needsSetup
    case disabled

    var id: String {
        self.rawValue
    }

    var title: String {
        switch self {
        case .all:
            "All"
        case .ready:
            "Ready"
        case .needsSetup:
            "Needs setup"
        case .disabled:
            "Disabled"
        }
    }
}

private enum InstallTarget: String, CaseIterable {
    case gateway
    case local
}

enum CapabilityNoticeTone: Equatable, Sendable {
    case secondary
    case success
    case warning
    case error

    var color: Color {
        switch self {
        case .secondary, .success:
            .secondary
        case .warning:
            .orange
        case .error:
            .red
        }
    }

    var iconName: String? {
        switch self {
        case .secondary:
            nil
        case .success:
            "checkmark.circle"
        case .warning:
            "exclamationmark.triangle"
        case .error:
            "xmark.circle"
        }
    }
}

struct CapabilityNotice: Equatable, Sendable {
    let text: String
    let tone: CapabilityNoticeTone
}

enum CapabilityRowStatus: Equatable {
    case ready
    case needsInstall
    case needsSetup
    case disabled

    var title: String {
        switch self {
        case .ready:
            "Ready"
        case .needsInstall:
            "Needs install"
        case .needsSetup:
            "Needs setup"
        case .disabled:
            "Disabled"
        }
    }

    var color: Color {
        switch self {
        case .ready:
            .green
        case .needsInstall, .needsSetup:
            .orange
        case .disabled:
            .secondary
        }
    }
}

struct CapabilityRowPresentation: Equatable {
    let status: CapabilityRowStatus
    let summary: String
    let installActionTitle: String?
    let switchToLocalActionTitle: String?
    let envActionTitle: String?
    let guideActionTitle: String?
    let showsToggle: Bool

    init(skill: SkillStatus, connectionMode: AppState.ConnectionMode) {
        let missingBins = skill.missing.bins
        let missingEnv = skill.missing.env
        let missingConfig = skill.missing.config
        let installOptions = Self.installOptions(for: skill)
        let missingPrimaryEnv = skill.primaryEnv.map(missingEnv.contains) ?? false
        let hasRequirements = missingBins.isEmpty && missingEnv.isEmpty && missingConfig.isEmpty
        let needsSetup = !hasRequirements || !skill.eligible

        self.installActionTitle = installOptions.isEmpty
            ? nil
            : (connectionMode == .remote ? "Install on remote" : "Install")
        self.switchToLocalActionTitle = installOptions.isEmpty || connectionMode != .remote ? nil : "Use This Mac"

        if missingPrimaryEnv {
            self.envActionTitle = "Add API key"
        } else if !missingEnv.isEmpty {
            self.envActionTitle = missingEnv.count > 1 || !missingConfig.isEmpty
                ? "Continue setup"
                : "Add required value"
        } else {
            self.envActionTitle = nil
        }

        let hasGuide = skill.homepage?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        self.guideActionTitle = self.envActionTitle == nil && hasGuide && needsSetup
            ? "Open setup guide"
            : nil

        if skill.disabled {
            self.status = .disabled
            self.summary = Self.disabledSummary(
                missingBins: missingBins,
                missingEnv: missingEnv,
                missingConfig: missingConfig,
                installAvailable: !installOptions.isEmpty,
                connectionMode: connectionMode,
                missingPrimaryEnv: missingPrimaryEnv,
                hasRequirements: hasRequirements)
        } else if !missingBins.isEmpty {
            self.status = .needsInstall
            self.summary = Self.installSummary(
                installAvailable: !installOptions.isEmpty,
                connectionMode: connectionMode)
        } else if needsSetup {
            self.status = .needsSetup
            self.summary = Self.setupSummary(
                missingEnv: missingEnv,
                missingConfig: missingConfig,
                missingPrimaryEnv: missingPrimaryEnv)
        } else {
            self.status = .ready
            self.summary = "Ready to use."
        }

        self.showsToggle = hasRequirements && installOptions.isEmpty
    }

    private static func installOptions(for skill: SkillStatus) -> [SkillInstallOption] {
        guard !skill.missing.bins.isEmpty else { return [] }
        let missing = Set(skill.missing.bins)
        return skill.install.filter { option in
            if option.bins.isEmpty { return true }
            return !missing.isDisjoint(with: option.bins)
        }
    }

    private static func installSummary(
        installAvailable: Bool,
        connectionMode: AppState.ConnectionMode) -> String
    {
        if installAvailable {
            return connectionMode == .remote
                ? "Install is still required on the current remote system."
                : "Install is still required on this Mac."
        }
        return "This capability still needs software before it can run."
    }

    private static func setupSummary(
        missingEnv: [String],
        missingConfig: [String],
        missingPrimaryEnv: Bool) -> String
    {
        if missingPrimaryEnv {
            return "Add an API key to finish setup."
        }
        if !missingEnv.isEmpty {
            return missingEnv.count == 1 && missingConfig.isEmpty
                ? "Add the required value to finish setup."
                : "More setup is still required before this can run."
        }
        if !missingConfig.isEmpty {
            return "More setup is still required before this can run."
        }
        return "This capability still needs setup."
    }

    private static func disabledSummary(
        missingBins: [String],
        missingEnv: [String],
        missingConfig: [String],
        installAvailable: Bool,
        connectionMode: AppState.ConnectionMode,
        missingPrimaryEnv: Bool,
        hasRequirements: Bool) -> String
    {
        guard !hasRequirements else { return "Disabled." }
        if !missingBins.isEmpty {
            return installAvailable
                ? (connectionMode == .remote
                    ? "Disabled. Install is still required on the current remote system."
                    : "Disabled. Install is still required on this Mac.")
                : "Disabled. This capability still needs software before it can be turned back on."
        }
        if missingPrimaryEnv {
            return "Disabled. Add an API key before turning it back on."
        }
        if !missingEnv.isEmpty || !missingConfig.isEmpty {
            return "Disabled. Finish setup before turning it back on."
        }
        return "Disabled."
    }
}

private struct CapabilityRow: View {
    let skill: SkillStatus
    let isBusy: Bool
    let busyLabel: String?
    let notice: CapabilityNotice?
    let isInteractive: Bool
    let connectionMode: AppState.ConnectionMode
    let onToggleEnabled: (Bool) -> Void
    let onInstall: (SkillInstallOption, InstallTarget) -> Void
    let onSwitchToLocal: () -> Void
    let onSetEnv: (String, Bool) -> Void

    private var missingBins: [String] {
        self.skill.missing.bins
    }

    private var missingEnv: [String] {
        self.skill.missing.env
    }

    private var missingConfig: [String] {
        self.skill.missing.config
    }

    private var presentation: CapabilityRowPresentation {
        CapabilityRowPresentation(skill: self.skill, connectionMode: self.connectionMode)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(self.skill.emoji ?? "✨")
                .font(.title2)

            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(self.skill.name)
                        .font(.headline)
                    CapabilityStatusTag(status: self.presentation.status)
                }
                Text(self.skill.description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(self.presentation.summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                if let notice = self.notice {
                    InlineMessage(message: notice.text, tone: notice.tone)
                }

                if self.isBusy {
                    InlineMessage(
                        message: self.busyLabel ?? "Updating…",
                        tone: .secondary,
                        showsProgress: true)
                }
            }

            Spacer(minLength: 0)

            self.trailingActions
        }
        .padding(.vertical, 8)
    }

    private var homepageUrl: URL? {
        guard let raw = self.skill.homepage?.trimmingCharacters(in: .whitespacesAndNewlines) else {
            return nil
        }
        guard
            !raw.isEmpty,
            let url = URL(string: raw),
            let scheme = url.scheme?.lowercased(),
            scheme == "http" || scheme == "https"
        else {
            return nil
        }
        return url
    }

    private var enabledBinding: Binding<Bool> {
        Binding(
            get: { !self.skill.disabled },
            set: { self.onToggleEnabled($0) })
    }

    private var nextEnvAction: (envKey: String, isPrimary: Bool)? {
        if let primaryEnv = self.skill.primaryEnv, self.missingEnv.contains(primaryEnv) {
            return (primaryEnv, true)
        }
        guard let envKey = self.missingEnv.first else { return nil }
        return (envKey, false)
    }

    private var trailingActions: some View {
        VStack(alignment: .trailing, spacing: 8) {
            if let installTitle = self.presentation.installActionTitle {
                self.installAction(title: installTitle)
            } else if self.presentation.showsToggle {
                Toggle("", isOn: self.enabledBinding)
                    .toggleStyle(.switch)
                    .labelsHidden()
                    .disabled(self.isBusy || !self.requirementsMet || !self.isInteractive)
            }

            if let envAction = self.nextEnvAction,
               let envActionTitle = self.presentation.envActionTitle
            {
                Button(envActionTitle) {
                    self.onSetEnv(envAction.envKey, envAction.isPrimary)
                }
                .buttonStyle(.bordered)
                .disabled(self.isBusy || !self.isInteractive)
            } else if let guideTitle = self.presentation.guideActionTitle,
                      let homepageUrl = self.homepageUrl
            {
                Link(guideTitle, destination: homepageUrl)
                    .buttonStyle(.link)
            }
        }
    }

    private var installOptions: [SkillInstallOption] {
        guard !self.missingBins.isEmpty else { return [] }
        let missing = Set(self.missingBins)
        return self.skill.install.filter { option in
            if option.bins.isEmpty { return true }
            return !missing.isDisjoint(with: option.bins)
        }
    }

    private var requirementsMet: Bool {
        self.missingBins.isEmpty && self.missingEnv.isEmpty && self.missingConfig.isEmpty
    }

    private var currentInstallTarget: InstallTarget {
        self.connectionMode == .remote ? .gateway : .local
    }

    @ViewBuilder
    private func installAction(title: String) -> some View {
        if self.installOptions.count == 1, let option = self.installOptions.first {
            VStack(alignment: .trailing, spacing: 8) {
                Button(title) {
                    self.onInstall(option, self.currentInstallTarget)
                }
                .buttonStyle(.borderedProminent)
                .disabled(self.isBusy || !self.isInteractive)

                if let switchTitle = self.presentation.switchToLocalActionTitle {
                    Button(switchTitle) {
                        self.onSwitchToLocal()
                    }
                    .buttonStyle(.bordered)
                    .disabled(self.isBusy)
                }
            }
        } else {
            Menu(title) {
                ForEach(self.installOptions, id: \.id) { option in
                    Button(option.label) {
                        self.onInstall(option, self.currentInstallTarget)
                    }
                }
            }
            .disabled(self.isBusy || !self.isInteractive)

            if let switchTitle = self.presentation.switchToLocalActionTitle {
                Button(switchTitle) {
                    self.onSwitchToLocal()
                }
                .buttonStyle(.bordered)
                .disabled(self.isBusy)
            }
        }
    }
}

private struct InlineMessage: View {
    let message: String
    let tone: CapabilityNoticeTone
    var showsProgress = false

    var body: some View {
        HStack(spacing: 6) {
            if self.showsProgress {
                ProgressView()
                    .controlSize(.small)
            } else if let iconName = self.tone.iconName {
                Image(systemName: iconName)
                    .font(.caption)
                    .foregroundStyle(self.tone.color)
            }
            Text(self.message)
                .font(.caption)
                .foregroundStyle(self.tone.color)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct CapabilityStatusTag: View {
    let status: CapabilityRowStatus

    var body: some View {
        Text(self.status.title)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(self.status.color.opacity(0.14))
            .foregroundStyle(self.status.color)
            .clipShape(Capsule())
    }
}

private struct EnvEditorState: Identifiable {
    let skillKey: String
    let skillName: String
    let envKey: String
    let isPrimary: Bool
    let homepage: String?

    var id: String {
        "\(self.skillKey)::\(self.envKey)"
    }
}

private struct EnvEditorView: View {
    let editor: EnvEditorState
    let onSave: (String) async -> CapabilityNotice
    @Environment(\.dismiss) private var dismiss
    @State private var value: String = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(self.title)
                .font(.headline)
            Text(self.subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if let homepageUrl = self.homepageUrl {
                Link("Open setup guide", destination: homepageUrl)
                    .font(.caption)
            }
            if let errorMessage {
                InlineMessage(message: errorMessage, tone: .error)
            }
            SecureField(self.fieldTitle, text: self.$value)
                .textFieldStyle(.roundedBorder)
            HStack {
                Button("Cancel") { self.dismiss() }
                    .disabled(self.isSaving)
                Spacer()
                Button("Save") {
                    Task { await self.save() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(self.isSaving || self.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 420)
    }

    private var homepageUrl: URL? {
        guard let raw = self.editor.homepage?.trimmingCharacters(in: .whitespacesAndNewlines) else {
            return nil
        }
        guard
            !raw.isEmpty,
            let url = URL(string: raw),
            let scheme = url.scheme?.lowercased(),
            scheme == "http" || scheme == "https"
        else {
            return nil
        }
        return url
    }

    private var title: String {
        self.editor.isPrimary ? "Add API key" : "Add required value"
    }

    private var subtitle: String {
        "Capability: \(self.editor.skillName)"
    }

    private var fieldTitle: String {
        self.editor.isPrimary ? "API key" : "Value"
    }

    private func save() async {
        let trimmed = self.value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        self.isSaving = true
        self.errorMessage = nil
        let result = await self.onSave(trimmed)
        self.isSaving = false
        if result.tone == .error {
            self.errorMessage = result.text
            return
        }
        self.dismiss()
    }
}

enum CapabilitiesAccountGate: Equatable, Sendable {
    case authenticated
    case signedOut
    case unavailable(String)
}

private enum CapabilityOperationKind: Equatable, Sendable {
    case install
    case toggle
    case save

    var label: String {
        switch self {
        case .install:
            "Installing…"
        case .toggle:
            "Updating…"
        case .save:
            "Saving…"
        }
    }
}

protocol CapabilitiesGatewayClient: Sendable {
    func skillsStatus() async throws -> SkillsStatusReport
    func skillsInstall(name: String, installId: String, timeoutMs: Int?) async throws -> SkillInstallResult
    func skillsUpdate(
        skillKey: String,
        enabled: Bool?,
        apiKey: String?,
        env: [String: String]?) async throws -> SkillUpdateResult
}

extension GatewayConnection: CapabilitiesGatewayClient {}

@MainActor
@Observable
final class CapabilitiesSettingsModel {
    static let signedOutMessage = "Sign in to view capabilities."
    static let emptyCapabilitiesMessage = "No capabilities are available right now."

    @ObservationIgnored
    private let gateway: any CapabilitiesGatewayClient
    @ObservationIgnored
    private let accountGateResolver: @Sendable (String) async -> CapabilitiesAccountGate

    var skills: [SkillStatus] = []
    var isLoading = false
    var hasLoadedOnce = false
    var error: String?
    var emptyMessage: String?
    var staleMessage: String?
    private var busyCapabilities: [String: CapabilityOperationKind] = [:]
    private var feedbackBySkill: [String: CapabilityNotice] = [:]

    init(
        gateway: any CapabilitiesGatewayClient = GatewayConnection.shared,
        accountGate: (@Sendable (String) async -> CapabilitiesAccountGate)? = nil)
    {
        self.gateway = gateway
        self.accountGateResolver = accountGate ?? { reason in
            await Self.defaultAccountGate(reason: reason)
        }
    }

    var canInteract: Bool {
        !self.skills.isEmpty && self.staleMessage == nil
    }

    func isBusy(skill: SkillStatus) -> Bool {
        self.busyCapabilities[skill.skillKey] != nil
    }

    func operationLabel(skill: SkillStatus) -> String? {
        self.busyCapabilities[skill.skillKey]?.label
    }

    func feedback(skill: SkillStatus) -> CapabilityNotice? {
        self.feedbackBySkill[skill.skillKey]
    }

    func refresh() async {
        guard !self.isLoading else { return }
        self.isLoading = true
        self.error = nil
        self.staleMessage = nil
        if self.skills.isEmpty {
            self.emptyMessage = nil
        }
        defer {
            self.isLoading = false
            self.hasLoadedOnce = true
        }

        switch await self.accountGateResolver("skills.status") {
        case .authenticated:
            break
        case .signedOut:
            self.skills = []
            self.feedbackBySkill.removeAll()
            self.emptyMessage = Self.signedOutMessage
            return
        case let .unavailable(message):
            self.applyRefreshFailure(
                Self.userFacingError(
                    message,
                    fallback: "Capabilities could not be loaded right now."))
            return
        }

        do {
            self.applyLoadedSkills(try await self.fetchSkills())
        } catch {
            self.applyRefreshFailure(
                Self.userFacingError(
                    error.localizedDescription,
                    fallback: "Capabilities could not be loaded right now."))
        }
    }

    @discardableResult
    fileprivate func install(
        skill: SkillStatus,
        option: SkillInstallOption,
        target: InstallTarget) async -> CapabilityNotice
    {
        await self.withBusy(skill.skillKey, operation: .install) {
            if let blocked = await self.mutationGate(
                skillKey: skill.skillKey,
                reason: "skills.install",
                fallback: "Install failed.")
            {
                return blocked
            }

            if target == .local, AppStateStore.shared.connectionMode != .local {
                return self.setFeedback(
                    skillKey: skill.skillKey,
                    notice: CapabilityNotice(
                        text: "Switch to This Mac before installing here.",
                        tone: .error))
            }

            do {
                let result = try await self.gateway.skillsInstall(
                    name: skill.name,
                    installId: option.id,
                    timeoutMs: 300_000)

                if !result.ok {
                    _ = await self.refreshAfterMutation(skillKey: skill.skillKey)
                    return self.setFeedback(
                        skillKey: skill.skillKey,
                        notice: CapabilityNotice(
                            text: Self.userFacingOperationMessage(
                                result.message,
                                fallback: "Install failed."),
                            tone: .error))
                }

                guard let refreshedSkill = await self.refreshAfterMutation(skillKey: skill.skillKey) else {
                    return self.setFeedback(
                        skillKey: skill.skillKey,
                        notice: CapabilityNotice(
                            text: "Install finished, but the current state could not be confirmed.",
                            tone: .error))
                }

                let requestedBins = Set(option.bins)
                if !requestedBins.isEmpty,
                   !requestedBins.isDisjoint(with: refreshedSkill.missing.bins)
                {
                    return self.setFeedback(
                        skillKey: skill.skillKey,
                        notice: CapabilityNotice(
                            text: "Install finished, but this capability still needs software.",
                            tone: .error))
                }

                let notice = refreshedSkill.eligible
                    ? CapabilityNotice(text: "Installed.", tone: .success)
                    : CapabilityNotice(text: "Installed. More setup is still required.", tone: .warning)
                return self.setFeedback(skillKey: skill.skillKey, notice: notice)
            } catch {
                return self.setFeedback(
                    skillKey: skill.skillKey,
                    notice: CapabilityNotice(
                        text: Self.userFacingError(
                            error.localizedDescription,
                            fallback: "Install failed."),
                        tone: .error))
            }
        }
    }

    @discardableResult
    func setEnabled(skillKey: String, enabled: Bool) async -> CapabilityNotice {
        await self.withBusy(skillKey, operation: .toggle) {
            if let blocked = await self.mutationGate(
                skillKey: skillKey,
                reason: "skills.update",
                fallback: "Capability update failed.")
            {
                return blocked
            }

            do {
                _ = try await self.gateway.skillsUpdate(
                    skillKey: skillKey,
                    enabled: enabled,
                    apiKey: nil,
                    env: nil)

                guard let refreshedSkill = await self.refreshAfterMutation(skillKey: skillKey) else {
                    return self.setFeedback(
                        skillKey: skillKey,
                        notice: CapabilityNotice(
                            text: "The new state could not be confirmed.",
                            tone: .error))
                }

                guard refreshedSkill.disabled == !enabled else {
                    return self.setFeedback(
                        skillKey: skillKey,
                        notice: CapabilityNotice(
                            text: "The new state could not be confirmed.",
                            tone: .error))
                }

                return self.setFeedback(
                    skillKey: skillKey,
                    notice: CapabilityNotice(
                        text: enabled ? "Enabled." : "Disabled.",
                        tone: .success))
            } catch {
                return self.setFeedback(
                    skillKey: skillKey,
                    notice: CapabilityNotice(
                        text: Self.userFacingError(
                            error.localizedDescription,
                            fallback: "Capability update failed."),
                        tone: .error))
            }
        }
    }

    @discardableResult
    func updateEnv(skillKey: String, envKey: String, value: String, isPrimary: Bool) async -> CapabilityNotice {
        await self.withBusy(skillKey, operation: .save) {
            if let blocked = await self.mutationGate(
                skillKey: skillKey,
                reason: "skills.update",
                fallback: "Capability setup failed.")
            {
                return blocked
            }

            do {
                if isPrimary {
                    _ = try await self.gateway.skillsUpdate(
                        skillKey: skillKey,
                        enabled: nil,
                        apiKey: value,
                        env: nil)
                } else {
                    _ = try await self.gateway.skillsUpdate(
                        skillKey: skillKey,
                        enabled: nil,
                        apiKey: nil,
                        env: [envKey: value])
                }

                guard let refreshedSkill = await self.refreshAfterMutation(skillKey: skillKey) else {
                    return self.setFeedback(
                        skillKey: skillKey,
                        notice: CapabilityNotice(
                            text: "The saved value could not be confirmed.",
                            tone: .error))
                }

                if refreshedSkill.missing.env.contains(envKey) {
                    return self.setFeedback(
                        skillKey: skillKey,
                        notice: CapabilityNotice(
                            text: "The saved value is still missing.",
                            tone: .error))
                }

                let notice = refreshedSkill.eligible
                    ? CapabilityNotice(
                        text: isPrimary ? "API key saved." : "Value saved.",
                        tone: .success)
                    : CapabilityNotice(
                        text: "Saved. More setup is still required.",
                        tone: .warning)
                return self.setFeedback(skillKey: skillKey, notice: notice)
            } catch {
                return self.setFeedback(
                    skillKey: skillKey,
                    notice: CapabilityNotice(
                        text: Self.userFacingError(
                            error.localizedDescription,
                            fallback: "Capability setup failed."),
                        tone: .error))
            }
        }
    }

    private func fetchSkills() async throws -> [SkillStatus] {
        let report = try await self.gateway.skillsStatus()
        return report.skills.sorted { $0.name < $1.name }
    }

    private func applyLoadedSkills(_ skills: [SkillStatus]) {
        self.skills = skills
        self.error = nil
        self.staleMessage = nil
        self.emptyMessage = skills.isEmpty ? Self.emptyCapabilitiesMessage : nil
    }

    private func applyRefreshFailure(_ message: String) {
        if self.skills.isEmpty {
            self.error = message
            self.emptyMessage = nil
        } else {
            self.error = nil
            self.staleMessage = message
        }
    }

    private func skill(skillKey: String) -> SkillStatus? {
        self.skills.first(where: { $0.skillKey == skillKey })
    }

    private func refreshAfterMutation(skillKey: String) async -> SkillStatus? {
        do {
            let refreshedSkills = try await self.fetchSkills()
            self.applyLoadedSkills(refreshedSkills)
            return self.skill(skillKey: skillKey)
        } catch {
            self.staleMessage = Self.userFacingError(
                error.localizedDescription,
                fallback: "Capabilities could not be refreshed right now.")
            return self.skill(skillKey: skillKey)
        }
    }

    private func mutationGate(
        skillKey: String,
        reason: String,
        fallback: String) async -> CapabilityNotice?
    {
        self.error = nil
        self.staleMessage = nil
        self.feedbackBySkill.removeValue(forKey: skillKey)

        switch await self.accountGateResolver(reason) {
        case .authenticated:
            return nil
        case .signedOut:
            return self.setFeedback(
                skillKey: skillKey,
                notice: CapabilityNotice(
                    text: "Sign in to change capabilities.",
                    tone: .error))
        case let .unavailable(message):
            return self.setFeedback(
                skillKey: skillKey,
                notice: CapabilityNotice(
                    text: Self.userFacingError(message, fallback: fallback),
                    tone: .error))
        }
    }

    private func setFeedback(skillKey: String, notice: CapabilityNotice) -> CapabilityNotice {
        self.feedbackBySkill[skillKey] = notice
        return notice
    }

    private static func userFacingOperationMessage(_ raw: String?, fallback: String) -> String {
        let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else { return fallback }

        let lower = trimmed.lowercased()
        if lower.contains("sign in") ||
            lower.contains("timeout") ||
            lower.contains("disconnected") ||
            lower.contains("cannot reach gateway") ||
            lower.contains("cannot connect") ||
            lower.contains("connection refused") ||
            lower.contains("network")
        {
            return Self.userFacingError(trimmed, fallback: fallback)
        }
        return fallback
    }

    private static func userFacingError(_ raw: String?, fallback: String) -> String {
        let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else { return fallback }

        let lower = trimmed.lowercased()
        if lower.contains("sign in") {
            return trimmed
        }
        if lower.contains("timeout") {
            return "Capabilities are taking longer than expected to update."
        }
        if lower.contains("disconnected") ||
            lower.contains("cannot reach gateway") ||
            lower.contains("cannot connect") ||
            lower.contains("connection refused") ||
            lower.contains("network")
        {
            return "Capabilities are unavailable because Alisio is not connected right now."
        }
        return trimmed
    }

    private static func defaultAccountGate(reason: String) async -> CapabilitiesAccountGate {
        do {
            _ = try await AlisioAccountStore.shared.requireAuthenticated(reason: reason)
            return .authenticated
        } catch let error as AlisioAccountRequiredError {
            switch error {
            case .signedOut:
                return .signedOut
            case let .unavailable(message):
                return .unavailable(message)
            }
        } catch {
            return .unavailable(error.localizedDescription)
        }
    }

    private func withBusy<T>(
        _ id: String,
        operation: CapabilityOperationKind,
        _ work: @escaping () async -> T) async -> T
    {
        self.busyCapabilities[id] = operation
        defer { self.busyCapabilities.removeValue(forKey: id) }
        return await work()
    }
}

#if DEBUG
struct CapabilitiesSettings_Previews: PreviewProvider {
    static var previews: some View {
        CapabilitiesSettings(state: .preview)
            .frame(width: SettingsTab.windowWidth, height: SettingsTab.windowHeight)
    }
}

extension CapabilitiesSettings {
    mutating func setFilterForTesting(_ rawValue: String) {
        guard let filter = CapabilitiesFilter(rawValue: rawValue) else { return }
        self.filter = filter
    }

    func listStateForTesting(_ rawValue: String) -> ListState {
        guard let filter = CapabilitiesFilter(rawValue: rawValue) else {
            return self.listState
        }
        return self.listState(for: filter)
    }
}
#endif
