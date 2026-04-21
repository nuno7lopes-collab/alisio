using System.Reflection;
using Alisio.WindowsHost.Models;

namespace Alisio.WindowsHost.Services;

public sealed class HostStateService
{
    public const string VirtualHostName = "appassets.alisio.test";
    private const string WindowsAppSdkVersion = "1.8.6";

    private static readonly Dictionary<string, bool> LegacyPermissions = new(StringComparer.Ordinal)
    {
        ["notifications"] = false,
        ["appleScript"] = false,
        ["accessibility"] = false,
        ["screenRecording"] = false,
        ["microphone"] = false,
        ["speechRecognition"] = false,
        ["camera"] = false,
        ["location"] = false,
    };

    private readonly AlisioHostPaths _paths;
    private readonly HostPreferences _preferences;
    private readonly ShellAssetLocator _shellAssetLocator;

    public HostStateService(
        AlisioHostPaths paths,
        HostPreferences preferences,
        ShellAssetLocator shellAssetLocator)
    {
        _paths = paths;
        _preferences = preferences;
        _shellAssetLocator = shellAssetLocator;
    }

    public HostPreferences Preferences => _preferences;

    public HostStateSnapshot CreateSnapshot()
    {
        var shellResolution = _shellAssetLocator.Resolve();
        var shellDirectory = shellResolution.Exists ? shellResolution.DirectoryPath : null;
        var shellUrl = shellDirectory is null ? null : $"https://{VirtualHostName}/index.html";
        return new HostStateSnapshot(
            Platform: "windows",
            AppVersion: ResolveAppVersion(),
            WindowsAppSdkVersion: WindowsAppSdkVersion,
            LogsDirectory: _paths.LogsDirectory,
            WebViewUserDataDirectory: _paths.WebViewUserDataDirectory,
            ShellDirectory: shellDirectory,
            ShellSource: shellResolution.Source,
            ShellUrl: shellUrl,
            ExperimentalShellBridgeEnabled: _preferences.ExperimentalShellBridgeEnabled,
            WslExecutablePresent: ResolveWslExecutablePresent(),
            Capabilities: new HostCapabilities(
                SharedShellHost: shellDirectory is not null,
                HostBridgeBase: true,
                ExperimentalShellBridgeInjection: _preferences.ExperimentalShellBridgeEnabled,
                NativeSettingsWindow: true,
                OpenExternal: true,
                RevealLogs: true,
                FilePickers: true,
                LocalComputer: false,
                LaunchAtLogin: false,
                VoiceWake: false,
                DeviceIdentityBridge: false));
    }

    public object CreateLegacyShellState()
    {
        var snapshot = CreateSnapshot();
        return new
        {
            platform = "windows",
            launchAtLogin = false,
            permissions = LegacyPermissions,
            voiceWake = new
            {
                supported = false,
                enabled = false,
                talkEnabled = false,
                triggers = Array.Empty<string>(),
            },
            logsPath = snapshot.LogsDirectory,
            developerCheckoutAvailable = false,
            hostState = snapshot,
        };
    }

    public void SavePreferences()
    {
        HostPreferenceStore.Save(_paths.PreferencesFile, _preferences);
    }

    private static string ResolveAppVersion()
    {
        var version = Assembly.GetExecutingAssembly().GetName().Version;
        return version is null ? "0.1.0-dev" : version.ToString();
    }

    private static bool ResolveWslExecutablePresent()
    {
        var systemDirectory = Environment.GetFolderPath(Environment.SpecialFolder.System);
        var wslPath = Path.Combine(systemDirectory, "wsl.exe");
        return File.Exists(wslPath);
    }
}
