using Alisio.WindowsHost.Models;
using Alisio.WindowsHost.Services;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace Alisio.WindowsHost;

public sealed partial class MainWindow : Window
{
    private enum SurfacePane
    {
        Chat,
        Workspace,
    }

    private enum BannerTone
    {
        Info,
        Success,
        Warning,
        Error,
    }

    private readonly AlisioHostPaths _paths;
    private readonly HostLogger _logger;
    private readonly UriLauncher _uriLauncher;
    private readonly WindowsSettingsLauncher _windowsSettingsLauncher;
    private readonly HostStateService _hostStateService;
    private readonly HostConfigProbe _configProbe;
    private readonly SessionStoreService _sessionStoreService;
    private readonly DispatcherTimer _refreshTimer;

    private bool _initialized;
    private bool _refreshInProgress;
    private bool _updatingSessionList;
    private SurfacePane _activePane = SurfacePane.Chat;
    private HostStateSnapshot? _snapshot;
    private HostConfigSnapshot _configSnapshot = new(
        Exists: false,
        WorkspaceDirectory: null,
        SessionStoreTemplate: null,
        GatewayMode: null,
        GatewayRemoteUrl: null,
        Error: null);
    private SessionStoreLoadResult _sessionLoadResult = new(
        AttemptedStorePaths: Array.Empty<string>(),
        Sessions: Array.Empty<SessionSummary>(),
        Warnings: Array.Empty<string>());
    private WorkspaceConnectionState _connectionState = WorkspaceConnectionState.Error;
    private HostCapabilities _capabilities = new(
        NativeWorkspaceNavigation: true,
        SessionTranscriptBrowsing: false,
        RuntimeReconnect: false,
        OpenExternal: true,
        RevealLogs: true,
        RevealWorkspace: true,
        OpenWindowsSettings: true,
        LocalComputer: false,
        MessageCompose: false);
    private string? _selectedSessionKey;

    public MainWindow()
    {
        this.InitializeComponent();

        _paths = new AlisioHostPaths();
        Directory.CreateDirectory(_paths.RootDirectory);
        Directory.CreateDirectory(_paths.LogsDirectory);

        _logger = new HostLogger(_paths);
        _uriLauncher = new UriLauncher(_logger);
        _windowsSettingsLauncher = new WindowsSettingsLauncher(_uriLauncher);
        _hostStateService = new HostStateService(_paths, _logger);
        _configProbe = new HostConfigProbe(_paths);
        _sessionStoreService = new SessionStoreService(_paths);

        _refreshTimer = new DispatcherTimer();
        _refreshTimer.Interval = TimeSpan.FromSeconds(20);
        _refreshTimer.Tick += RefreshTimer_Tick;
    }

    private async void RootGrid_Loaded(object sender, RoutedEventArgs e)
    {
        if (_initialized)
        {
            return;
        }

        _initialized = true;
        await _logger.WriteAsync("main window loaded");
        await RefreshSnapshotAsync(showSuccessBanner: false);
        _refreshTimer.Start();
    }

    private async void RefreshTimer_Tick(object? sender, object e)
    {
        if (_refreshInProgress)
        {
            return;
        }

        await RefreshSnapshotAsync(showSuccessBanner: false);
    }

    private async Task RefreshSnapshotAsync(bool showSuccessBanner)
    {
        if (_refreshInProgress)
        {
            return;
        }

        _refreshInProgress = true;
        SetRefreshVisuals(isRefreshing: true, "Refreshing Windows workspace...");

        try
        {
            var snapshot = await _hostStateService.CreateSnapshotAsync();
            var configSnapshot = _configProbe.Read();
            var sessionStorePaths = ResolveSessionStorePaths(configSnapshot.SessionStoreTemplate);
            var sessionLoadResult = _sessionStoreService.LoadSessions(sessionStorePaths);
            var connectionState = ResolveConnectionState(snapshot, sessionLoadResult);
            var capabilities = BuildCapabilities(snapshot, sessionLoadResult);

            _snapshot = snapshot;
            _configSnapshot = configSnapshot;
            _sessionLoadResult = sessionLoadResult;
            _connectionState = connectionState;
            _capabilities = capabilities;

            ApplySnapshot();
            await LoadSelectedSessionAsync();
            UpdateRefreshInterval(connectionState);

            if (showSuccessBanner)
            {
                ShowBanner("Refreshed Windows workspace state.", BannerTone.Success);
            }
            else if (!string.IsNullOrWhiteSpace(configSnapshot.Error))
            {
                ShowBanner(configSnapshot.Error!, BannerTone.Warning);
            }
            else if (sessionLoadResult.Warnings.Count > 0)
            {
                ShowBanner(sessionLoadResult.Warnings[0], BannerTone.Warning);
            }
            else if (connectionState == WorkspaceConnectionState.NeedsSetup)
            {
                ShowBanner(
                    "Setup is still required before Windows can claim a ready chat surface.",
                    BannerTone.Info);
            }
            else if (connectionState == WorkspaceConnectionState.LocalStateOnly)
            {
                ShowBanner(
                    "Gateway state is unavailable. Windows is showing stored sessions and transcripts only.",
                    BannerTone.Warning);
            }
            else
            {
                HideBanner();
            }
        }
        catch (Exception error)
        {
            await _logger.WriteAsync("failed to refresh Windows workspace state", error);
            ShowBanner(error.Message, BannerTone.Error);
            ShowFatalState(
                "Windows workspace failed to refresh",
                "The host could not read the current runtime, gateway, or session state.");
        }
        finally
        {
            SetRefreshVisuals(isRefreshing: false, message: string.Empty);
            _refreshInProgress = false;
        }
    }

