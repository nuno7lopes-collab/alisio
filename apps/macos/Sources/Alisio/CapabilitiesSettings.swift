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
    @State private var model = CapabilitiesSettingsModel()
    @State private var envEditor: EnvEditorState?
    @State private var filter: CapabilitiesFilter = .all

    init(
        state: AppState = AppStateStore.shared,
        model: CapabilitiesSettingsModel = CapabilitiesSettingsModel())
    {
        self.state = state
        self._model = State(initialValue: model)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            self.header
            self.content
            Spacer(minLength: 0)
        }
        .task { await self.model.refresh() }
        .sheet(item: self.$envEditor) { editor in
            EnvEditorView(editor: editor) { value in
                Task {
                    await self.model.updateEnv(
                        skillKey: editor.skillKey,
                        envKey: editor.envKey,
                        value: value,
                        isPrimary: editor.isPrimary)
                }
            }
        }
    }

    private var trimmedError: String? {
        let trimmed = self.model.error?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private var trimmedStatusMessage: String? {
        let trimmed = self.model.statusMessage?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
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

        return .empty(self.trimmedStatusMessage ?? "No capabilities are available yet.")
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Capabilities")
                    .font(.headline)
                Text("See what is ready to use and what still needs setup.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if self.model.isLoading {
                ProgressView()
            } else {
                Button {
                    Task { await self.model.refresh() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .help("Refresh")
            }
            self.headerFilter
        }
    }

    @ViewBuilder
    private var content: some View {
        switch self.listState {
        case .loading:
            self.stateCard(
                title: "Loading capabilities…",
                message: "Checking what is available on this Mac.",
                systemImage: "sparkles",
                showsProgress: true)
        case let .error(message):
            self.stateCard(
                title: "Capabilities could not be loaded.",
                message: message,
                systemImage: "exclamationmark.triangle.fill",
                tint: .orange,
                actionTitle: "Try again")
            {
                Task { await self.model.refresh() }
            }
        case let .empty(message):
            if message.hasPrefix("Sign in") {
                self.stateCard(
                    title: message,
                    message: "After you sign in, the available capabilities appear here.",
                    systemImage: "person.crop.circle.badge.exclamationmark")
            } else {
                self.stateCard(
                    title: message,
                    message: "When capabilities are available, they appear here.",
                    systemImage: "sparkles")
            }
        case .filteredEmpty:
            self.stateCard(
                title: "No capabilities match this filter.",
                message: "Change the filter to see the remaining capabilities.",
                systemImage: "line.3.horizontal.decrease.circle")
        case .list:
            self.capabilitiesList
        }
    }

    private var capabilitiesList: some View {
        VStack(alignment: .leading, spacing: 8) {
            if self.model.isLoading {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Refreshing…")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            } else if let error = self.trimmedError {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let message = self.trimmedStatusMessage {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            List {
                ForEach(self.filteredCapabilities) { skill in
                    CapabilityRow(
                        skill: skill,
                        isBusy: self.model.isBusy(skill: skill),
                        connectionMode: self.state.connectionMode,
                        onToggleEnabled: { enabled in
                            Task { await self.model.setEnabled(skillKey: skill.skillKey, enabled: enabled) }
                        },
                        onInstall: { option, target in
                            Task { await self.model.install(skill: skill, option: option, target: target) }
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

private struct CapabilityRow: View {
    let skill: SkillStatus
    let isBusy: Bool
    let connectionMode: AppState.ConnectionMode
    let onToggleEnabled: (Bool) -> Void
    let onInstall: (SkillInstallOption, InstallTarget) -> Void
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

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(self.skill.emoji ?? "✨")
                .font(.title2)

            VStack(alignment: .leading, spacing: 6) {
                Text(self.skill.name)
                    .font(.headline)
                Text(self.skill.description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                self.metaRow

                if self.skill.disabled {
                    Text("Disabled in config")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else if !self.requirementsMet, self.shouldShowMissingSummary {
                    self.missingSummary
                }

                if !self.skill.configChecks.isEmpty {
                    self.configChecksView
                }

                if !self.missingEnv.isEmpty {
                    self.envActionRow
                }
            }

            Spacer(minLength: 0)

            self.trailingActions
        }
        .padding(.vertical, 6)
    }

    private var sourceLabel: String {
        switch self.skill.source {
        case "alisio-bundled":
            "Bundled"
        case "alisio-managed":
            "Managed"
        case "alisio-workspace":
            "Workspace"
        case "alisio-extra":
            "Extra"
        case "alisio-plugin":
            "Plugin"
        default:
            self.skill.source
        }
    }

    private var metaRow: some View {
        HStack(spacing: 10) {
            SkillTag(text: self.sourceLabel)
            if let url = self.homepageUrl {
                Link(destination: url) {
                    Label("Site", systemImage: "link")
                        .font(.caption2.weight(.semibold))
                }
                .buttonStyle(.link)
            }
            Spacer(minLength: 0)
        }
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

    private var missingSummary: some View {
        VStack(alignment: .leading, spacing: 4) {
            if self.shouldShowMissingBins {
                Text("Install required: \(self.missingBins.joined(separator: ", "))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if !self.missingEnv.isEmpty {
                Text("Configuration required: \(self.missingEnv.joined(separator: ", "))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if !self.missingConfig.isEmpty {
                Text("Additional config required: \(self.missingConfig.joined(separator: ", "))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var configChecksView: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(self.skill.configChecks) { check in
                HStack(spacing: 6) {
                    Image(systemName: check.satisfied ? "checkmark.circle" : "xmark.circle")
                        .foregroundStyle(check.satisfied ? .green : .secondary)
                    Text(check.path)
                        .font(.caption)
                    Text(self.formatConfigValue(check.value))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var envActionRow: some View {
        HStack(spacing: 8) {
            ForEach(self.missingEnv, id: \.self) { envKey in
                let isPrimary = envKey == self.skill.primaryEnv
                Button(isPrimary ? "Set API key" : "Set \(envKey)") {
                    self.onSetEnv(envKey, isPrimary)
                }
                .buttonStyle(.bordered)
                .disabled(self.isBusy)
            }
            Spacer(minLength: 0)
        }
    }

    private var trailingActions: some View {
        VStack(alignment: .trailing, spacing: 8) {
            if !self.installOptions.isEmpty {
                ForEach(self.installOptions, id: \.id) { (option: SkillInstallOption) in
                    HStack(spacing: 6) {
                        if self.showGatewayInstall {
                            Button("Install on Gateway") { self.onInstall(option, .gateway) }
                                .buttonStyle(.borderedProminent)
                                .disabled(self.isBusy)
                        }
                        if self.showGatewayInstall {
                            Button("Install on this Mac") { self.onInstall(option, .local) }
                                .buttonStyle(.bordered)
                                .disabled(self.isBusy)
                                .help(
                                    self.localInstallNeedsSwitch
                                        ? "Switch to Local mode to install on this Mac."
                                        : "")
                        } else {
                            Button("Install on this Mac") { self.onInstall(option, .local) }
                                .buttonStyle(.borderedProminent)
                                .disabled(self.isBusy)
                                .help(
                                    self.localInstallNeedsSwitch
                                        ? "Switch to Local mode to install on this Mac."
                                        : "")
                        }
                    }
                }
            } else {
                Toggle("", isOn: self.enabledBinding)
                    .toggleStyle(.switch)
                    .labelsHidden()
                    .disabled(self.isBusy || !self.requirementsMet)
            }

            if self.isBusy {
                ProgressView()
                    .controlSize(.small)
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

    private var shouldShowMissingBins: Bool {
        !self.missingBins.isEmpty && self.installOptions.isEmpty
    }

    private var shouldShowMissingSummary: Bool {
        self.shouldShowMissingBins ||
            !self.missingEnv.isEmpty ||
            !self.missingConfig.isEmpty
    }

    private var showGatewayInstall: Bool {
        self.connectionMode == .remote
    }

    private var localInstallNeedsSwitch: Bool {
        self.connectionMode != .local
    }

    private func formatConfigValue(_ value: AnyCodable?) -> String {
        guard let value else { return "" }
        switch value.value {
        case let bool as Bool:
            return bool ? "true" : "false"
        case let int as Int:
            return String(int)
        case let double as Double:
            return String(double)
        case let string as String:
            return string
        default:
            return ""
        }
    }
}

private struct SkillTag: View {
    let text: String

    var body: some View {
        Text(self.text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(Color.secondary.opacity(0.12))
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
    let onSave: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var value: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(self.title)
                .font(.headline)
            Text(self.subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if let homepageUrl = self.homepageUrl {
                Link("Open key page →", destination: homepageUrl)
                    .font(.caption)
            }
            SecureField(self.editor.envKey, text: self.$value)
                .textFieldStyle(.roundedBorder)
            HStack {
                Button("Cancel") { self.dismiss() }
                Spacer()
                Button("Save") {
                    self.onSave(self.value)
                    self.dismiss()
                }
                .buttonStyle(.borderedProminent)
                .disabled(self.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
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
        self.editor.isPrimary ? "Set API key" : "Set environment variable"
    }

    private var subtitle: String {
        "Capability: \(self.editor.skillName)"
    }
}

@MainActor
@Observable
final class CapabilitiesSettingsModel {
    private enum AccountGate {
        case authenticated
        case signedOut
        case unavailable(String)
    }

    var skills: [SkillStatus] = []
    var isLoading = false
    var hasLoadedOnce = false
    var error: String?
    var statusMessage: String?
    private var busyCapabilities: Set<String> = []

    func isBusy(skill: SkillStatus) -> Bool {
        self.busyCapabilities.contains(skill.skillKey)
    }

    func refresh() async {
        guard !self.isLoading else { return }
        self.isLoading = true
        self.error = nil
        self.statusMessage = nil
        defer {
            self.isLoading = false
            self.hasLoadedOnce = true
        }

        switch await self.accountGate(reason: "skills.status") {
        case .authenticated:
            break
        case .signedOut:
            self.skills = []
            self.statusMessage = "Sign in to view capabilities."
            return
        case let .unavailable(message):
            self.skills = []
            self.statusMessage = nil
            self.error = message
            return
        }

        do {
            let report = try await GatewayConnection.shared.skillsStatus()
            self.skills = report.skills.sorted { $0.name < $1.name }
            if self.skills.isEmpty {
                self.statusMessage = "No capabilities are available yet."
            }
        } catch {
            self.statusMessage = nil
            self.error = error.localizedDescription
        }
    }

    fileprivate func install(skill: SkillStatus, option: SkillInstallOption, target: InstallTarget) async {
        await self.withBusy(skill.skillKey) {
            switch await self.accountGate(reason: "skills.install") {
            case .authenticated:
                break
            case .signedOut:
                self.statusMessage = "Sign in to change capabilities."
                return
            case let .unavailable(message):
                self.statusMessage = nil
                self.error = message
                return
            }

            do {
                self.error = nil
                if target == .local, AppStateStore.shared.connectionMode != .local {
                    AppStateStore.shared.connectionMode = .local
                }
                let result = try await GatewayConnection.shared.skillsInstall(
                    name: skill.name,
                    installId: option.id,
                    timeoutMs: 300_000)
                let trimmedMessage = result.message.trimmingCharacters(in: .whitespacesAndNewlines)
                let successMessage = result.ok
                    ? "Install completed."
                    : (trimmedMessage.isEmpty ? "The install failed." : trimmedMessage)
                await self.refresh()
                if self.error == nil {
                    self.statusMessage = successMessage
                }
            } catch {
                self.statusMessage = nil
                self.error = error.localizedDescription
            }
        }
    }

    func setEnabled(skillKey: String, enabled: Bool) async {
        await self.withBusy(skillKey) {
            switch await self.accountGate(reason: "skills.update") {
            case .authenticated:
                break
            case .signedOut:
                self.statusMessage = "Sign in to change capabilities."
                return
            case let .unavailable(message):
                self.statusMessage = nil
                self.error = message
                return
            }

            do {
                self.error = nil
                _ = try await GatewayConnection.shared.skillsUpdate(
                    skillKey: skillKey,
                    enabled: enabled)
                let successMessage = enabled ? "Capability enabled." : "Capability disabled."
                await self.refresh()
                if self.error == nil {
                    self.statusMessage = successMessage
                }
            } catch {
                self.statusMessage = nil
                self.error = error.localizedDescription
            }
        }
    }

    func updateEnv(skillKey: String, envKey: String, value: String, isPrimary: Bool) async {
        await self.withBusy(skillKey) {
            switch await self.accountGate(reason: "skills.update") {
            case .authenticated:
                break
            case .signedOut:
                self.statusMessage = "Sign in to change capabilities."
                return
            case let .unavailable(message):
                self.statusMessage = nil
                self.error = message
                return
            }

            do {
                self.error = nil
                if isPrimary {
                    _ = try await GatewayConnection.shared.skillsUpdate(
                        skillKey: skillKey,
                        apiKey: value)
                    let successMessage = "API key saved."
                    await self.refresh()
                    if self.error == nil {
                        self.statusMessage = successMessage
                    }
                } else {
                    _ = try await GatewayConnection.shared.skillsUpdate(
                        skillKey: skillKey,
                        env: [envKey: value])
                    let successMessage = "\(envKey) saved."
                    await self.refresh()
                    if self.error == nil {
                        self.statusMessage = successMessage
                    }
                }
            } catch {
                self.statusMessage = nil
                self.error = error.localizedDescription
            }
        }
    }

    private func accountGate(reason: String) async -> AccountGate {
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

    private func withBusy(_ id: String, _ work: @escaping () async -> Void) async {
        self.busyCapabilities.insert(id)
        defer { self.busyCapabilities.remove(id) }
        await work()
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
