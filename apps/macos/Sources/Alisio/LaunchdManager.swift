import Foundation

import AlisioSupport
enum LaunchdManager {
    private static func runLaunchctl(_ args: [String]) {
        let process = Process()
        process.launchPath = "/bin/launchctl"
        process.arguments = args
        try? process.run()
    }

    static func startAlisio() {
        let userTarget = "gui/\(getuid())/\(launchdLabel)"
        self.runLaunchctl(["kickstart", "-k", userTarget])
    }

    static func stopAlisio() {
        let userTarget = "gui/\(getuid())/\(launchdLabel)"
        self.runLaunchctl(["stop", userTarget])
    }
}