    private void ApplySnapshot()
    {
        if (_snapshot is null)
        {
            return;
        }

        UpdateHeader(_snapshot, _connectionState);
        UpdateWorkspacePane(_snapshot, _configSnapshot, _sessionLoadResult, _capabilities, _connectionState);
        UpdateRailStatus(_sessionLoadResult, _connectionState);
        RenderSessionList(_sessionLoadResult.Sessions);
        ApplyActivePane();

        OpenTranscriptButton.IsEnabled = GetSelectedSession() is { TranscriptExists: true };
        OpenWorkspaceButton.IsEnabled = Directory.Exists(ResolveWorkspaceDirectory(_configSnapshot));
        OpenConfigButton.IsEnabled = File.Exists(_paths.ConfigFile);
        OpenSessionsFolderButton.IsEnabled = Directory.Exists(ResolveSessionsDirectoryPath());

        if (ShouldShowFatalState(_snapshot, _connectionState, _sessionLoadResult))
        {
            ShowFatalState(
                "Windows workspace cannot open the live product state",
                BuildFatalStateBody(_snapshot, _connectionState));
        }
        else
        {
            HideFatalState();
        }
    }

    private static bool ShouldShowFatalState(
        HostStateSnapshot snapshot,
        WorkspaceConnectionState connectionState,
        SessionStoreLoadResult sessionLoadResult)
    {
        if (!snapshot.RuntimeAvailable && sessionLoadResult.Sessions.Count == 0)
        {
            return true;
        }

        return connectionState == WorkspaceConnectionState.Error && sessionLoadResult.Sessions.Count == 0;
    }

    private static string BuildFatalStateBody(
        HostStateSnapshot snapshot,
        WorkspaceConnectionState connectionState)
    {
        if (!snapshot.RuntimeAvailable)
        {
            return "The Alisio CLI/runtime is missing, so Windows cannot claim setup, reconnect, or chat. Install the runtime first.";
        }

        if (!snapshot.GatewayReachable)
        {
            return "The gateway is unreachable and there is no local session history to render. Start the local gateway or restore state on disk.";
        }

        return connectionState switch
        {
            WorkspaceConnectionState.NeedsSetup =>
                "Account bootstrap is incomplete. Finish setup before Windows can present a ready workspace.",
            _ =>
                "Windows could not establish a usable native workspace state from the current runtime and stored data.",
        };
    }

    private void UpdateHeader(HostStateSnapshot snapshot, WorkspaceConnectionState connectionState)
    {
        var (label, background, foreground) = connectionState switch
        {
            WorkspaceConnectionState.Ready => (
                "Ready",
                ColorHelper.FromArgb(255, 220, 252, 231),
                ColorHelper.FromArgb(255, 22, 101, 52)),
            WorkspaceConnectionState.NeedsSetup => (
                "Setup required",
                ColorHelper.FromArgb(255, 254, 243, 199),
                ColorHelper.FromArgb(255, 146, 64, 14)),
            WorkspaceConnectionState.LocalStateOnly => (
                "Local state only",
                ColorHelper.FromArgb(255, 255, 237, 213),
                ColorHelper.FromArgb(255, 154, 52, 18)),
            WorkspaceConnectionState.Reconnecting => (
                "Reconnecting",
                ColorHelper.FromArgb(255, 224, 242, 254),
                ColorHelper.FromArgb(255, 3, 105, 161)),
            _ => (
                "Error",
                ColorHelper.FromArgb(255, 254, 226, 226),
                ColorHelper.FromArgb(255, 153, 27, 27)),
        };

        HeaderStateBadgeTextBlock.Text = label;
        HeaderStateBadgeBorder.Background = new SolidColorBrush(background);
        HeaderStateBadgeTextBlock.Foreground = new SolidColorBrush(foreground);
        HeaderSummaryTextBlock.Text = BuildHeaderSummary(snapshot, connectionState);
    }

    private static string BuildHeaderSummary(
        HostStateSnapshot snapshot,
        WorkspaceConnectionState connectionState)
    {
        var identity = snapshot.Email ?? snapshot.DisplayName ?? snapshot.AccountId ?? "signed-out";
        return connectionState switch
        {
            WorkspaceConnectionState.Ready =>
                $"Chat is backed by the live gateway. Account: {identity}. Gateway: {snapshot.GatewayStatus}.",
            WorkspaceConnectionState.NeedsSetup =>
                $"Windows is connected but not ready for chat. Startup: {snapshot.StartupState}. Next step: {snapshot.NextStep}.",
            WorkspaceConnectionState.LocalStateOnly =>
                $"Showing stored sessions only. Runtime: {snapshot.RuntimeStatus}. Gateway: {snapshot.GatewayStatus}.",
            WorkspaceConnectionState.Reconnecting =>
                $"Runtime is available but Windows is waiting for the gateway to reconnect on port {snapshot.GatewayPort}.",
            _ =>
                $"Windows cannot claim a working product surface. Runtime: {snapshot.RuntimeStatus}.",
        };
    }

