import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
@MainActor
struct WorkspaceNavigationStateTests {
    @Test func `chat route stores a non empty session key`() {
        let state = WorkspaceNavigationState()
        state.showChat(sessionKey: "  team/main  ")

        #expect(state.route == .chat)
        #expect(state.activeSessionKey == "team/main")
    }

    @Test func `chat route ignores blank session keys`() {
        let state = WorkspaceNavigationState()
        state.showChat(sessionKey: "main")
        state.showChat(sessionKey: "   ")

        #expect(state.route == .chat)
        #expect(state.activeSessionKey == "main")
    }

    @Test func `workspace starts on the native chat route`() {
        let state = WorkspaceNavigationState()

        #expect(state.route == .chat)
    }

    @Test func `workspace routes expose the canonical shell tabs`() {
        #expect(WorkspaceNavigationState.Route.allCases.map(\.rawValue) == [
            "chat",
            "memory",
            "apps",
            "schedules",
            "capabilities",
            "connections",
            "settings",
        ])
    }

    @Test func `workspace routes expose the canonical shell metadata`() {
        let metadata = WorkspaceNavigationState.Route.allCases.map {
            (
                $0.rawValue,
                $0.workspaceTitle,
                $0.systemImage,
                $0.showsStageHeader,
                $0.stageMarkerIdentifier
            )
        }

        #expect(metadata.map { $0.0 } == [
            "chat",
            "memory",
            "apps",
            "schedules",
            "capabilities",
            "connections",
            "settings",
        ])
        #expect(metadata.map { $0.1 } == [
            "Chat",
            "Memory",
            "Apps",
            "Schedules",
            "Capabilities",
            "Connections",
            "Settings",
        ])
        #expect(metadata.map { $0.2 } == [
            "bubble.left.and.bubble.right",
            "brain.head.profile",
            "link",
            "calendar",
            "sparkles",
            "network",
            "gearshape",
        ])
        #expect(metadata.map { $0.3 } == [false, true, true, true, true, true, true])
        #expect(metadata.map { $0.4 } == [
            "workspace-route-chat",
            "workspace-route-memory",
            "workspace-route-apps",
            "workspace-route-schedules",
            "workspace-route-capabilities",
            "workspace-route-connections",
            "workspace-route-settings",
        ])
        #expect(Set(metadata.map { $0.1 }).count == metadata.count)
        #expect(Set(metadata.map { $0.4 }).count == metadata.count)
    }

    @Test func `route apply follows the canonical workspace routing contract`() {
        let state = WorkspaceNavigationState()
        state.showChat(sessionKey: " team/main ")

        for route in WorkspaceNavigationState.Route.allCases {
            route.apply(to: state)
            #expect(state.route == route)
        }

        #expect(state.activeSessionKey == "team/main")
    }

    @Test func `settings route is a single native launcher surface`() {
        let state = WorkspaceNavigationState()

        state.showSettings()
        #expect(state.route == .settings)
    }

    @Test func `settings route copy makes the native boundary explicit`() {
        #expect(
            WorkspaceNavigationState.Route.settings.workspaceSubtitle
                == "Open the native Settings window for app setup and preferences.")
    }
}
