import Testing
@testable import Alisio

struct WorkspaceInspectorVisibilityTests {
    @Test func `auto presentation opens and closes with live activity`() {
        var state = WorkspaceInspectorVisibilityState()

        #expect(state.isVisible(supportsInspector: true, autoPresent: false) == false)
        #expect(state.isVisible(supportsInspector: true, autoPresent: true) == true)

        state.sync(autoPresent: false)

        #expect(state.isVisible(supportsInspector: true, autoPresent: false) == false)
    }

    @Test func `manual dismissal stays in effect until auto presentation ends`() {
        var state = WorkspaceInspectorVisibilityState()

        state.hide(autoPresent: true)

        #expect(state.isVisible(supportsInspector: true, autoPresent: true) == false)

        state.sync(autoPresent: false)

        #expect(state.isVisible(supportsInspector: true, autoPresent: false) == false)
        #expect(state.isVisible(supportsInspector: true, autoPresent: true) == true)
    }

    @Test func `manual show pins the inspector until the user hides it`() {
        var state = WorkspaceInspectorVisibilityState()

        state.show()

        #expect(state.isVisible(supportsInspector: true, autoPresent: false) == true)

        state.hide(autoPresent: false)

        #expect(state.isVisible(supportsInspector: true, autoPresent: false) == false)
    }
}
