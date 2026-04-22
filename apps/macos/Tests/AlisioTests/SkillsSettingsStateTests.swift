import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
@MainActor
struct SkillsSettingsStateTests {
    private func makeSkill(
        name: String = "Calendar",
        disabled: Bool = false,
        eligible: Bool = true) -> SkillStatus
    {
        SkillStatus(
            name: name,
            description: "Calendar helper",
            source: "alisio-bundled",
            filePath: "/tmp/\(name)/SKILL.md",
            baseDir: "/tmp/\(name)",
            skillKey: name.lowercased(),
            primaryEnv: nil,
            emoji: nil,
            homepage: nil,
            always: false,
            disabled: disabled,
            eligible: eligible,
            requirements: SkillRequirements(bins: [], env: [], config: []),
            missing: SkillMissing(bins: [], env: [], config: []),
            configChecks: [],
            install: [])
    }

    @Test func `capabilities starts in loading state before the first refresh`() {
        let model = SkillsSettingsModel()
        let view = SkillsSettings(state: AppState(preview: true), model: model)

        #expect(view.listState == .loading)
    }

    @Test func `capabilities exposes empty and error states honestly`() {
        let model = SkillsSettingsModel()
        model.hasLoadedOnce = true
        model.statusMessage = "No capabilities are available yet."
        let view = SkillsSettings(state: AppState(preview: true), model: model)
        #expect(view.listState == .empty("No capabilities are available yet."))

        model.error = "Gateway offline"
        #expect(view.listState == .error("Gateway offline"))
    }

    @Test func `capabilities filter exposes filtered empty state`() {
        let model = SkillsSettingsModel()
        model.hasLoadedOnce = true
        model.skills = [self.makeSkill(disabled: false, eligible: true)]

        let view = SkillsSettings(state: AppState(preview: true), model: model)
        #expect(view.listStateForTesting("disabled") == .filteredEmpty)
    }
}