    private void UpdateWorkspacePane(
        HostStateSnapshot snapshot,
        HostConfigSnapshot configSnapshot,
        SessionStoreLoadResult sessionLoadResult,
        HostCapabilities capabilities,
        WorkspaceConnectionState connectionState)
    {
        WorkspaceStateTitleTextBlock.Text = connectionState switch
        {
            WorkspaceConnectionState.Ready => "Live native workspace",
            WorkspaceConnectionState.NeedsSetup => "Gateway connected, setup still pending",
            WorkspaceConnectionState.LocalStateOnly => "Stored transcript recovery",
            WorkspaceConnectionState.Reconnecting => "Waiting for the gateway",
            _ => "Workspace unavailable",
        };

        WorkspaceStateTextBlock.Text = BuildWorkspaceStateBody(snapshot, configSnapshot, sessionLoadResult, connectionState);
        WorkspacePathsTextBlock.Text = string.Join(
            Environment.NewLine,
            new[]
            {
                $"Config: {_paths.ConfigFile}",
                $"Workspace: {ResolveWorkspaceDirectory(configSnapshot)}",
                $"State: {_paths.AlisioStateDirectory}",
                $"Agents: {_paths.AgentsDirectory}",
                $"Logs: {_paths.LogsDirectory}",
            });
        GatewayDetailsTextBlock.Text = BuildGatewayDetails(snapshot, configSnapshot);
        SessionStoresTextBlock.Text = BuildSessionStoresDetails(sessionLoadResult);
        CapabilitiesTextBlock.Text = BuildCapabilityTruth(capabilities);
        CaveatsTextBlock.Text = BuildCaveats(snapshot, capabilities, connectionState, sessionLoadResult);
    }

    private static string BuildWorkspaceStateBody(
        HostStateSnapshot snapshot,
        HostConfigSnapshot configSnapshot,
        SessionStoreLoadResult sessionLoadResult,
        WorkspaceConnectionState connectionState)
    {
        var lines = new List<string>
        {
            $"Startup state: {snapshot.StartupState}",
            $"Next step: {snapshot.NextStep}",
            $"Signed in: {ToYesNo(snapshot.SignedIn)}",
            $"Account ready: {ToYesNo(snapshot.AccountReady)}",
            $"Provider ready: {ToYesNo(snapshot.ProviderReady)}",
            $"Configured gateway mode: {configSnapshot.GatewayMode ?? "local"}",
            $"Stored sessions: {sessionLoadResult.Sessions.Count}",
        };

        if (connectionState == WorkspaceConnectionState.LocalStateOnly)
        {
            lines.Add("Windows is intentionally rendering only persisted session history.");
        }

        if (!string.IsNullOrWhiteSpace(configSnapshot.Error))
        {
            lines.Add(configSnapshot.Error!);
        }

        return string.Join(Environment.NewLine, lines);
    }

    private void UpdateRailStatus(
        SessionStoreLoadResult sessionLoadResult,
        WorkspaceConnectionState connectionState)
    {
        var sessionCount = sessionLoadResult.Sessions.Count;
        var attemptedStores = sessionLoadResult.AttemptedStorePaths.Count;
        var warningSuffix = sessionLoadResult.Warnings.Count > 0
            ? $" {sessionLoadResult.Warnings.Count} warning(s)."
            : string.Empty;

        RailStatusTextBlock.Text =
            $"{sessionCount} session(s) from {attemptedStores} store(s). State: {connectionStateToLabel(connectionState)}.{warningSuffix}";

        static string connectionStateToLabel(WorkspaceConnectionState state)
        {
            return state switch
            {
                WorkspaceConnectionState.Ready => "ready",
                WorkspaceConnectionState.NeedsSetup => "setup required",
                WorkspaceConnectionState.LocalStateOnly => "local state only",
                WorkspaceConnectionState.Reconnecting => "reconnecting",
                _ => "error",
            };
        }
    }

