import Foundation

import AlisioSupport
final class CanvasFileWatcher: @unchecked Sendable, SimpleFileWatcherOwner {
    let watcher: SimpleFileWatcher

    init(url: URL, onChange: @escaping () -> Void) {
        self.watcher = SimpleFileWatcher(CoalescingFSEventsWatcher(
            paths: [url.path],
            queueLabel: AlisioBrand.subsystem("canvaswatcher"),
            onChange: onChange))
    }
}
