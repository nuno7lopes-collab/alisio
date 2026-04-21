import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
@preconcurrency import ScreenCaptureKit

@MainActor
final class ComputerControlService {
    private let jpegCompression: CGFloat = 0.72
    private let frameMaxAgeMs = MacNodeComputerActionEngine.defaultFrameMaxAgeMs

    func captureFrame() async throws -> MacNodeComputerObservePayload {
        try self.ensureScreenRecording()
        let snapshot = try await self.captureSnapshot()
        let frame = try self.buildFrame(snapshot: snapshot)
        let context = self.buildContext(snapshot: snapshot)
        return MacNodeComputerObservePayload(frame: frame, context: context)
    }

    func getContext() throws -> MacNodeComputerObservePayload.Context {
        let snapshot = try self.captureContextSnapshot()
        return self.buildContext(snapshot: snapshot)
    }

    func getPermissionState() -> MacNodeComputerPermissionPayload {
        MacNodeComputerPermissionPayload(
            accessibility: AXIsProcessTrusted(),
            screenRecording: ScreenRecordingProbe.isAuthorized())
    }

    func performActions(_ actions: [MacNodeComputerActionPayload]) async throws -> MacNodeComputerPerformActionsPayload {
        guard !actions.isEmpty else {
            throw NSError(
                domain: "ComputerControl",
                code: 20,
                userInfo: [NSLocalizedDescriptionKey: "INVALID_REQUEST: actions required"])
        }
        try self.ensureAccessibility()
        var lastSummary = "Completed actions"
        var results: [MacNodeComputerActionResultPayload] = []
        var lastActionAtMs: Int?
        for action in actions {
            if let lastActionAtMs {
                let elapsedSinceLast = self.nowMs() - lastActionAtMs
                if elapsedSinceLast < MacNodeComputerActionEngine.minimumInterActionDelayMs {
                    try await self.sleepMs(MacNodeComputerActionEngine.minimumInterActionDelayMs - elapsedSinceLast)
                }
            }
            let startedAt = self.nowMs()
            let validation = MacNodeComputerActionEngine.validateAction(
                action,
                sessionFrame: nil,
                nowMs: startedAt)
            switch validation {
            case let .failure(failure):
                let elapsed = max(0, self.nowMs() - startedAt)
                let result = self.makeFailureResult(
                    from: failure,
                    elapsedMs: elapsed)
                results.append(result)
                lastSummary = result.summary
                return MacNodeComputerPerformActionsPayload(
                    ok: false,
                    summary: lastSummary,
                    results: results)
            case let .success(validatedAction):
                do {
                    lastSummary = try await self.execute(
                        action: action,
                        validatedAction: validatedAction)
                    let elapsed = max(0, self.nowMs() - startedAt)
                    results.append(MacNodeComputerActionResultPayload(
                        id: UUID().uuidString,
                        actionId: validatedAction.actionId,
                        type: validatedAction.normalizedType,
                        success: true,
                        elapsedMs: elapsed,
                        retryCount: 0,
                        summary: lastSummary,
                        failureCategory: nil,
                        sourceFrameId: validatedAction.sourceFrame?.frameId,
                        resultFrameId: nil))
                    lastActionAtMs = self.nowMs()
                } catch {
                    let elapsed = max(0, self.nowMs() - startedAt)
                    let result = self.makeFailureResult(
                        action: action,
                        validatedAction: validatedAction,
                        error: error,
                        elapsedMs: elapsed)
                    results.append(result)
                    lastSummary = result.summary
                    return MacNodeComputerPerformActionsPayload(
                        ok: false,
                        summary: lastSummary,
                        results: results)
                }
            }
        }
        return MacNodeComputerPerformActionsPayload(
            ok: results.allSatisfy(\.success),
            summary: lastSummary,
            results: results)
    }

