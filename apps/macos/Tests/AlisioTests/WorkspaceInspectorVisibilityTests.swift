import Testing
@testable import Alisio

struct WorkspaceInspectorVisibilityTests {
    @Test func `inspector stays hidden until the user opens it`() {
        let state = WorkspaceInspectorVisibilityState()

        #expect(state.isVisible(supportsInspector: true) == false)
    }

    @Test func `manual show pins the inspector until the user hides it`() {
        var state = WorkspaceInspectorVisibilityState()

        state.show()

        #expect(state.isVisible(supportsInspector: true) == true)
    }

    @Test func `hide closes the pinned inspector`() {
        var state = WorkspaceInspectorVisibilityState()

        state.show()
        state.hide()

        #expect(state.isVisible(supportsInspector: true) == false)
    }
}
