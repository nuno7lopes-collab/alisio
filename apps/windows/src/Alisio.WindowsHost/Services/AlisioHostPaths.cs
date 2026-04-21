namespace Alisio.WindowsHost.Services;

public sealed class AlisioHostPaths
{
    public AlisioHostPaths()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        RootDirectory = Path.Combine(localAppData, "Alisio", "windows-host");
        LogsDirectory = Path.Combine(RootDirectory, "logs");
        WebViewUserDataDirectory = Path.Combine(RootDirectory, "webview2");
        PreferencesFile = Path.Combine(RootDirectory, "preferences.json");
        BridgeScriptPath = Path.Combine(AppContext.BaseDirectory, "Assets", "HostBridge", "alisio-host-bridge.js");
        StagedShellDirectory = Path.Combine(AppContext.BaseDirectory, "Assets", "Shell");
    }

    public string RootDirectory { get; }

    public string LogsDirectory { get; }

    public string WebViewUserDataDirectory { get; }

    public string PreferencesFile { get; }

    public string BridgeScriptPath { get; }

    public string StagedShellDirectory { get; }
}
