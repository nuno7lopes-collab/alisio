import Foundation
import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
@MainActor
struct CapabilitiesSettingsStateTests {
    private func makeSkill(
        name: String = "Calendar",
        disabled: Bool = false,
        eligible: Bool = true,
        primaryEnv: String? = nil,
        homepage: String? = nil,
        missingBins: [String] = [],
        missingEnv: [String] = [],
        missingConfig: [String] = [],
        install: [SkillInstallOption] = []) -> SkillStatus
    {
        SkillStatus(
            name: name,
            description: "Calendar helper",
            source: "alisio-bundled",
            filePath: "/tmp/\(name)/SKILL.md",
            baseDir: "/tmp/\(name)",
            skillKey: name.lowercased(),
            primaryEnv: primaryEnv,
            emoji: nil,
            homepage: homepage,
            always: false,
            disabled: disabled,
            eligible: eligible,
            requirements: SkillRequirements(
                bins: missingBins,
                env: missingEnv,
                config: missingConfig),
            missing: SkillMissing(
                bins: missingBins,
                env: missingEnv,
                config: missingConfig),
            configChecks: [],
            install: install)
    }

    private func makeReport(_ skills: [SkillStatus]) -> SkillsStatusReport {
        SkillsStatusReport(
            workspaceDir: "/tmp/workspace",
            managedSkillsDir: "/tmp/managed",
            skills: skills)
    }

    @Test func `capabilities starts in loading state before the first refresh`() {
        let model = CapabilitiesSettingsModel()
        let view = CapabilitiesSettings(state: AppState(preview: true), model: model)

        #expect(view.listState == .loading)
    }

    @Test func `capabilities exposes empty and error states honestly`() {
        let model = CapabilitiesSettingsModel()
        model.hasLoadedOnce = true
        model.emptyMessage = CapabilitiesSettingsModel.emptyCapabilitiesMessage
        let view = CapabilitiesSettings(state: AppState(preview: true), model: model)
        #expect(view.listState == .empty("No capabilities are available right now."))

        model.error = "Gateway offline"
        #expect(view.listState == .error("Gateway offline"))
    }

    @Test func `capabilities keep the last known list visible while surfacing refresh issues`() {
        let model = CapabilitiesSettingsModel()
        model.hasLoadedOnce = true
        model.skills = [self.makeSkill()]
        model.staleMessage = "Capabilities are unavailable because Alisio is not connected right now."

        let view = CapabilitiesSettings(state: AppState(preview: true), model: model)

        #expect(view.listState == .list)
    }

    @Test func `capabilities filter exposes filtered empty state`() {
        let model = CapabilitiesSettingsModel()
        model.hasLoadedOnce = true
        model.skills = [self.makeSkill(disabled: false, eligible: true)]

        let view = CapabilitiesSettings(state: AppState(preview: true), model: model)
        #expect(view.listStateForTesting("disabled") == .filteredEmpty)
    }

    @Test func `capability presentation stays human and hides config keys`() {
        let primary = CapabilityRowPresentation(
            skill: self.makeSkill(
                eligible: false,
                primaryEnv: "OPENAI_API_KEY",
                missingEnv: ["OPENAI_API_KEY"]),
            connectionMode: .local)

        #expect(primary.status == .needsSetup)
        #expect(primary.summary == "Add an API key to finish setup.")
        #expect(primary.envActionTitle == "Add API key")
        #expect(primary.summary.contains("OPENAI_API_KEY") == false)

        let config = CapabilityRowPresentation(
            skill: self.makeSkill(
                eligible: false,
                homepage: "https://example.com/setup",
                missingConfig: ["tools.providers.openai.apiKey"]),
            connectionMode: .local)

        #expect(config.summary == "More setup is still required before this can run.")
        #expect(config.guideActionTitle == "Open setup guide")
        #expect(config.summary.contains("tools.providers") == false)

        let install = CapabilityRowPresentation(
            skill: self.makeSkill(
                eligible: false,
                missingBins: ["ffmpeg"],
                install: [
                    SkillInstallOption(
                        id: "brew",
                        kind: "brew",
                        label: "Install with Homebrew",
                        bins: ["ffmpeg"]),
                ]),
            connectionMode: .remote)

        #expect(install.status == .needsInstall)
        #expect(install.installActionTitle == "Install on remote")
        #expect(install.switchToLocalActionTitle == "Use This Mac")
    }

