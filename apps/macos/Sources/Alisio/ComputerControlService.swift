import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
@preconcurrency import ScreenCaptureKit

@MainActor
final class ComputerControlService {
    private let jpegCompression: CGFloat = 0.72

    func observe() async throws -> MacNodeComputerObservePayload {
        try self.ensureScreenRecording()
        let snapshot = try await self.captureSnapshot()
        let frame = try self.buildFrame(snapshot: snapshot)
        let context = self.buildContext(snapshot: snapshot)
        return MacNodeComputerObservePayload(frame: frame, context: context)
    }

    func perform(action: MacNodeComputerActionPayload) async throws -> MacNodeComputerActPayload {
        try self.ensureAccessibility()
        let summary = try await self.execute(action: action)
        let observation = try await self.observe()
        return MacNodeComputerActPayload(ok: true, summary: summary, observation: observation)
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
        return MacNodeComputerObservePayload.Frame(
            dataUrl: dataUrl,
            mimeType: "image/jpeg",
            width: snapshot.image.width,
            height: snapshot.image.height,
            capturedAt: snapshot.capturedAtMs,
            cursor: cursor)
    }

    private func buildContext(snapshot: Snapshot) -> MacNodeComputerObservePayload.Context {
        let scale = max(1.0, snapshot.screen.backingScaleFactor)
        let app = NSWorkspace.shared.frontmostApplication
        return MacNodeComputerObservePayload.Context(
            display: .init(
                id: String(snapshot.displayId),
                width: snapshot.screen.frame.width * scale,
                height: snapshot.screen.frame.height * scale,
                scale: scale),
            activeApp: .init(
                name: app?.localizedName,
                bundleId: app?.bundleIdentifier,
                processId: app?.processIdentifier),
            activeWindow: .init(title: self.activeWindowTitle(for: app)),
            errorState: nil,
            capturedAt: snapshot.capturedAtMs)
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

    private func execute(action: MacNodeComputerActionPayload) async throws -> String {
        switch action.type {
        case "click":
            try self.click(action: action, button: .left, count: 1)
            return self.summarizePointAction("click", action: action)
        case "double_click":
            try self.click(action: action, button: .left, count: 2)
            return self.summarizePointAction("double click", action: action)
        case "right_click":
            try self.click(action: action, button: .right, count: 1)
            return self.summarizePointAction("right click", action: action)
        case "drag":
            try await self.drag(action: action)
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
            let delayMs = max(0, action.delayMs ?? 0)
            if delayMs > 0 {
                try await Task.sleep(nanoseconds: UInt64(delayMs) * 1_000_000)
            }
            return "Waited"
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
            let path = try self.requirePath(action.path)
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
            return "Revealed path"
        case "open_path":
            let path = try self.requirePath(action.path)
            NSWorkspace.shared.open(URL(fileURLWithPath: path))
            return "Opened path"
        case "app_focus":
            let app = action.app?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !app.isEmpty else {
                throw NSError(
                    domain: "ComputerControl",
                    code: 6,
                    userInfo: [NSLocalizedDescriptionKey: "INVALID_REQUEST: app required"])
            }
            try await self.focusApplication(named: app)
            return "Focused app"
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

    private func summarizePointAction(_ label: String, action: MacNodeComputerActionPayload) -> String {
        let x = Int((action.x ?? 0).rounded())
        let y = Int((action.y ?? 0).rounded())
        return "\(label.capitalized) at (\(x), \(y))"
    }

    private func click(
        action: MacNodeComputerActionPayload,
        button: CGMouseButton,
        count: Int)
        throws
    {
        let point = try self.eventPoint(x: action.x, y: action.y)
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

    private func drag(action: MacNodeComputerActionPayload) async throws {
        let start = try self.eventPoint(x: action.x, y: action.y)
        let end = try self.eventPoint(x: action.toX, y: action.toY)
        self.postMouseMove(to: start)
        try self.postMouseEvent(type: .leftMouseDown, point: start, button: .left, clickState: 1)
        let steps = 12
        for step in 1...steps {
            let progress = Double(step) / Double(steps)
            let point = CGPoint(
                x: start.x + ((end.x - start.x) * progress),
                y: start.y + ((end.y - start.y) * progress))
            try self.postMouseEvent(type: .leftMouseDragged, point: point, button: .left, clickState: 1)
            try await Task.sleep(nanoseconds: 12_000_000)
        }
        try self.postMouseEvent(type: .leftMouseUp, point: end, button: .left, clickState: 1)
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

    private func eventPoint(x: Double?, y: Double?) throws -> CGPoint {
        guard let x, let y else {
            throw NSError(
                domain: "ComputerControl",
                code: 11,
                userInfo: [NSLocalizedDescriptionKey: "INVALID_REQUEST: x/y required"])
        }
        let screen = try self.resolveActiveScreen()
        let scale = max(1.0, screen.backingScaleFactor)
        return CGPoint(
            x: screen.frame.minX + (x / scale),
            y: screen.frame.maxY - (y / scale))
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

        let appURL =
            NSWorkspace.shared.urlForApplication(withBundleIdentifier: app)
            ?? NSWorkspace.shared.fullPath(forApplication: app).map { URL(fileURLWithPath: $0) }
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
}
