import Foundation

extension OnboardingView {
    func loadWorkspaceDefaults() async {
        guard self.workspacePath.isEmpty else { return }
        let configured = await self.loadAgentWorkspace()
        let url = AgentWorkspace.resolveWorkspaceURL(from: configured)
        self.workspacePath = AgentWorkspace.displayPath(for: url)
    }

    func ensureDefaultWorkspace() async {
        guard self.state.connectionMode == .local else { return }
        let configured = await self.loadAgentWorkspace()
        let url = AgentWorkspace.resolveWorkspaceURL(from: configured)
        let safety = AgentWorkspace.bootstrapSafety(for: url)
        guard safety.unsafeReason == nil else { return }
        do {
            _ = try AgentWorkspace.bootstrap(workspaceURL: url)
            if (configured ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                await self.saveAgentWorkspace(AgentWorkspace.displayPath(for: url))
            }
        } catch {
            return
        }
    }

    private func loadAgentWorkspace() async -> String? {
        let root = await ConfigStore.load()
        return AgentWorkspaceConfig.workspace(from: root)
    }

    @discardableResult
    func saveAgentWorkspace(_ workspace: String?) async -> Bool {
        let (success, _) = await OnboardingView.buildAndSaveWorkspace(workspace)
        return success
    }

    @MainActor
    private static func buildAndSaveWorkspace(_ workspace: String?) async -> (Bool, String?) {
        var root = await ConfigStore.load()
        AgentWorkspaceConfig.setWorkspace(in: &root, workspace: workspace)
        do {
            try await ConfigStore.save(root)
            return (true, nil)
        } catch {
            let errorMessage = "Failed to save config: \(error.localizedDescription)"
            return (false, errorMessage)
        }
    }
}
