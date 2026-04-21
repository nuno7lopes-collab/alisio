using Alisio.WindowsHost.Models;
using Alisio.WindowsHost.Services;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.Web.WebView2.Core;

namespace Alisio.WindowsHost;

public sealed partial class MainWindow : Window
{
    private readonly AlisioHostPaths _paths;
    private readonly HostLogger _logger;
    private readonly HostPreferences _preferences;
    private readonly ShellAssetLocator _shellAssetLocator;
    private readonly UriLauncher _uriLauncher;
    private readonly WindowsSettingsLauncher _windowsSettingsLauncher;
    private readonly FileAccessService _fileAccessService;
    private readonly HostStateService _hostStateService;
    private readonly BridgeRequestDispatcher _bridgeDispatcher;
    private readonly WebViewHostBridge _hostBridge;

    private bool _initialized;
    private bool _updatingUi;
    private bool _webViewEventsAttached;
    private SettingsWindow? _settingsWindow;

    public MainWindow()
    {
        this.InitializeComponent();

        _paths = new AlisioHostPaths();
        Directory.CreateDirectory(_paths.RootDirectory);
        Directory.CreateDirectory(_paths.LogsDirectory);
        Directory.CreateDirectory(_paths.WebViewUserDataDirectory);

        _logger = new HostLogger(_paths);
        _preferences = HostPreferenceStore.Load(_paths.PreferencesFile);
        _shellAssetLocator = new ShellAssetLocator(_paths);
        _uriLauncher = new UriLauncher(_logger);
        _windowsSettingsLauncher = new WindowsSettingsLauncher(_uriLauncher);
        _fileAccessService = new FileAccessService(this, _logger);
        _hostStateService = new HostStateService(_paths, _preferences, _shellAssetLocator);
        _bridgeDispatcher = new BridgeRequestDispatcher(
            _hostStateService,
            OpenNativeSettingsAsync,
            _uriLauncher,
            _fileAccessService,
            _logger);
        _hostBridge = new WebViewHostBridge(_paths, _bridgeDispatcher, _logger);
    }

    private async void RootGrid_Loaded(object sender, RoutedEventArgs e)
    {
        if (_initialized)
        {
            return;
        }

        _initialized = true;
        await _logger.WriteAsync("main window loaded");
        await LoadShellAsync(showBanner: false);
    }

    private async Task LoadShellAsync(bool showBanner)
    {
        var snapshot = _hostStateService.CreateSnapshot();
        UpdateHeader(snapshot);

        if (!snapshot.Capabilities.SharedShellHost ||
            string.IsNullOrWhiteSpace(snapshot.ShellDirectory) ||
            string.IsNullOrWhiteSpace(snapshot.ShellUrl))
        {
            ShowEmptyState(_shellAssetLocator.Resolve().Message);
            if (showBanner)
            {
                ShowBanner("Shared shell is still missing. Build `ui/dist` or stage shell assets first.", isError: true);
            }

            return;
        }

        HideEmptyState();

        try
        {
            await EnsureWebViewReadyAsync(snapshot);
            if (showBanner)
            {
                var bridgeLabel = snapshot.ExperimentalShellBridgeEnabled ? "enabled" : "disabled";
                ShowBanner($"Reloaded the shared shell. Experimental bridge is {bridgeLabel}.", isError: false);
            }
        }
        catch (Exception error)
        {
            await _logger.WriteAsync("webview initialization failed", error);
            ShowEmptyState(error.Message);
            ShowBanner("Failed to initialize the shared shell. Check the Windows host log for details.", isError: true);
        }
    }

    private async Task EnsureWebViewReadyAsync(HostStateSnapshot snapshot)
    {
        var environment = await CoreWebView2Environment.CreateWithOptionsAsync(
            browserExecutableFolder: null,
            userDataFolder: snapshot.WebViewUserDataDirectory,
            options: null);

        await ShellWebView.EnsureCoreWebView2Async(environment);
        ShellWebView.Visibility = Visibility.Visible;

        var coreWebView = ShellWebView.CoreWebView2;
        coreWebView.Settings.IsWebMessageEnabled = true;
        coreWebView.Settings.AreDevToolsEnabled = true;
        coreWebView.Settings.AreDefaultContextMenusEnabled = true;
        coreWebView.Settings.IsStatusBarEnabled = false;
        coreWebView.SetVirtualHostNameToFolderMapping(
            HostStateService.VirtualHostName,
            snapshot.ShellDirectory!,
            CoreWebView2HostResourceAccessKind.DenyCors);

        if (!_webViewEventsAttached)
        {
            coreWebView.NavigationStarting += OnNavigationStarting;
            coreWebView.NewWindowRequested += OnNewWindowRequested;
            ShellWebView.NavigationCompleted += OnNavigationCompleted;
            _webViewEventsAttached = true;
        }

        await _hostBridge.ConfigureAsync(coreWebView, snapshot.ExperimentalShellBridgeEnabled);

        if (!string.Equals(coreWebView.Source, snapshot.ShellUrl, StringComparison.OrdinalIgnoreCase))
        {
            coreWebView.Navigate(snapshot.ShellUrl!);
        }
        else
        {
            coreWebView.Reload();
        }
    }