    private void RenderSessionList(IReadOnlyList<SessionSummary> sessions)
    {
        _updatingSessionList = true;

        try
        {
            SessionListStackPanel.Children.Clear();

            var filtered = GetVisibleSessions();

            if (filtered.Count == 0)
            {
                SessionListStackPanel.Children.Add(new Border
                {
                    Background = new SolidColorBrush(ColorHelper.FromArgb(255, 248, 250, 252)),
                    BorderBrush = new SolidColorBrush(ColorHelper.FromArgb(255, 226, 232, 240)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(16),
                    Padding = new Thickness(14),
                    Child = new TextBlock
                    {
                        Foreground = new SolidColorBrush(ColorHelper.FromArgb(255, 100, 116, 139)),
                        Text = sessions.Count == 0
                            ? "No session stores were discovered yet."
                            : "No sessions match the current filter.",
                        TextWrapping = TextWrapping.Wrap,
                    },
                });
                return;
            }

            foreach (var session in filtered)
            {
                SessionListStackPanel.Children.Add(BuildSessionListItem(session));
            }

            if (filtered.All((session) => !string.Equals(session.Key, _selectedSessionKey, StringComparison.Ordinal)))
            {
                _selectedSessionKey = filtered[0].Key;
            }
        }
        finally
        {
            _updatingSessionList = false;
        }
    }

    private Button BuildSessionListItem(SessionSummary session)
    {
        var selected = string.Equals(session.Key, _selectedSessionKey, StringComparison.Ordinal);

        var title = new TextBlock
        {
            FontWeight = FontWeights.SemiBold,
            Foreground = new SolidColorBrush(selected
                ? ColorHelper.FromArgb(255, 15, 23, 42)
                : ColorHelper.FromArgb(255, 30, 41, 59)),
            Text = session.DisplayName,
            TextWrapping = TextWrapping.Wrap,
        };

        var meta = new TextBlock
        {
            Foreground = new SolidColorBrush(ColorHelper.FromArgb(255, 100, 116, 139)),
            Text = BuildSessionMeta(session),
            TextWrapping = TextWrapping.Wrap,
        };

        var status = new TextBlock
        {
            Foreground = new SolidColorBrush(ColorHelper.FromArgb(255, 71, 85, 105)),
            Text = BuildSelectedSessionStatus(session),
            TextWrapping = TextWrapping.Wrap,
        };

        var panel = new StackPanel { Spacing = 6 };
        panel.Children.Add(title);
        panel.Children.Add(meta);
        panel.Children.Add(status);

        var button = new Button
        {
            Tag = session.Key,
            Padding = new Thickness(0),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            Background = new SolidColorBrush(selected
                ? ColorHelper.FromArgb(255, 226, 232, 240)
                : ColorHelper.FromArgb(255, 248, 250, 252)),
            BorderBrush = new SolidColorBrush(selected
                ? ColorHelper.FromArgb(255, 148, 163, 184)
                : ColorHelper.FromArgb(255, 226, 232, 240)),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(16),
            Content = new Border
            {
                Padding = new Thickness(14),
                Child = panel,
            },
        };

        button.Click += SessionButton_Click;
        return button;
    }

    private async Task LoadSelectedSessionAsync()
    {
        var visibleSessions = GetVisibleSessions();
        if (visibleSessions.Count == 0)
        {
            SelectedSessionTitleTextBlock.Text = "No visible session";
            SelectedSessionStatusTextBlock.Text = "The current filter hides every discovered session.";
            SelectedSessionMetaTextBlock.Text = "Clear the filter or wait for Windows to discover new session stores.";
            OpenTranscriptButton.IsEnabled = false;
            RenderConversationState(
                "No sessions match the filter",
                _sessionLoadResult.Sessions.Count == 0
                    ? "The native Windows surface is waiting for a session store or transcript."
                    : "Adjust the filter to browse one of the discovered sessions.");
            return;
        }

        var selectedSession = GetSelectedSession();
        if (selectedSession is null)
        {
            SelectedSessionTitleTextBlock.Text = "No session selected";
            SelectedSessionStatusTextBlock.Text = "Windows has nothing to render yet.";
            SelectedSessionMetaTextBlock.Text = "Start Alisio and let it write a session store, or open the workspace pane for the current runtime state.";
            OpenTranscriptButton.IsEnabled = false;
            RenderConversationState(
                "No stored conversation",
                "The native Windows surface is waiting for a session store or transcript.");
            return;
        }

        SelectedSessionTitleTextBlock.Text = selectedSession.DisplayName;
        SelectedSessionStatusTextBlock.Text = BuildSelectedSessionStatus(selectedSession);
        SelectedSessionMetaTextBlock.Text = BuildSelectedSessionMeta(selectedSession);
        OpenTranscriptButton.IsEnabled = selectedSession.TranscriptExists;

        var transcript = await Task.Run(() => _sessionStoreService.LoadTranscript(selectedSession));

        if (!string.IsNullOrWhiteSpace(transcript.Error))
        {
            RenderConversationState(
                "Transcript unreadable",
                "Windows found the transcript file but could not render it.",
                transcript.Error);
            return;
        }

        if (transcript.MissingTranscript)
        {
            RenderConversationState(
                "Transcript missing",
                "The session store exists but the transcript file has not been persisted alongside it yet.");
            return;
        }

        if (transcript.Messages.Count == 0)
        {
            RenderConversationState(
                "Transcript empty",
                "This session does not have any renderable message turns yet.");
            return;
        }

        RenderConversationMessages(transcript.Messages);
        _ = ConversationScrollViewer.ChangeView(null, ConversationScrollViewer.ScrollableHeight, null, true);
    }

    private void RenderConversationMessages(IReadOnlyList<SessionMessage> messages)
    {
        ConversationStackPanel.Children.Clear();
        foreach (var message in messages)
        {
            ConversationStackPanel.Children.Add(BuildMessageCard(message));
        }
    }

    private Border BuildMessageCard(SessionMessage message)
    {
        var (background, border, title) = message.Role switch
        {
            "user" => (
                ColorHelper.FromArgb(255, 239, 246, 255),
                ColorHelper.FromArgb(255, 125, 211, 252),
                message.Title),
            "assistant" => (
                ColorHelper.FromArgb(255, 248, 250, 252),
                ColorHelper.FromArgb(255, 203, 213, 225),
                message.Title),
            _ => (
                ColorHelper.FromArgb(255, 255, 247, 237),
                ColorHelper.FromArgb(255, 251, 191, 36),
                message.Title),
        };

        var body = new TextBlock
        {
            Text = message.Body,
            Foreground = new SolidColorBrush(ColorHelper.FromArgb(255, 15, 23, 42)),
            TextWrapping = TextWrapping.Wrap,
        };

        var panel = new StackPanel { Spacing = 8 };
        panel.Children.Add(new TextBlock
        {
            FontWeight = FontWeights.SemiBold,
            Foreground = new SolidColorBrush(ColorHelper.FromArgb(255, 15, 23, 42)),
            Text = title,
        });
        panel.Children.Add(new TextBlock
        {
            Foreground = new SolidColorBrush(ColorHelper.FromArgb(255, 100, 116, 139)),
            Text = FormatAbsoluteTime(message.Timestamp),
        });
        panel.Children.Add(body);

        return new Border
        {
            Padding = new Thickness(14),
            Background = new SolidColorBrush(background),
            BorderBrush = new SolidColorBrush(border),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(18),
            Child = panel,
        };
    }

    private void RenderConversationState(string title, string body, string? details = null)
    {
        ConversationStackPanel.Children.Clear();

        var panel = new StackPanel { Spacing = 10 };
        panel.Children.Add(new TextBlock
        {
            FontSize = 20,
            FontWeight = FontWeights.SemiBold,
            Text = title,
        });
        panel.Children.Add(new TextBlock
        {
            Foreground = new SolidColorBrush(ColorHelper.FromArgb(255, 71, 85, 105)),
            Text = body,
            TextWrapping = TextWrapping.Wrap,
        });

        if (!string.IsNullOrWhiteSpace(details))
        {
            panel.Children.Add(new TextBlock
            {
                FontFamily = new FontFamily("Consolas"),
                Foreground = new SolidColorBrush(ColorHelper.FromArgb(255, 51, 65, 85)),
                Text = details,
                TextWrapping = TextWrapping.Wrap,
            });
        }

        ConversationStackPanel.Children.Add(new Border
        {
            Padding = new Thickness(18),
            Background = new SolidColorBrush(ColorHelper.FromArgb(255, 248, 250, 252)),
            BorderBrush = new SolidColorBrush(ColorHelper.FromArgb(255, 226, 232, 240)),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(18),
            Child = panel,
        });
    }

    private void ShowFatalState(string title, string body)
    {
        FatalStateTitleTextBlock.Text = title;
        FatalStateBodyTextBlock.Text = body;
        FatalStateBorder.Visibility = Visibility.Visible;
    }

    private void HideFatalState()
    {
        FatalStateBorder.Visibility = Visibility.Collapsed;
    }

    private void SetRefreshVisuals(bool isRefreshing, string message)
    {
        RefreshButton.IsEnabled = !isRefreshing;
        LoadingTextBlock.Text = string.IsNullOrWhiteSpace(message)
            ? "Refreshing Windows workspace"
            : message;
        LoadingOverlayBorder.Visibility = isRefreshing ? Visibility.Visible : Visibility.Collapsed;
    }

    private void UpdateRefreshInterval(WorkspaceConnectionState connectionState)
    {
        _refreshTimer.Interval = connectionState switch
        {
            WorkspaceConnectionState.Ready => TimeSpan.FromSeconds(20),
            WorkspaceConnectionState.NeedsSetup => TimeSpan.FromSeconds(12),
            WorkspaceConnectionState.LocalStateOnly => TimeSpan.FromSeconds(10),
            WorkspaceConnectionState.Reconnecting => TimeSpan.FromSeconds(5),
            _ => TimeSpan.FromSeconds(15),
        };
    }

    private bool MatchesSessionFilter(SessionSummary session)
    {
        var filter = SessionFilterTextBox.Text?.Trim();
        if (string.IsNullOrWhiteSpace(filter))
        {
            return true;
        }

        return session.DisplayName.Contains(filter, StringComparison.OrdinalIgnoreCase) ||
               session.Key.Contains(filter, StringComparison.OrdinalIgnoreCase) ||
               session.AgentId.Contains(filter, StringComparison.OrdinalIgnoreCase) ||
               (session.Model?.Contains(filter, StringComparison.OrdinalIgnoreCase) ?? false);
    }

    private List<SessionSummary> GetVisibleSessions()
    {
        return _sessionLoadResult.Sessions
            .Where(MatchesSessionFilter)
            .ToList();
    }

    private static string BuildSessionMeta(SessionSummary session)
    {
        var bits = new List<string>
        {
            session.Kind,
            $"agent {session.AgentId}",
        };

        if (!string.IsNullOrWhiteSpace(session.Model))
        {
            bits.Add(session.Model!);
        }

        return string.Join(" | ", bits);
    }

    private static string BuildSelectedSessionStatus(SessionSummary session)
    {
        var updated = FormatRelativeTime(session.UpdatedAt);
        var transcript = session.TranscriptExists ? "Transcript available" : "Transcript missing";
        var status = string.IsNullOrWhiteSpace(session.Status) ? "status unknown" : session.Status;
        return $"{transcript}. {status}. Updated {updated}.";
    }

    private static string BuildSelectedSessionMeta(SessionSummary session)
    {
        return string.Join(
            Environment.NewLine,
            new[]
            {
                $"Key: {session.Key}",
                $"Session ID: {session.SessionId}",
                $"Agent: {session.AgentId}",
                $"Store: {session.StorePath}",
            });
    }

    private static string BuildGatewayDetails(
        HostStateSnapshot snapshot,
        HostConfigSnapshot configSnapshot)
    {
        return string.Join(
            Environment.NewLine,
            new[]
            {
                $"Runtime status: {snapshot.RuntimeStatus}",
                $"Runtime source: {snapshot.RuntimeSource}",
                $"Runtime command: {snapshot.RuntimeCommand}",
                $"Gateway status: {snapshot.GatewayStatus}",
                $"Gateway port: {snapshot.GatewayPort}",
                $"Gateway mode: {configSnapshot.GatewayMode ?? "local"}",
                $"Remote URL: {configSnapshot.GatewayRemoteUrl ?? "n/a"}",
                $"Shared backend: {snapshot.SharedBackendStatus}",
            });
    }

    private static string BuildSessionStoresDetails(SessionStoreLoadResult sessionLoadResult)
    {
        var lines = new List<string>();
        lines.AddRange(sessionLoadResult.AttemptedStorePaths.Count == 0
            ? ["No session store paths were discovered."]
            : sessionLoadResult.AttemptedStorePaths.Select((path) => $"Store: {path}"));

        if (sessionLoadResult.Warnings.Count > 0)
        {
            lines.AddRange(sessionLoadResult.Warnings.Select((warning) => $"Warning: {warning}"));
        }

        return string.Join(Environment.NewLine, lines);
    }

    private static string BuildCapabilityTruth(HostCapabilities capabilities)
    {
        return string.Join(
            Environment.NewLine,
            new[]
            {
                $"Native workspace navigation: {ToYesNo(capabilities.NativeWorkspaceNavigation)}",
                $"Session transcript browsing: {ToYesNo(capabilities.SessionTranscriptBrowsing)}",
                $"Runtime reconnect handling: {ToYesNo(capabilities.RuntimeReconnect)}",
                $"Reveal logs and workspace: {ToYesNo(capabilities.RevealLogs && capabilities.RevealWorkspace)}",
                $"Windows settings launchers: {ToYesNo(capabilities.OpenWindowsSettings)}",
                $"Local computer control: {ToYesNo(capabilities.LocalComputer)}",
                $"Native message compose: {ToYesNo(capabilities.MessageCompose)}",
            });
    }

    private static string BuildCaveats(
        HostStateSnapshot snapshot,
        HostCapabilities capabilities,
        WorkspaceConnectionState connectionState,
        SessionStoreLoadResult sessionLoadResult)
    {
        var lines = new List<string>();

        if (!snapshot.RuntimeAvailable)
        {
            lines.Add("Windows does not fake setup or chat when the Alisio runtime is missing.");
        }

        if (connectionState == WorkspaceConnectionState.LocalStateOnly)
        {
            lines.Add("This surface is read-only until the gateway comes back.");
        }

        if (!snapshot.ChatReady)
        {
            lines.Add("Chat readiness still depends on the canonical bootstrap contract.");
        }

        if (!capabilities.MessageCompose)
        {
            lines.Add("Sending new messages is not in the native Windows surface yet.");
        }

        if (sessionLoadResult.Sessions.Count == 0)
        {
            lines.Add("No persisted sessions were found under the current agent roots.");
        }

        return string.Join(Environment.NewLine, lines);
    }

    private static string FormatRelativeTime(DateTimeOffset? timestamp)
    {
        if (timestamp is null)
        {
            return "unknown";
        }

        var delta = DateTimeOffset.UtcNow - timestamp.Value.ToUniversalTime();
        if (delta < TimeSpan.FromMinutes(1))
        {
            return "just now";
        }

        if (delta < TimeSpan.FromHours(1))
        {
            return $"{Math.Max(1, (int)Math.Round(delta.TotalMinutes))} minute(s) ago";
        }

        if (delta < TimeSpan.FromDays(1))
        {
            return $"{Math.Max(1, (int)Math.Round(delta.TotalHours))} hour(s) ago";
        }

        return $"{Math.Max(1, (int)Math.Round(delta.TotalDays))} day(s) ago";
    }

    private static string FormatAbsoluteTime(DateTimeOffset? timestamp)
    {
        return timestamp is null
            ? "Time unknown"
            : timestamp.Value.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
    }

    private void ApplyActivePane()
    {
        ChatPane.Visibility = _activePane == SurfacePane.Chat ? Visibility.Visible : Visibility.Collapsed;
        WorkspacePane.Visibility = _activePane == SurfacePane.Workspace ? Visibility.Visible : Visibility.Collapsed;
        SetPaneButtonState(ChatPaneButton, _activePane == SurfacePane.Chat);
        SetPaneButtonState(WorkspacePaneButton, _activePane == SurfacePane.Workspace);
    }

    private static void SetPaneButtonState(Button button, bool active)
    {
        button.Background = new SolidColorBrush(active
            ? ColorHelper.FromArgb(255, 226, 232, 240)
            : ColorHelper.FromArgb(255, 248, 250, 252));
        button.BorderBrush = new SolidColorBrush(active
            ? ColorHelper.FromArgb(255, 148, 163, 184)
            : ColorHelper.FromArgb(255, 226, 232, 240));
        button.Foreground = new SolidColorBrush(ColorHelper.FromArgb(255, 15, 23, 42));
    }

    private void ShowBanner(string message, BannerTone tone)
    {
        var (background, border, foreground) = tone switch
        {
            BannerTone.Success => (
                ColorHelper.FromArgb(255, 236, 253, 245),
                ColorHelper.FromArgb(255, 52, 211, 153),
                ColorHelper.FromArgb(255, 6, 95, 70)),
            BannerTone.Warning => (
                ColorHelper.FromArgb(255, 255, 247, 237),
                ColorHelper.FromArgb(255, 251, 191, 36),
                ColorHelper.FromArgb(255, 146, 64, 14)),
            BannerTone.Error => (
                ColorHelper.FromArgb(255, 254, 242, 242),
                ColorHelper.FromArgb(255, 248, 113, 113),
                ColorHelper.FromArgb(255, 153, 27, 27)),
            _ => (
                ColorHelper.FromArgb(255, 241, 245, 249),
                ColorHelper.FromArgb(255, 148, 163, 184),
                ColorHelper.FromArgb(255, 30, 41, 59)),
        };

        BannerTextBlock.Text = message;
        BannerTextBlock.Foreground = new SolidColorBrush(foreground);
        BannerBorder.Background = new SolidColorBrush(background);
        BannerBorder.BorderBrush = new SolidColorBrush(border);
        BannerBorder.Visibility = Visibility.Visible;
    }

    private void HideBanner()
    {
        BannerBorder.Visibility = Visibility.Collapsed;
    }

    private async Task RunActionAsync(string operation, string successMessage, Func<Task> action)
    {
        try
        {
            await action();
            ShowBanner(successMessage, BannerTone.Success);
        }
        catch (Exception error)
        {
            await _logger.WriteAsync(operation, error);
            ShowBanner(error.Message, BannerTone.Error);
        }
    }

    private string ResolveSessionsDirectoryPath()
    {
        var selected = GetSelectedSession();
        if (selected is not null)
        {
            var sessionDirectory = Path.GetDirectoryName(selected.StorePath);
            if (!string.IsNullOrWhiteSpace(sessionDirectory))
            {
                return sessionDirectory;
            }
        }

        var attempted = _sessionLoadResult.AttemptedStorePaths.FirstOrDefault(File.Exists);
        if (!string.IsNullOrWhiteSpace(attempted))
        {
            var attemptedDirectory = Path.GetDirectoryName(attempted);
            if (!string.IsNullOrWhiteSpace(attemptedDirectory))
            {
                return attemptedDirectory;
            }
        }

        return _paths.AgentsDirectory;
    }

    private IReadOnlyList<string> ResolveSessionStorePaths(string? configuredTemplate)
    {
        var discovered = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var defaultPath in _sessionStoreService.DiscoverDefaultStorePaths())
        {
            discovered.Add(defaultPath);
        }

        if (string.IsNullOrWhiteSpace(configuredTemplate))
        {
            return discovered.ToList();
        }

        var normalizedTemplate = NormalizeConfiguredPath(configuredTemplate!);
        if (!normalizedTemplate.Contains("{agentId}", StringComparison.Ordinal))
        {
            discovered.Add(normalizedTemplate);
            return discovered.ToList();
        }

        foreach (var candidate in DiscoverTemplatedStorePaths(normalizedTemplate))
        {
            discovered.Add(candidate);
        }

        return discovered.ToList();
    }