    @Test func `enable only reports success after the refreshed state matches`() async {
        let initial = self.makeSkill(disabled: true)
        let refreshed = self.makeSkill(disabled: false)
        let gateway = RecordingCapabilitiesGatewayClient(statuses: [
            .success(self.makeReport([refreshed])),
        ])
        let model = CapabilitiesSettingsModel(
            gateway: gateway,
            accountGate: { _ in .authenticated })
        model.skills = [initial]
        model.hasLoadedOnce = true

        let notice = await model.setEnabled(skillKey: initial.skillKey, enabled: true)

        #expect(notice == CapabilityNotice(text: "Enabled.", tone: .success))
        #expect(model.skills.first?.disabled == false)
        let calls = await gateway.snapshotCalls()
        #expect(calls.statusFetches == 1)
        #expect(calls.updatedSkillKeys == [initial.skillKey])
    }

    @Test func `save env only succeeds after the missing value disappears`() async {
        let skill = self.makeSkill(
            eligible: false,
            primaryEnv: "OPENAI_API_KEY",
            missingEnv: ["OPENAI_API_KEY"])
        let gateway = RecordingCapabilitiesGatewayClient(statuses: [
            .success(self.makeReport([skill])),
        ])
        let model = CapabilitiesSettingsModel(
            gateway: gateway,
            accountGate: { _ in .authenticated })
        model.skills = [skill]
        model.hasLoadedOnce = true

        let notice = await model.updateEnv(
            skillKey: skill.skillKey,
            envKey: "OPENAI_API_KEY",
            value: "sk-test",
            isPrimary: true)

        #expect(notice == CapabilityNotice(text: "The saved value is still missing.", tone: .error))
        #expect(model.staleMessage == nil)
        let calls = await gateway.snapshotCalls()
        #expect(calls.savedAPIKeys == [skill.skillKey])
    }
}

private struct TestCapabilitiesError: LocalizedError {
    let message: String

    var errorDescription: String? {
        self.message
    }
}

private actor RecordingCapabilitiesGatewayClient: CapabilitiesGatewayClient {
    struct Calls: Equatable {
        var statusFetches = 0
        var updatedSkillKeys: [String] = []
        var savedAPIKeys: [String] = []
    }

    private var recordedCalls = Calls()
    private var queuedStatuses: [Result<SkillsStatusReport, Error>]
    private let installResult: SkillInstallResult

    init(
        statuses: [Result<SkillsStatusReport, Error>] = [],
        installResult: SkillInstallResult = SkillInstallResult(
            ok: true,
            message: "",
            stdout: nil,
            stderr: nil,
            code: nil))
    {
        self.queuedStatuses = statuses
        self.installResult = installResult
    }

    func skillsStatus() async throws -> SkillsStatusReport {
        self.recordedCalls.statusFetches += 1
        guard !self.queuedStatuses.isEmpty else {
            throw TestCapabilitiesError(message: "missing status response")
        }
        let next = self.queuedStatuses.removeFirst()
        switch next {
        case let .success(report):
            return report
        case let .failure(error):
            throw error
        }
    }

    func skillsInstall(name: String, installId: String, timeoutMs: Int?) async throws -> SkillInstallResult {
        self.installResult
    }

    func skillsUpdate(
        skillKey: String,
        enabled: Bool?,
        apiKey: String?,
        env: [String: String]?) async throws -> SkillUpdateResult
    {
        if enabled != nil {
            self.recordedCalls.updatedSkillKeys.append(skillKey)
        }
        if apiKey != nil || env != nil {
            self.recordedCalls.savedAPIKeys.append(skillKey)
        }
        return SkillUpdateResult(ok: true, skillKey: skillKey, config: nil)
    }

    func snapshotCalls() -> Calls {
        self.recordedCalls
    }
}
