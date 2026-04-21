using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace Alisio.WindowsHost.Services;

public sealed class WebViewHostBridge
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private readonly AlisioHostPaths _paths;
    private readonly BridgeRequestDispatcher _dispatcher;
    private readonly HostLogger _logger;

    private CoreWebView2? _coreWebView;
    private string? _scriptId;

    public WebViewHostBridge(
        AlisioHostPaths paths,
        BridgeRequestDispatcher dispatcher,
        HostLogger logger)
    {
        _paths = paths;
        _dispatcher = dispatcher;
        _logger = logger;
    }

    public async Task ConfigureAsync(CoreWebView2 coreWebView, bool injectBridge)
    {
        if (!ReferenceEquals(_coreWebView, coreWebView))
        {
            if (_coreWebView is not null)
            {
                _coreWebView.WebMessageReceived -= OnWebMessageReceived;
            }

            _coreWebView = coreWebView;
            _scriptId = null;
            _coreWebView.WebMessageReceived += OnWebMessageReceived;
        }

        if (!injectBridge)
        {
            RemoveInjectedScript();
            await _logger.WriteAsync("bridge injection disabled");
            return;
        }

        if (_scriptId is not null)
        {
            return;
        }

        var script = await File.ReadAllTextAsync(_paths.BridgeScriptPath);
        _scriptId = await _coreWebView!.AddScriptToExecuteOnDocumentCreatedAsync(script);
        await _logger.WriteAsync("bridge injection enabled");
    }

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        try
        {
            using var document = JsonDocument.Parse(args.WebMessageAsJson);
            var root = document.RootElement;

            if (root.ValueKind != JsonValueKind.Object ||
                !root.TryGetProperty("kind", out var kindProperty) ||
                kindProperty.GetString() != "alisio-host-request")
            {
                return;
            }

            var id = root.GetProperty("id").GetString() ?? string.Empty;
            var method = root.GetProperty("method").GetString() ?? string.Empty;
            var parameters = root.TryGetProperty("params", out var paramsProperty)
                ? paramsProperty
                : default;

            var result = await _dispatcher.DispatchAsync(method, parameters);
            PostResponse(id, ok: true, result: result, error: null);
        }
        catch (Exception error)
        {
            var id = TryExtractId(args.WebMessageAsJson);
            await _logger.WriteAsync("bridge request failed", error);
            PostResponse(id, ok: false, result: null, error: new
            {
                code = "windows_host_error",
                message = error.Message,
            });
        }
    }

    private void PostResponse(string id, bool ok, object? result, object? error)
    {
        if (_coreWebView is null)
        {
            return;
        }

        var payload = JsonSerializer.Serialize(new
        {
            kind = "alisio-host-response",
            id,
            ok,
            result,
            error,
        }, JsonOptions);

        _coreWebView.PostWebMessageAsJson(payload);
    }

    private void RemoveInjectedScript()
    {
        if (_coreWebView is null || _scriptId is null)
        {
            return;
        }

        _coreWebView.RemoveScriptToExecuteOnDocumentCreated(_scriptId);
        _scriptId = null;
    }

    private static string TryExtractId(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.TryGetProperty("id", out var idProperty) &&
                idProperty.ValueKind == JsonValueKind.String)
            {
                return idProperty.GetString() ?? string.Empty;
            }
        }
        catch
        {
            // best-effort
        }

        return string.Empty;
    }
}