    private static string NormalizeConfiguredPath(string path)
    {
        const string placeholder = "__AGENT_ID_PLACEHOLDER__";
        var replaced = path.Replace("{agentId}", placeholder, StringComparison.Ordinal);
        var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var normalized = AlisioHostPaths.ExpandUserPath(replaced, userProfile);
        return normalized.Replace(placeholder, "{agentId}", StringComparison.Ordinal);
    }

    private static IReadOnlyList<string> DiscoverTemplatedStorePaths(string normalizedTemplate)
    {
        var tokenIndex = normalizedTemplate.IndexOf("{agentId}", StringComparison.Ordinal);
        if (tokenIndex < 0)
        {
            return Array.Empty<string>();
        }

        var prefix = normalizedTemplate[..tokenIndex];
        var suffix = normalizedTemplate[(tokenIndex + "{agentId}".Length)..];
        var prefixDirectory = prefix.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (!Directory.Exists(prefixDirectory))
        {
            return Array.Empty<string>();
        }

        return Directory
            .GetDirectories(prefixDirectory)
            .Select((directory) => Path.GetFullPath($"{directory}{suffix}"))
            .ToList();
    }

    private static WorkspaceConnectionState ResolveConnectionState(
        HostStateSnapshot snapshot,
        SessionStoreLoadResult sessionLoadResult)
    {
        if (!snapshot.RuntimeAvailable)
        {
            return sessionLoadResult.Sessions.Count > 0
                ? WorkspaceConnectionState.LocalStateOnly
                : WorkspaceConnectionState.Error;
        }

        if (!snapshot.GatewayReachable)
        {
            return sessionLoadResult.Sessions.Count > 0
                ? WorkspaceConnectionState.LocalStateOnly
                : WorkspaceConnectionState.Reconnecting;
        }

        return RequiresSetup(snapshot)
            ? WorkspaceConnectionState.NeedsSetup
            : WorkspaceConnectionState.Ready;
    }

