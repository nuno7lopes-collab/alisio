import Foundation

struct WorkspaceInspectorVisibilityState {
    private(set) var isPinnedVisible = false

    mutating func show() {
        self.isPinnedVisible = true
    }

    mutating func hide() {
        self.isPinnedVisible = false
    }

    func isVisible(supportsInspector: Bool) -> Bool {
        supportsInspector && self.isPinnedVisible
    }
}
