using Alisio.WindowsHost.Models;
using Alisio.WindowsHost.Services;
using Microsoft.UI.Xaml;

namespace Alisio.WindowsHost;

public sealed partial class SettingsWindow : Window
{
    private readonly HostStateService _hostStateService;
    private readonly UriLauncher _uriLauncher;
    private readonly WindowsSettingsLauncher _windowsSettingsLauncher;
    private readonly HostLogger _logger;
    private readonly FileAccessService _fileAccessService;
    private readonly Func<bool, Task> _onBridgePreferenceChanged;

    private bool _updatingUi;
    private HostStateSnapshot? _snapshot;

    public SettingsWindow(
        HostStateService hostStateService,
        UriLauncher uriLauncher,
        WindowsSettingsLauncher windowsSettingsLauncher,
        HostLogger logger,
        Func<bool, Task> onBridgePreferenceChanged,
        Action onClosed)
    {
        this.InitializeComponent();
        this.Closed += (_, _) => onClosed();

        _hostStateService = hostStateService;
        _uriLauncher = uriLauncher;
        _windowsSettingsLauncher = windowsSettingsLauncher;
        _logger = logger;
        _onBridgePreferenceChanged = onBridgePreferenceChanged;
        _fileAccessService = new FileAccessService(this, logger);

        RefreshFromSnapshot(_hostStateService.CreateSnapshot());
    }

    public void RefreshFromSnapshot(HostStateSnapshot snapshot)
    {
        _snapshot = snapshot;
        ShellSourceTextBlock.Text = snapshot.ShellSource;
        ShellDirectoryTextBlock.Text = snapshot.ShellDirectory ?? "Unavailable";
        LogsDirectoryTextBlock.Text = snapshot.LogsDirectory;
        BridgeStatusTextBlock.Text = snapshot.ExperimentalShellBridgeEnabled
            ? "Experimental bridge injection is enabled."
            : "Experimental bridge injection is disabled by default.";
        WslStatusTextBlock.Text = snapshot.WslExecutablePresent
            ? "Present (`wsl.exe` found)."
            : "Not detected.";
        CapabilityTruthTextBlock.Text = BuildCapabilityTruth(snapshot);

        _updatingUi = true;
        ExperimentalBridgeToggle.IsOn = snapshot.ExperimentalShellBridgeEnabled;
        _updatingUi = false;
    }

    private static string BuildCapabilityTruth(HostStateSnapshot snapshot)
    {
        return string.Join(Environment.NewLine, new[]
        {
            $"- Temporary shell host: {(snapshot.Capabilities.SharedShellHost ? "available" : "missing shell assets")}",
            "- Native settings window: available",
            "- External link handoff: available",
            "- Logs reveal: available",
            "- File pickers: available",
            "- Local `computer`: unavailable",
            "- Launch at login: unavailable",
            "- Voice wake: unavailable",
            "- Managed device identity bridge: unavailable",
            "- Bridge injection into the temporary shell: experimental and off by default",
        });
    }

    private async void OpenWindowsSettingsButton_Click(object sender, RoutedEventArgs e)
    {
        await _windowsSettingsLauncher.OpenAsync("root");
    }

    private async void OpenLogsButton_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            await _uriLauncher.OpenPathInExplorerAsync(_hostStateService.CreateSnapshot().LogsDirectory);
        }
        catch (Exception error)
        {
            await _logger.WriteAsync("failed to open logs folder from settings window", error);
        }
    }

    private async void OpenShellFolderButton_Click(object sender, RoutedEventArgs e)
    {
        var snapshot = _snapshot ?? _hostStateService.CreateSnapshot();
        if (string.IsNullOrWhiteSpace(snapshot.ShellDirectory))
        {
            PickedPathTextBlock.Text = "The shell assets directory is unavailable right now.";
            return;
        }

        try
        {
            await _uriLauncher.OpenPathInExplorerAsync(snapshot.ShellDirectory);
        }
        catch (Exception error)
        {
            await _logger.WriteAsync("failed to open shell directory from settings window", error);
        }
    }

    private async void PickFileButton_Click(object sender, RoutedEventArgs e)
    {
        var result = await _fileAccessService.PickFileAsync();
        PickedPathTextBlock.Text = result.Canceled
            ? "File picker canceled."
            : $"Selected file: {result.Path}";
    }

    private async void PickFolderButton_Click(object sender, RoutedEventArgs e)
    {
        var result = await _fileAccessService.PickFolderAsync();
        PickedPathTextBlock.Text = result.Canceled
            ? "Folder picker canceled."
            : $"Selected folder: {result.Path}";
    }

    private async void OpenNotificationsButton_Click(object sender, RoutedEventArgs e)
    {
        await _windowsSettingsLauncher.OpenAsync("notifications");
    }

    private async void OpenMicrophoneButton_Click(object sender, RoutedEventArgs e)
    {
        await _windowsSettingsLauncher.OpenAsync("microphone");
    }

    private async void OpenCameraButton_Click(object sender, RoutedEventArgs e)
    {
        await _windowsSettingsLauncher.OpenAsync("camera");
    }

    private async void OpenLocationButton_Click(object sender, RoutedEventArgs e)
    {
        await _windowsSettingsLauncher.OpenAsync("location");
    }

    private async void OpenSpeechButton_Click(object sender, RoutedEventArgs e)
    {
        await _windowsSettingsLauncher.OpenAsync("speech");
    }

    private async void OpenScreenRecordingButton_Click(object sender, RoutedEventArgs e)
    {
        await _windowsSettingsLauncher.OpenAsync("screenRecording");
    }

    private async void ExperimentalBridgeToggle_Toggled(object sender, RoutedEventArgs e)
    {
        if (_updatingUi)
        {
            return;
        }

        await _onBridgePreferenceChanged(ExperimentalBridgeToggle.IsOn);
        RefreshFromSnapshot(_hostStateService.CreateSnapshot());
    }
}
