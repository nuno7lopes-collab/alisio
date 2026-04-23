import Foundation

struct WorkspaceInspectorVisibilityState {
    private(set) var isPinnedVisible = false
    private(set) var dismissedCurrentAutoPresentation = false

    mutating func show() {
        self.isPinnedVisible = true
        self.dismissedCurrentAutoPresentation = false
    }

    mutating func hide(autoPresent: Bool) {
        self.isPinnedVisible = false
        self.dismissedCurrentAutoPresentation = autoPresent
    }

    mutating func sync(autoPresent: Bool) {
        guard !autoPresent else { return }
        self.dismissedCurrentAutoPresentation = false
    }

    func isVisible(supportsInspector: Bool, autoPresent: Bool) -> Bool {
        guard supportsInspector else { return false }
        return self.isPinnedVisible || (autoPresent && !self.dismissedCurrentAutoPresentation)
    }
}
