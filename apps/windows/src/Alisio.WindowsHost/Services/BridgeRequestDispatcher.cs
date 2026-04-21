using System.Text.Json;

namespace Alisio.WindowsHost.Services;

public sealed class BridgeRequestDispatcher
{
    private readonly HostStateService _hostStateService;
    private readonly Func<Task> _openNativeSettingsAsync;
    private readonly UriLauncher _uriLauncher;
    private readonly FileAccessService _fileAccessService;
    private readonly HostLogger _logger;

    public BridgeRequestDispatcher(
        HostStateService hostStateService,
        Func<Task> openNativeSettingsAsync,
        UriLauncher uriLauncher,
        FileAccessService fileAccessService,
        HostLogger logger)
    {
        _hostStateService = hostStateService;
        _openNativeSettingsAsync = openNativeSettingsAsync;
        _uriLauncher = uriLauncher;
        _fileAccessService = fileAccessService;
        _logger = logger;
    }

    public async Task<object?> DispatchAsync(string method, JsonElement parameters)
    {
        await _logger.WriteAsync($"bridge request method={method}");
        return method switch
        {
            "getHostState" => _hostStateService.CreateSnapshot(),
            "getShellState" => _hostStateService.CreateLegacyShellState(),
            "openNativeSettings" => await OpenNativeSettingsAsync(),
            "revealLogs" => await RevealLogsAsync(),
            "openExternal" => await OpenExternalAsync(parameters),
            "pickFile" => await PickFileAsync(parameters),
            "pickFolder" => await PickFolderAsync(),
            "setLaunchAtLogin" => throw Unsupported("Windows host v1 does not implement launch at login yet."),
            "requestPermission" => throw Unsupported("Windows host v1 does not implement runtime permission prompts yet."),
            "setVoiceWake" => throw Unsupported("Windows host v1 does not implement voice wake yet."),
            "getDeviceIdentity" => throw Unsupported("Windows host v1 does not expose a managed device identity yet."),
            "signDevicePayload" => throw Unsupported("Windows host v1 does not expose a native signing bridge yet."),
            "rebuildAppFromCheckout" => throw Unsupported("Windows host v1 does not rebuild itself from a checkout yet."),
            _ => throw new InvalidOperationException($"Unknown host bridge method '{method}'."),
        };
    }

    private static Exception Unsupported(string message)
    {
        return new NotSupportedException(message);
    }

    private async Task<object> OpenNativeSettingsAsync()
    {
        await _openNativeSettingsAsync();
        return new { ok = true };
    }

    private async Task<object> RevealLogsAsync()
    {
        await _uriLauncher.OpenPathInExplorerAsync(_hostStateService.CreateSnapshot().LogsDirectory);
        return new { ok = true };
    }

    private async Task<object> OpenExternalAsync(JsonElement parameters)
    {
        var url = ReadRequiredString(parameters, "url");
        var opened = await _uriLauncher.OpenExternalAsync(url);
        return new { ok = opened };
    }

    private async Task<object> PickFileAsync(JsonElement parameters)
    {
        List<string>? fileTypes = null;
        if (parameters.ValueKind == JsonValueKind.Object &&
            parameters.TryGetProperty("fileTypes", out var fileTypesElement) &&
            fileTypesElement.ValueKind == JsonValueKind.Array)
        {
            fileTypes = new List<string>();
            foreach (var item in fileTypesElement.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(item.GetString()))
                {
                    fileTypes.Add(item.GetString()!);
                }
            }
        }

        var result = await _fileAccessService.PickFileAsync(fileTypes);
        return new
        {
            canceled = result.Canceled,
            path = result.Path,
        };
    }

    private async Task<object> PickFolderAsync()
    {
        var result = await _fileAccessService.PickFolderAsync();
        return new
        {
            canceled = result.Canceled,
            path = result.Path,
        };
    }

    private static string ReadRequiredString(JsonElement parameters, string propertyName)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty(propertyName, out var property) ||
            property.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(property.GetString()))
        {
            throw new InvalidOperationException($"Expected non-empty string parameter '{propertyName}'.");
        }

        return property.GetString()!;
    }
}
