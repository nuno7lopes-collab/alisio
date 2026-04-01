import Foundation

@MainActor
enum LumeWorkspaceURL {
    static func resolve(shellState: LumeShellState, appState: AppState) async throws -> URL {
        precondition(shellState.route != .onboarding, "Onboarding is hosted natively")

        let config = try await GatewayEndpointStore.shared.requireConfig()
        let dashboardURL = try GatewayEndpointStore.dashboardURL(for: config, mode: appState.connectionMode)
        guard var components = URLComponents(url: dashboardURL, resolvingAgainstBaseURL: false) else {
            throw NSError(domain: "LumeWorkspaceURL", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Failed to resolve workspace URL",
            ])
        }

        let workspacePath = shellState.workspacePath()
        let routeComponents = URLComponents(string: workspacePath)
        let routePath = routeComponents?.path.isEmpty == false ? routeComponents?.path ?? "/home" : "/home"
        components.path = self.merge(basePath: components.path, routePath: routePath)
        components.queryItems = routeComponents?.queryItems
        return components.url ?? dashboardURL
    }

    private static func merge(basePath: String, routePath: String) -> String {
        let normalizedRoute = routePath.hasPrefix("/") ? routePath : "/" + routePath
        let trimmedBase = basePath == "/" ? "" : basePath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if trimmedBase.isEmpty {
            return normalizedRoute
        }
        return "/\(trimmedBase)\(normalizedRoute)"
    }
}