    private void OnNavigationCompleted(WebView2 sender, CoreWebView2NavigationCompletedEventArgs args)
    {
        if (!args.IsSuccess)
        {
            ShowBanner($"Shell navigation failed with WebView2 status {args.WebErrorStatus}.", isError: true);
        }
    }

    private async void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs args)
    {
        if (string.IsNullOrWhiteSpace(args.Uri) || !Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri))
        {
            return;
        }

        if (IsInternalShellUri(uri))
        {
            return;
        }

        args.Cancel = true;
        try
        {
            await _uriLauncher.OpenExternalAsync(args.Uri);
            ShowBanner($"Opened external link in Windows: {args.Uri}", isError: false);
        }
        catch (Exception error)
        {
            await _logger.WriteAsync($"failed to open external navigation uri={args.Uri}", error);
            ShowBanner(error.Message, isError: true);
        }
    }

    private async void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs args)
    {
        args.Handled = true;

        if (string.IsNullOrWhiteSpace(args.Uri) || !Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri))
        {
            return;
        }

        if (IsInternalShellUri(uri) && sender is CoreWebView2 coreWebView)
        {
            coreWebView.Navigate(args.Uri);
            return;
        }

        try
        {
            await _uriLauncher.OpenExternalAsync(args.Uri);
        }
        catch (Exception error)
        {
            await _logger.WriteAsync($"failed to open requested window uri={args.Uri}", error);
            ShowBanner(error.Message, isError: true);
        }
    }

    private static bool IsInternalShellUri(Uri uri)
    {
        if (uri.Scheme.Equals("about", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return (uri.Scheme.Equals("http", StringComparison.OrdinalIgnoreCase) ||
                uri.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase)) &&
               uri.Host.Equals(HostStateService.VirtualHostName, StringComparison.OrdinalIgnoreCase);
    }

    private void UpdateHeader(HostStateSnapshot snapshot)
    {
        _updatingUi = true;
        ExperimentalBridgeToggle.IsOn = snapshot.ExperimentalShellBridgeEnabled;
        _updatingUi = false;

        StatusTextBlock.Text =
            $"Shell source: {snapshot.ShellSource}. " +
            $"Bridge default: {(snapshot.ExperimentalShellBridgeEnabled ? "experimental on" : "off")}. " +
            "Local computer: unavailable on Windows host v1. " +
            $"WSL executable present: {(snapshot.WslExecutablePresent ? "yes" : "no")}.";
    }

    private void ShowEmptyState(string message)
    {
        EmptyStateTextBlock.Text = message;
        EmptyStateBorder.Visibility = Visibility.Visible;
        ShellWebView.Visibility = Visibility.Collapsed;
    }

    private void HideEmptyState()
    {
        EmptyStateBorder.Visibility = Visibility.Collapsed;
        ShellWebView.Visibility = Visibility.Visible;
    }

    private void ShowBanner(string message, bool isError)
    {
        BannerTextBlock.Text = message;
        BannerBorder.Background = new SolidColorBrush(isError
            ? ColorHelper.FromArgb(255, 254, 242, 242)
            : ColorHelper.FromArgb(255, 248, 250, 252));
        BannerBorder.BorderBrush = new SolidColorBrush(isError
            ? ColorHelper.FromArgb(255, 248, 113, 113)
            : ColorHelper.FromArgb(255, 148, 163, 184));
        BannerBorder.Visibility = Visibility.Visible;
    }

    private async Task ApplyExperimentalBridgePreferenceAsync(bool enabled)
    {
        if (_preferences.ExperimentalShellBridgeEnabled == enabled)
        {
            return;
        }

        _preferences.ExperimentalShellBridgeEnabled = enabled;
        _hostStateService.SavePreferences();
        await _logger.WriteAsync($"experimental bridge set enabled={enabled}");
        await LoadShellAsync(showBanner: true);
        _settingsWindow?.RefreshFromSnapshot(_hostStateService.CreateSnapshot());
    }

    private async Task OpenNativeSettingsAsync()
    {
        if (_settingsWindow is null)
        {
            _settingsWindow = new SettingsWindow(
                _hostStateService,
                _uriLauncher,
                _windowsSettingsLauncher,
                _logger,
                ApplyExperimentalBridgePreferenceAsync,
                () => _settingsWindow = null);
        }

        _settingsWindow.RefreshFromSnapshot(_hostStateService.CreateSnapshot());
        _settingsWindow.Activate();
        await Task.CompletedTask;
    }

    private async void NativeSettingsButton_Click(object sender, RoutedEventArgs e)
    {
        await OpenNativeSettingsAsync();
    }

    private async void OpenLogsButton_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            await _uriLauncher.OpenPathInExplorerAsync(_hostStateService.CreateSnapshot().LogsDirectory);
        }
        catch (Exception error)
        {
            await _logger.WriteAsync("failed to open logs directory", error);
            ShowBanner(error.Message, isError: true);
        }
    }

    private async void ReloadShellButton_Click(object sender, RoutedEventArgs e)
    {
        await LoadShellAsync(showBanner: true);
    }

    private async void ExperimentalBridgeToggle_Toggled(object sender, RoutedEventArgs e)
    {
        if (_updatingUi)
        {
            return;
        }

        await ApplyExperimentalBridgePreferenceAsync(ExperimentalBridgeToggle.IsOn);
    }
}