    private func ensureScreenRecording() throws {
        let granted = ScreenRecordingProbe.isAuthorized()
        guard granted else {
            throw NSError(
                domain: "ComputerControl",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "PERMISSION_MISSING: screenRecording"])
        }
    }

    private func ensureAccessibility() throws {
        let granted = AXIsProcessTrusted()
        guard granted else {
            throw NSError(
                domain: "ComputerControl",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "PERMISSION_MISSING: accessibility"])
        }
    }

    private struct Snapshot {
        var displayId: CGDirectDisplayID
        var image: CGImage
        var screen: NSScreen
        var capturedAtMs: Int
    }

    private struct ContextSnapshot {
        var displayId: CGDirectDisplayID
        var screen: NSScreen
        var capturedAtMs: Int
    }

    private func nowMs() -> Int {
        Int(Date().timeIntervalSince1970 * 1000)
    }

    private func sleepMs(_ delayMs: Int) async throws {
        guard delayMs > 0 else { return }
        try await Task.sleep(nanoseconds: UInt64(delayMs) * 1_000_000)
    }

    private func captureSnapshot() async throws -> Snapshot {
        let screen = try self.resolveActiveScreen()
        let displayId = self.displayId(for: screen)
        let image = try await self.captureDisplayImage(displayId: displayId, screen: screen)
        return Snapshot(
            displayId: displayId,
            image: image,
            screen: screen,
            capturedAtMs: Int(Date().timeIntervalSince1970 * 1000))
    }

    private func captureContextSnapshot() throws -> ContextSnapshot {
        let screen = try self.resolveActiveScreen()
        return ContextSnapshot(
            displayId: self.displayId(for: screen),
            screen: screen,
            capturedAtMs: Int(Date().timeIntervalSince1970 * 1000))
    }

    private func captureDisplayImage(
        displayId: CGDirectDisplayID,
        screen: NSScreen) async throws -> CGImage
    {
        let content = try await SCShareableContent.current
        guard let display = content.displays.first(where: { $0.displayID == displayId }) else {
            throw NSError(
                domain: "ComputerControl",
                code: 17,
                userInfo: [NSLocalizedDescriptionKey: "DISPLAY_NOT_SHAREABLE"])
        }
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        let scale = max(1.0, screen.backingScaleFactor)
        config.width = Int(screen.frame.width * scale)
        config.height = Int(screen.frame.height * scale)
        config.showsCursor = true
        return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
    }

    private func resolveActiveScreen() throws -> NSScreen {
        let mouse = NSEvent.mouseLocation
        if let screen = NSScreen.screens.first(where: { $0.frame.contains(mouse) }) {
            return screen
        }
        if let main = NSScreen.main {
            return main
        }
        if let fallback = NSScreen.screens.first {
            return fallback
        }
        throw NSError(
            domain: "ComputerControl",
            code: 15,
            userInfo: [NSLocalizedDescriptionKey: "DISPLAY_UNAVAILABLE"])
    }

    private func displayId(for screen: NSScreen) -> CGDirectDisplayID {
        if let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber {
            return CGDirectDisplayID(number.uint32Value)
        }
        return CGMainDisplayID()
    }

    private func resolveScreen(forDisplayId rawDisplayId: String?) throws -> NSScreen {
        if let rawDisplayId,
           let displayNumber = UInt32(rawDisplayId),
           let screen = NSScreen.screens.first(where: {
               self.displayId(for: $0) == CGDirectDisplayID(displayNumber)
           })
        {
            return screen
        }
        return try self.resolveActiveScreen()
    }

    private func displayOrientation(
        displayId: CGDirectDisplayID,
        screen: NSScreen) -> MacNodeComputerOrientation
    {
        let rotation = Int(CGDisplayRotation(displayId).rounded())
        let isPortraitRotation = abs(rotation) == 90 || abs(rotation) == 270
        let logicalWidth = screen.frame.width
        let logicalHeight = screen.frame.height
        let isPortrait = isPortraitRotation ? logicalWidth >= logicalHeight : logicalHeight > logicalWidth
        return isPortrait ? .portrait : .landscape
    }

    private func buildFrame(snapshot: Snapshot) throws -> MacNodeComputerObservePayload.Frame {
        let bitmap = NSBitmapImageRep(cgImage: snapshot.image)
        guard let data = bitmap.representation(
            using: .jpeg,
            properties: [.compressionFactor: self.jpegCompression]) else
        {
            throw NSError(
                domain: "ComputerControl",
                code: 4,
                userInfo: [NSLocalizedDescriptionKey: "DISPLAY_ENCODE_FAILED"])
        }

        let dataUrl = "data:image/jpeg;base64," + data.base64EncodedString()
        let cursor = self.currentCursor(for: snapshot)
        let scaleFactor = max(1.0, snapshot.screen.backingScaleFactor)
        let logicalWidth = snapshot.screen.frame.width
        let logicalHeight = snapshot.screen.frame.height
        let orientation = self.displayOrientation(
            displayId: snapshot.displayId,
            screen: snapshot.screen)
        return MacNodeComputerObservePayload.Frame(
            id: UUID().uuidString,
            dataUrl: dataUrl,
            mimeType: "image/jpeg",
            width: snapshot.image.width,
            height: snapshot.image.height,
            pixelWidth: snapshot.image.width,
            pixelHeight: snapshot.image.height,
            logicalWidth: logicalWidth,
            logicalHeight: logicalHeight,
            scaleFactor: scaleFactor,
            orientation: orientation,
            displayId: String(snapshot.displayId),
            sourceSpace: .displayPixel,
            capturedAt: snapshot.capturedAtMs,
            maxAgeMs: self.frameMaxAgeMs,
            staleAt: snapshot.capturedAtMs + self.frameMaxAgeMs,
            cursor: cursor)
    }

    private func buildContext(snapshot: Snapshot) -> MacNodeComputerObservePayload.Context {
        self.buildContext(
            displayId: snapshot.displayId,
            screen: snapshot.screen,
            capturedAtMs: snapshot.capturedAtMs)
    }

    private func buildContext(snapshot: ContextSnapshot) -> MacNodeComputerObservePayload.Context {
        self.buildContext(
            displayId: snapshot.displayId,
            screen: snapshot.screen,
            capturedAtMs: snapshot.capturedAtMs)
    }

    private func buildContext(
        displayId: CGDirectDisplayID,
        screen: NSScreen,
        capturedAtMs: Int) -> MacNodeComputerObservePayload.Context
    {
        let scale = max(1.0, screen.backingScaleFactor)
        let app = NSWorkspace.shared.frontmostApplication
        let logicalWidth = screen.frame.width
        let logicalHeight = screen.frame.height
        let pixelWidth = logicalWidth * scale
        let pixelHeight = logicalHeight * scale
        let orientation = self.displayOrientation(displayId: displayId, screen: screen)
        return MacNodeComputerObservePayload.Context(
            display: .init(
                id: String(displayId),
                width: pixelWidth,
                height: pixelHeight,
                scale: scale,
                logicalWidth: logicalWidth,
                logicalHeight: logicalHeight,
                pixelWidth: pixelWidth,
                pixelHeight: pixelHeight,
                orientation: orientation),
            activeApp: .init(
                name: app?.localizedName,
                bundleId: app?.bundleIdentifier,
                processId: app?.processIdentifier),
            activeWindow: .init(title: self.activeWindowTitle(for: app)),
            errorState: nil,
            capturedAt: capturedAtMs)
    }

    private func currentCursor(for snapshot: Snapshot) -> MacNodeComputerObservePayload.Frame.Cursor? {
        let mouse = NSEvent.mouseLocation
        guard snapshot.screen.frame.contains(mouse) else { return nil }
        let scale = max(1.0, snapshot.screen.backingScaleFactor)
        let localX = (mouse.x - snapshot.screen.frame.minX) * scale
        let localY = (snapshot.screen.frame.maxY - mouse.y) * scale
        return .init(x: localX, y: localY, visible: true)
    }

    private func activeWindowTitle(for app: NSRunningApplication?) -> String? {
        guard AXIsProcessTrusted(),
              let processId = app?.processIdentifier
        else {
            return nil
        }
        let element = AXUIElementCreateApplication(processId)
        var focusedWindow: CFTypeRef?
        let windowStatus = AXUIElementCopyAttributeValue(
            element,
            kAXFocusedWindowAttribute as CFString,
            &focusedWindow)
        guard windowStatus == .success,
              let window = focusedWindow
        else {
            return nil
        }
        var titleValue: CFTypeRef?
        let titleStatus = AXUIElementCopyAttributeValue(
            window as! AXUIElement,
            kAXTitleAttribute as CFString,
            &titleValue)
        guard titleStatus == .success else {
            return nil
        }
        return titleValue as? String
    }

    private func execute(
        action: MacNodeComputerActionPayload,
        validatedAction: MacNodeComputerValidatedAction) async throws -> String
    {
        switch validatedAction.normalizedType {
        case "move":
            let point = try self.requireGlobalPoint(for: validatedAction)
            self.postMouseMove(to: point)
            return self.summarizePointAction("move", point: validatedAction.point)
        case "click":
            let point = try self.requireGlobalPoint(for: validatedAction)
            try self.click(at: point, button: .left, count: 1)
            return self.summarizePointAction("click", point: validatedAction.point)
        case "double_click":
            let point = try self.requireGlobalPoint(for: validatedAction)
            try self.click(at: point, button: .left, count: 2)
            return self.summarizePointAction("double click", point: validatedAction.point)
        case "right_click":
            let point = try self.requireGlobalPoint(for: validatedAction)
            try self.click(at: point, button: .right, count: 1)
            return self.summarizePointAction("right click", point: validatedAction.point)
        case "drag":
            try await self.drag(validatedAction: validatedAction)
            return "Dragged pointer"
        case "scroll":
            try self.scroll(action: action)
            return "Scrolled active surface"
        case "type":
            try self.typeText(action.text ?? "")
            return "Typed text"
        case "keypress":
            try self.pressKey(action: action)
            return "Pressed key"
        case "wait":
            try await self.sleepMs(max(0, action.delayMs ?? 0))
            return "Waited"
        case "screenshot":
            return "Captured screenshot"
        case "open_url":
            let raw = action.url?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard let url = URL(string: raw), !raw.isEmpty else {
                throw NSError(
                    domain: "ComputerControl",
                    code: 5,
                    userInfo: [NSLocalizedDescriptionKey: "INVALID_REQUEST: url required"])
            }
            NSWorkspace.shared.open(url)
            return "Opened URL"
        case "reveal_path":
            let path = try self.requireExistingPath(action.path)
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
            return "Revealed path"
        case "open_path":
            let path = try self.requireExistingPath(action.path)
            NSWorkspace.shared.open(URL(fileURLWithPath: path))
            return "Opened path"
        case "focus_app":
            let app = try self.requireAppName(action.app)
            try await self.focusApplication(named: app)
            return "Focused app"
        case "open_app":
            let app = try self.requireAppName(action.app)
            try await self.openApplication(named: app)
            return "Opened app"
        default:
            throw NSError(
                domain: "ComputerControl",
                code: 7,
                userInfo: [NSLocalizedDescriptionKey: "INVALID_REQUEST: unsupported computer action"])
        }
    }

    private func requirePath(_ raw: String?) throws -> String {
        let path = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if path.isEmpty {
            throw NSError(
                domain: "ComputerControl",
                code: 16,
                userInfo: [NSLocalizedDescriptionKey: "INVALID_REQUEST: path required"])
        }
        return path
    }

    private func requireExistingPath(_ raw: String?) throws -> String {
        let path = try self.requirePath(raw)
        guard FileManager.default.fileExists(atPath: path) else {
            throw NSError(
                domain: "ComputerControl",
                code: 21,
                userInfo: [NSLocalizedDescriptionKey: "INVALID_TARGET: path not found"])
        }
        return path
    }

    private func requireAppName(_ raw: String?) throws -> String {
        let app = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !app.isEmpty else {
            throw NSError(
                domain: "ComputerControl",
                code: 6,
                userInfo: [NSLocalizedDescriptionKey: "INVALID_REQUEST: app required"])
        }
        return app
    }

    private func summarizePointAction(_ label: String, point: CGPoint?) -> String {
        let x = Int((point?.x ?? 0).rounded())
        let y = Int((point?.y ?? 0).rounded())
        return "\(label.capitalized) at (\(x), \(y))"
    }

    private func requireGlobalPoint(for validatedAction: MacNodeComputerValidatedAction) throws -> CGPoint {
        guard let localPoint = validatedAction.point,
              let sourceFrame = validatedAction.sourceFrame
        else {
            throw NSError(
                domain: "ComputerControl",
                code: 22,
                userInfo: [NSLocalizedDescriptionKey: "INVALID_TARGET: point unavailable"])
        }
        let display = try self.displayDescriptor(for: sourceFrame)
        return MacNodeComputerActionEngine.resolveGlobalPoint(
            localPixelPoint: localPoint,
            display: display)
    }

    private func displayDescriptor(for sourceFrame: MacNodeComputerFrameReference) throws -> MacNodeComputerDisplayDescriptor {
        let screen = try self.resolveScreen(forDisplayId: sourceFrame.displayId)
        return MacNodeComputerDisplayDescriptor(
            displayId: sourceFrame.displayId,
            logicalFrame: screen.frame,
            scaleFactor: max(1.0, screen.backingScaleFactor))
    }

    private func click(at point: CGPoint, button: CGMouseButton, count: Int) throws {
        let downType: CGEventType = button == .right ? .rightMouseDown : .leftMouseDown
        let upType: CGEventType = button == .right ? .rightMouseUp : .leftMouseUp
        self.postMouseMove(to: point)
        for index in 0..<count {
            try self.postMouseEvent(type: downType, point: point, button: button, clickState: index + 1)
            try self.postMouseEvent(type: upType, point: point, button: button, clickState: index + 1)
            if count > 1 {
                Thread.sleep(forTimeInterval: 0.04)
            }
        }
    }

    private func drag(validatedAction: MacNodeComputerValidatedAction) async throws {
        guard let sourceFrame = validatedAction.sourceFrame,
              let localStart = validatedAction.point,
              let localEnd = validatedAction.toPoint
        else {
            throw NSError(
                domain: "ComputerControl",
                code: 23,
                userInfo: [NSLocalizedDescriptionKey: "INVALID_TARGET: drag points unavailable"])
        }
        let display = try self.displayDescriptor(for: sourceFrame)
        let start = MacNodeComputerActionEngine.resolveGlobalPoint(
            localPixelPoint: localStart,
            display: display)
        let end = MacNodeComputerActionEngine.resolveGlobalPoint(
            localPixelPoint: localEnd,
            display: display)
        try await MacNodeComputerActionEngine.runDrag(
            from: start,
            to: end,
            moveMouse: { point in
                self.postMouseMove(to: point)
            },
            postMouseDown: { point in
                try self.postMouseEvent(type: .leftMouseDown, point: point, button: .left, clickState: 1)
            },
            postMouseDragged: { point in
                try self.postMouseEvent(type: .leftMouseDragged, point: point, button: .left, clickState: 1)
            },
            postMouseUp: { point in
                try self.postMouseEvent(type: .leftMouseUp, point: point, button: .left, clickState: 1)
            },
            sleep: { delayMs in
                try await self.sleepMs(delayMs)
            })
    }

    private func scroll(action: MacNodeComputerActionPayload) throws {
        let deltaY = Int32((action.deltaY ?? 0).rounded())
        let deltaX = Int32((action.deltaX ?? 0).rounded())
        guard let event = CGEvent(
            scrollWheelEvent2Source: nil,
            units: .line,
            wheelCount: 2,
            wheel1: deltaY,
            wheel2: deltaX,
            wheel3: 0)
        else {
            throw NSError(
                domain: "ComputerControl",
                code: 8,
                userInfo: [NSLocalizedDescriptionKey: "SCROLL_EVENT_FAILED"])
        }
        event.post(tap: .cghidEventTap)
    }

    private func typeText(_ text: String) throws {
        guard !text.isEmpty else { return }
        for scalar in text.unicodeScalars {
            try self.postUnicodeKey(String(scalar), flags: [])
        }
    }

    private func pressKey(action: MacNodeComputerActionPayload) throws {
        let key = action.key?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        guard !key.isEmpty else {
            throw NSError(
                domain: "ComputerControl",
                code: 9,
                userInfo: [NSLocalizedDescriptionKey: "INVALID_REQUEST: key required"])
        }
        let flags = self.flags(from: action.modifiers ?? [])
        if let keyCode = self.keyCode(for: key) {
            try self.postKeyCode(keyCode, flags: flags)
            return
        }
        if key.count == 1 {
            try self.postUnicodeKey(key, flags: flags)
            return
        }
        throw NSError(
            domain: "ComputerControl",
            code: 10,
            userInfo: [NSLocalizedDescriptionKey: "INVALID_REQUEST: unsupported key \(key)"])
    }

    private func postMouseMove(to point: CGPoint) {
        let move = CGEvent(
            mouseEventSource: nil,
            mouseType: .mouseMoved,
            mouseCursorPosition: point,
            mouseButton: .left)
        move?.post(tap: .cghidEventTap)
    }

    private func postMouseEvent(
        type: CGEventType,
        point: CGPoint,
        button: CGMouseButton,
        clickState: Int)
        throws
    {
        guard let event = CGEvent(
            mouseEventSource: nil,
            mouseType: type,
            mouseCursorPosition: point,
            mouseButton: button)
        else {
            throw NSError(
                domain: "ComputerControl",
                code: 12,
                userInfo: [NSLocalizedDescriptionKey: "MOUSE_EVENT_FAILED"])
        }
        event.setIntegerValueField(.mouseEventClickState, value: Int64(clickState))
        event.post(tap: .cghidEventTap)
    }

    private func flags(from modifiers: [String]) -> CGEventFlags {
        modifiers.reduce(into: CGEventFlags()) { flags, modifier in
            switch modifier.lowercased() {
            case "command":
                flags.insert(.maskCommand)
            case "shift":
                flags.insert(.maskShift)
            case "option":
                flags.insert(.maskAlternate)
            case "control":
                flags.insert(.maskControl)
            default:
                break
            }
        }
    }

    private func keyCode(for key: String) -> CGKeyCode? {
        switch key {
        case "enter", "return": 36
        case "tab": 48
        case "space": 49
        case "escape", "esc": 53
        case "delete", "backspace": 51
        case "up": 126
        case "down": 125
        case "left": 123
        case "right": 124
        case "home": 115
        case "end": 119
        case "pageup": 116
        case "pagedown": 121
        default: nil
        }
    }

    private func postKeyCode(_ keyCode: CGKeyCode, flags: CGEventFlags) throws {
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false)
        else
        {
            throw NSError(
                domain: "ComputerControl",
                code: 13,
                userInfo: [NSLocalizedDescriptionKey: "KEY_EVENT_FAILED"])
        }
        down.flags = flags
        up.flags = flags
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }

    private func postUnicodeKey(_ text: String, flags: CGEventFlags) throws {
        let chars = Array(text.utf16)
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
        else
        {
            throw NSError(
                domain: "ComputerControl",
                code: 14,
                userInfo: [NSLocalizedDescriptionKey: "UNICODE_EVENT_FAILED"])
        }
        down.flags = flags
        up.flags = flags
        down.keyboardSetUnicodeString(stringLength: chars.count, unicodeString: chars)
        up.keyboardSetUnicodeString(stringLength: chars.count, unicodeString: chars)
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }

    private func makeFailureResult(
        from failure: MacNodeComputerActionResultPayload,
        elapsedMs: Int) -> MacNodeComputerActionResultPayload
    {
        MacNodeComputerActionResultPayload(
            id: failure.id,
            actionId: failure.actionId,
            type: failure.type,
            success: false,
            elapsedMs: max(failure.elapsedMs, elapsedMs),
            retryCount: failure.retryCount,
            summary: failure.summary,
            failureCategory: failure.failureCategory,
            sourceFrameId: failure.sourceFrameId,
            resultFrameId: nil)
    }

    private func makeFailureResult(
        action: MacNodeComputerActionPayload,
        validatedAction: MacNodeComputerValidatedAction,
        error: Error,
        elapsedMs: Int) -> MacNodeComputerActionResultPayload
    {
        let category = self.failureCategory(for: error)
        return MacNodeComputerActionResultPayload(
            id: UUID().uuidString,
            actionId: validatedAction.actionId,
            type: validatedAction.normalizedType,
            success: false,
            elapsedMs: elapsedMs,
            retryCount: 0,
            summary: error.localizedDescription,
            failureCategory: category,
            sourceFrameId: validatedAction.sourceFrame?.frameId ?? action.frame?.frameId,
            resultFrameId: nil)
    }

    private func failureCategory(for error: Error) -> MacNodeComputerActionFailureCategory {
        if error is CancellationError {
            return .cancelled
        }
        let message = error.localizedDescription
        if message.hasPrefix("PERMISSION_MISSING:") {
            return .permissionMissing
        }
        if message.hasPrefix("INVALID_TARGET:") || message.hasPrefix("APP_NOT_FOUND:") || message.hasPrefix("DISPLAY_UNAVAILABLE") {
            return .invalidTarget
        }
        if message.hasPrefix("INVALID_REQUEST:") {
            return .validation
        }
        return .executionFailed
    }

    private func resolveApplicationURL(named app: String) -> URL? {
        let trimmed = app.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return nil
        }

        let fileURL = URL(fileURLWithPath: NSString(string: trimmed).expandingTildeInPath)
        if fileURL.pathExtension.caseInsensitiveCompare("app") == .orderedSame,
           FileManager.default.fileExists(atPath: fileURL.path)
        {
            return fileURL.standardizedFileURL
        }

        if let runningURL = NSWorkspace.shared.runningApplications
            .first(where: {
                $0.localizedName?.caseInsensitiveCompare(trimmed) == .orderedSame
                    || $0.bundleIdentifier?.caseInsensitiveCompare(trimmed) == .orderedSame
            })?
            .bundleURL
        {
            return runningURL
        }

        if let bundleURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: trimmed) {
            return bundleURL
        }

        let candidateName = trimmed.hasSuffix(".app") ? trimmed : "\(trimmed).app"
        for directory in self.applicationLookupDirectories() {
            let candidateURL = directory.appendingPathComponent(candidateName, isDirectory: true)
            if FileManager.default.fileExists(atPath: candidateURL.path) {
                return candidateURL
            }
        }

        return nil
    }

    private func applicationLookupDirectories() -> [URL] {
        let knownDirectories = [
            "/Applications",
            "/Applications/Utilities",
            "/System/Applications",
            "/System/Applications/Utilities",
            "/System/Library/CoreServices",
            FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications", isDirectory: true).path,
        ]

        var seen: Set<String> = []
        return knownDirectories.compactMap { rawPath in
            let url = URL(fileURLWithPath: rawPath, isDirectory: true).standardizedFileURL
            guard seen.insert(url.path).inserted else {
                return nil
            }
            return url
        }
    }

    private func focusApplication(named app: String) async throws {
        if let running = NSWorkspace.shared.runningApplications.first(where: {
            $0.localizedName?.caseInsensitiveCompare(app) == .orderedSame
                || $0.bundleIdentifier?.caseInsensitiveCompare(app) == .orderedSame
        }) {
            let activated = running.activate(options: [.activateAllWindows])
            if activated {
                return
            }
        }

        let appURL = self.resolveApplicationURL(named: app)
        guard let appURL else {
            throw NSError(
                domain: "ComputerControl",
                code: 18,
                userInfo: [NSLocalizedDescriptionKey: "APP_NOT_FOUND: \(app)"])
        }

        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            NSWorkspace.shared.openApplication(at: appURL, configuration: configuration) { runningApp, error in
                if let error {
                    cont.resume(throwing: error)
                    return
                }
                guard runningApp != nil else {
                    cont.resume(throwing: NSError(
                        domain: "ComputerControl",
                        code: 19,
                        userInfo: [NSLocalizedDescriptionKey: "APP_OPEN_FAILED: \(app)"]))
                    return
                }
                cont.resume()
            }
        }
    }

    private func openApplication(named app: String) async throws {
        let appURL = self.resolveApplicationURL(named: app)
        guard let appURL else {
            throw NSError(
                domain: "ComputerControl",
                code: 24,
                userInfo: [NSLocalizedDescriptionKey: "APP_NOT_FOUND: \(app)"])
        }

        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            NSWorkspace.shared.openApplication(at: appURL, configuration: configuration) { runningApp, error in
                if let error {
                    cont.resume(throwing: error)
                    return
                }
                guard runningApp != nil else {
                    cont.resume(throwing: NSError(
                        domain: "ComputerControl",
                        code: 25,
                        userInfo: [NSLocalizedDescriptionKey: "APP_OPEN_FAILED: \(app)"]))
                    return
                }
                cont.resume()
            }
        }
    }
}
