import Foundation

import AlisioSupport
@MainActor
enum AlisioWorkspaceURL {
    struct Deps {
        let ensureLocalGatewayReady: @Sendable (_ timeout: TimeInterval) async throws -> Void
        let requireConfig: @Sendable () async throws -> GatewayConnection.Config

        static let live = Deps(
            ensureLocalGatewayReady: { timeout in
                try await GatewayProcessManager.shared.ensureLocalGatewayReady(timeout: timeout)
            },
            requireConfig: {
                try await GatewayEndpointStore.shared.requireConfig()
            })
    }

    static func resolve(
        shellState: AlisioShellState,
        appState: AppState,
        deps: Deps = .live) async throws -> URL
    {
        if appState.connectionMode == .local {
            try await deps.ensureLocalGatewayReady(12)
        }

        let config = try await deps.requireConfig()
        let dashboardURL = try GatewayEndpointStore.dashboardURL(for: config, mode: appState.connectionMode)
        guard var components = URLComponents(url: dashboardURL, resolvingAgainstBaseURL: false) else {
            throw NSError(domain: "AlisioWorkspaceURL", code: 1, userInfo: [
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
