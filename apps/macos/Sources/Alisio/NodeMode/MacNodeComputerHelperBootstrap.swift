import AppKit
import Darwin
import Foundation

enum MacNodeComputerHelperBootstrap {
    static var isHelperProcess: Bool {
        CommandLine.arguments.contains(MacNodeComputerHelperSettings.helperFlag)
    }
}

enum MacNodeComputerHelperProcessRunner {
    static func runAndExit() async -> Never {
        MacNodeComputerHelperLogger.log(.info, event: "helper.start")
        let server = MacNodeComputerHelperServer()

        do {
            for try await line in FileHandle.standardInput.bytes.lines {
                let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                if trimmed.isEmpty {
                    continue
                }
                guard let handled = await server.handleLine(trimmed) else {
                    continue
                }
                try FileHandle.standardOutput.write(contentsOf: Data((handled.responseLine + "\n").utf8))
                if handled.shouldExit {
                    MacNodeComputerHelperLogger.log(.info, event: "helper.stop", metadata: ["reason": "kill"])
                    Darwin.exit(0)
                }
            }
            MacNodeComputerHelperLogger.log(.info, event: "helper.stop", metadata: ["reason": "stdin-eof"])
            Darwin.exit(0)
        } catch {
            MacNodeComputerHelperLogger.log(
                .error,
                event: "helper.stop",
                metadata: ["reason": "stdin-error", "message": error.localizedDescription])
            Darwin.exit(1)
        }
    }
}
