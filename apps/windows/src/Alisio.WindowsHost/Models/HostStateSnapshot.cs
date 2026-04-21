namespace Alisio.WindowsHost.Models;

public sealed record HostStateSnapshot(
    string Platform,
    string AppVersion,
    string WindowsAppSdkVersion,
    string LogsDirectory,
    string WebViewUserDataDirectory,
    string? ShellDirectory,
    string ShellSource,
    string? ShellUrl,
    bool ExperimentalShellBridgeEnabled,
    bool WslExecutablePresent,
    HostCapabilities Capabilities);