    private static HostCapabilities BuildCapabilities(
        HostStateSnapshot snapshot,
        SessionStoreLoadResult sessionLoadResult)
    {
        return new HostCapabilities(
            NativeWorkspaceNavigation: true,
            SessionTranscriptBrowsing: sessionLoadResult.Sessions.Count > 0,
            RuntimeReconnect: snapshot.RuntimeAvailable,
            OpenExternal: true,
            RevealLogs: true,
            RevealWorkspace: true,
            OpenWindowsSettings: true,
            LocalComputer: false,
            MessageCompose: false);
    }

    private static bool RequiresSetup(HostStateSnapshot snapshot)
    {
        return snapshot.ConnectionRequired ||
               !snapshot.SignedIn ||
               !snapshot.AccountReady ||
               !snapshot.ProviderReady ||
               !snapshot.ChatReady ||
               !string.Equals(snapshot.StartupState, "ready", StringComparison.OrdinalIgnoreCase);
    }

    private string ResolveWorkspaceDirectory(HostConfigSnapshot configSnapshot)
    {
        return !string.IsNullOrWhiteSpace(configSnapshot.WorkspaceDirectory)
            ? configSnapshot.WorkspaceDirectory!
            : _paths.DefaultWorkspaceDirectory;
    }

    private SessionSummary? GetSelectedSession()
    {
        var selected = _sessionLoadResult.Sessions.FirstOrDefault(
            (session) => string.Equals(session.Key, _selectedSessionKey, StringComparison.Ordinal));
        if (selected is not null)
        {
            return selected;
        }

        selected = _sessionLoadResult.Sessions.FirstOrDefault(
            (session) => string.Equals(session.Key, _snapshot?.MainSessionKey, StringComparison.OrdinalIgnoreCase));
        if (selected is not null)
        {
            _selectedSessionKey = selected.Key;
            return selected;
        }

        selected = _sessionLoadResult.Sessions.FirstOrDefault();
        if (selected is not null)
        {
            _selectedSessionKey = selected.Key;
        }

        return selected;
    }

