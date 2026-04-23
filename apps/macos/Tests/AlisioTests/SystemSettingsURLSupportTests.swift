import Foundation
import Testing
@testable import Alisio

struct SystemSettingsURLSupportTests {
    @Test func `open first skips invalid candidates and returns first successful url`() {
        var attempted: [String] = []
        let opened = SystemSettingsURLSupport.openFirst([
            "not a url",
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
            "x-apple.systempreferences:com.apple.preference.security",
        ]) { url in
            attempted.append(url.absoluteString)
            return url.absoluteString.hasSuffix("com.apple.preference.security")
        }

        #expect(attempted == [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
            "x-apple.systempreferences:com.apple.preference.security",
        ])
        #expect(opened?.absoluteString == "x-apple.systempreferences:com.apple.preference.security")
    }

    @Test func `open first returns nil when no candidate opens`() {
        let opened = SystemSettingsURLSupport.openFirst([
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
            "x-apple.systempreferences:com.apple.preference.security",
        ]) { _ in
            false
        }

        #expect(opened == nil)
    }

    @Test func `permission helpers keep privacy pane first with explicit fallback`() {
        #expect(NotificationPermissionHelper.settingsCandidates == [
            "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
            "x-apple.systempreferences:com.apple.preference.notifications",
        ])
        #expect(AccessibilityPermissionHelper.settingsCandidates == [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
            "x-apple.systempreferences:com.apple.preference.security",
        ])
        #expect(ScreenRecordingPermissionHelper.settingsCandidates == [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
            "x-apple.systempreferences:com.apple.preference.security",
        ])
        #expect(MicrophonePermissionHelper.settingsCandidates == [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
            "x-apple.systempreferences:com.apple.preference.security",
        ])
        #expect(CameraPermissionHelper.settingsCandidates == [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
            "x-apple.systempreferences:com.apple.preference.security",
        ])
        #expect(SpeechRecognitionPermissionHelper.settingsCandidates == [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition",
            "x-apple.systempreferences:com.apple.preference.security",
        ])
        #expect(LocationPermissionHelper.settingsCandidates == [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices",
            "x-apple.systempreferences:com.apple.preference.security",
        ])
        #expect(AutomationPermissionHelper.settingsCandidates == [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
            "x-apple.systempreferences:com.apple.preference.security",
        ])
    }
}
