namespace Alisio.WindowsHost.Models;

public sealed record HostCapabilities(
    bool SharedShellHost,
    bool HostBridgeBase,
    bool ExperimentalShellBridgeInjection,
    bool NativeSettingsWindow,
    bool OpenExternal,
    bool RevealLogs,
    bool FilePickers,
    bool LocalComputer,
    bool LaunchAtLogin,
    bool VoiceWake,
    bool DeviceIdentityBridge);