    private async void RefreshButton_Click(object sender, RoutedEventArgs e)
    {
        await RefreshSnapshotAsync(showSuccessBanner: true);
    }

    private void ChatPaneButton_Click(object sender, RoutedEventArgs e)
    {
        _activePane = SurfacePane.Chat;
        ApplyActivePane();
    }

    private void WorkspacePaneButton_Click(object sender, RoutedEventArgs e)
    {
        _activePane = SurfacePane.Workspace;
        ApplyActivePane();
    }

    private async void SessionFilterTextBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (_updatingSessionList)
        {
            return;
        }

        RenderSessionList(_sessionLoadResult.Sessions);
        await LoadSelectedSessionAsync();
    }

    private async void SessionButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button button || button.Tag is not string key)
        {
            return;
        }

        _selectedSessionKey = key;
        _activePane = SurfacePane.Chat;
        ApplySnapshot();
        await LoadSelectedSessionAsync();
    }

    private async void OpenLogsButton_Click(object sender, RoutedEventArgs e)
    {
        await RunActionAsync(
            "failed to open logs directory",
            "Opened the Windows host logs.",
            async () => await _uriLauncher.OpenPathInExplorerAsync(_paths.LogsDirectory));
    }

    private async void OpenWindowsSettingsButton_Click(object sender, RoutedEventArgs e)
    {
        await OpenWindowsSettingsPageAsync("root", "Opened Windows settings.");
    }

    private async void OpenWorkspaceButton_Click(object sender, RoutedEventArgs e)
    {
        await RunActionAsync(
            "failed to open workspace directory",
            "Opened the configured workspace.",
            async () => await _uriLauncher.OpenPathInExplorerAsync(ResolveWorkspaceDirectory(_configSnapshot)));
    }

    private async void OpenConfigButton_Click(object sender, RoutedEventArgs e)
    {
        await RunActionAsync(
            "failed to open config file",
            "Revealed the Alisio config file.",
            async () => await _uriLauncher.OpenPathInExplorerAsync(_paths.ConfigFile));
    }

    private async void OpenSessionsFolderButton_Click(object sender, RoutedEventArgs e)
    {
        await RunActionAsync(
            "failed to open sessions folder",
            "Opened the sessions folder.",
            async () => await _uriLauncher.OpenPathInExplorerAsync(ResolveSessionsDirectoryPath()));
    }

    private async void OpenTranscriptButton_Click(object sender, RoutedEventArgs e)
    {
        var selected = GetSelectedSession();
        if (selected is null || !selected.TranscriptExists)
        {
            ShowBanner("The selected session does not have a persisted transcript yet.", BannerTone.Warning);
            return;
        }

        await RunActionAsync(
            "failed to open transcript file",
            "Revealed the selected transcript.",
            async () => await _uriLauncher.OpenPathInExplorerAsync(selected.TranscriptPath));
    }

    private async void OpenNotificationsSettingsButton_Click(object sender, RoutedEventArgs e)
    {
        await OpenWindowsSettingsPageAsync("notifications", "Opened notification settings.");
    }

    private async void OpenMicrophoneSettingsButton_Click(object sender, RoutedEventArgs e)
    {
        await OpenWindowsSettingsPageAsync("microphone", "Opened microphone privacy settings.");
    }

    private async void OpenCameraSettingsButton_Click(object sender, RoutedEventArgs e)
    {
        await OpenWindowsSettingsPageAsync("camera", "Opened camera privacy settings.");
    }

    private async void OpenLocationSettingsButton_Click(object sender, RoutedEventArgs e)
    {
        await OpenWindowsSettingsPageAsync("location", "Opened location privacy settings.");
    }

    private async void OpenSpeechSettingsButton_Click(object sender, RoutedEventArgs e)
    {
        await OpenWindowsSettingsPageAsync("speech", "Opened speech privacy settings.");
    }

    private async void OpenScreenRecordingSettingsButton_Click(object sender, RoutedEventArgs e)
    {
        await OpenWindowsSettingsPageAsync("screenRecording", "Opened screen recording settings.");
    }

    private async Task OpenWindowsSettingsPageAsync(string page, string successMessage)
    {
        await RunActionAsync(
            $"failed to open Windows settings page {page}",
            successMessage,
            async () =>
            {
                var launched = await _windowsSettingsLauncher.OpenAsync(page);
                if (!launched)
                {
                    throw new InvalidOperationException("Windows did not accept the settings request.");
                }
            });
    }

    private static string ToYesNo(bool value)
    {
        return value ? "Yes" : "No";
    }
}
