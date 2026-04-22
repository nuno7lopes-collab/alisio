namespace Alisio.WindowsHost.Models;

public sealed record HostCapabilities(
    bool NativeWorkspaceNavigation,
    bool SessionTranscriptBrowsing,
    bool RuntimeReconnect,
    bool OpenExternal,
    bool RevealLogs,
    bool RevealWorkspace,
    bool OpenWindowsSettings,
    bool LocalComputer,
    bool MessageCompose);
