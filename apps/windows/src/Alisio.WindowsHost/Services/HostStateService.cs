using System.Reflection;
using System.Text.Json;
using Alisio.WindowsHost.Models;

namespace Alisio.WindowsHost.Services;

public sealed class HostStateService
{
    private const string WindowsAppSdkVersion = "1.8.6";
    private const int DefaultGatewayPort = 40705;

    private readonly AlisioHostPaths _paths;
    private readonly HostLogger _logger;
    private readonly AlisioCliService _cliService;

    private sealed record GatewayConfigSnapshot(
        int GatewayPort,
        string ControlUiBasePath,
        string MainSessionKey);

    public HostStateService(
        AlisioHostPaths paths,
        HostLogger logger)
        : this(paths, logger, new AlisioCliService(logger))
    {
    }

    public HostStateService(
        AlisioHostPaths paths,
        HostLogger logger,
        AlisioCliService cliService)
    {
        _paths = paths;
        _logger = logger;
        _cliService = cliService;
    }

    public async Task<HostStateSnapshot> CreateSnapshotAsync()
    {
        var refreshedAtUtc = DateTimeOffset.UtcNow;
        var cliResolution = _cliService.Resolve();
        if (!cliResolution.Available)
        {
            return BuildUnavailableSnapshot(
                refreshedAtUtc,
                cliResolution,
                runtimeAvailable: false,
                runtimeStatus: cliResolution.Error ?? "Alisio CLI/runtime unavailable.",
                nextStep: "runtime",
                lastError: cliResolution.Error);
        }

        var versionResult = await _cliService.RunAsync(TimeSpan.FromSeconds(10), "--version");
        var runtimeVersion = versionResult.Ok ? FirstNonEmptyLine(versionResult.StandardOutput) : null;
        if (!versionResult.Ok)
        {
            return BuildUnavailableSnapshot(
                refreshedAtUtc,
                versionResult.Resolution,
                runtimeAvailable: false,
                runtimeStatus: versionResult.ErrorMessage ?? "Failed to invoke Alisio CLI.",
                nextStep: "runtime",
                lastError: versionResult.ErrorMessage);
        }

        var healthResult = await _cliService.RunAsync(
            TimeSpan.FromSeconds(15),
            "gateway",
            "health",
            "--json");
        if (!healthResult.Ok)
        {
            return BuildUnavailableSnapshot(
                refreshedAtUtc,
                healthResult.Resolution,
                runtimeAvailable: true,
                runtimeStatus: BuildRuntimeStatus(healthResult.Resolution, runtimeVersion),
                runtimeVersion: runtimeVersion,
                nextStep: "gateway",
                lastError: healthResult.ErrorMessage,
                gatewayStatus: healthResult.ErrorMessage ?? "Gateway health probe failed.");
        }

        using var healthDocument = ParseJsonPayload(healthResult.StandardOutput);
        var healthOk = ReadBoolean(healthDocument.RootElement, "ok", defaultValue: true);
        var durationMs = ReadNumber(healthDocument.RootElement, "durationMs");
        var gatewayStatus = healthOk
            ? durationMs is null
                ? "healthy"
                : $"healthy ({Math.Round(durationMs.Value)} ms)"
            : "degraded";

        var bootstrapResult = await _cliService.RunAsync(
            TimeSpan.FromSeconds(15),
            "gateway",
            "call",
            "alisio.bootstrap.get",
            "--json");
        if (!bootstrapResult.Ok)
        {
            return BuildUnavailableSnapshot(
                refreshedAtUtc,
                bootstrapResult.Resolution,
                runtimeAvailable: true,
                runtimeStatus: BuildRuntimeStatus(bootstrapResult.Resolution, runtimeVersion),
                runtimeVersion: runtimeVersion,
                nextStep: "account",
                lastError: bootstrapResult.ErrorMessage,
                gatewayReachable: true,
                gatewayHealthy: healthOk,
                gatewayStatus: gatewayStatus);
        }

        using var bootstrapDocument = ParseJsonPayload(bootstrapResult.StandardOutput);
        var configSnapshot = await ResolveGatewayConfigAsync();

        var startupState = ReadString(bootstrapDocument.RootElement, "startupState") ?? "unknown";
        var nextStep = ReadString(bootstrapDocument.RootElement, "nextStep") ?? "account";
        var connectionRequired = ReadBoolean(bootstrapDocument.RootElement, "connectionRequired");
        var wizardRequired = ReadBoolean(bootstrapDocument.RootElement, "wizardRequired");
        var wizardRunning = ReadBooleanPath(
            bootstrapDocument.RootElement,
            defaultValue: false,
            "wizard",
            "running");
        var accountReady = ReadBoolean(bootstrapDocument.RootElement, "accountReady");
        var providerReady = ReadBoolean(bootstrapDocument.RootElement, "providerReady");
        var authRequired = ReadBoolean(
            bootstrapDocument.RootElement,
            "authRequired",
            defaultValue: true);
        var sessionState = ReadStringPath(
            bootstrapDocument.RootElement,
            "account",
            "session",
            "state") ?? "signed_out";
        var signedIn = string.Equals(sessionState, "signed_in", StringComparison.OrdinalIgnoreCase) ||
                       ReadBooleanPath(
                           bootstrapDocument.RootElement,
                           defaultValue: false,
                           "account",
                           "canonical",
                           "authenticated");
        var cloudAvailable = ReadBooleanPath(
            bootstrapDocument.RootElement,
            defaultValue: false,
            "account",
            "cloud",
            "available");
        var cloudBackend = ReadStringPath(
            bootstrapDocument.RootElement,
            "account",
            "cloud",
            "backend");
        var sharedBackendStatus = cloudAvailable
            ? $"{cloudBackend ?? "shared backend"} connected"
            : $"{cloudBackend ?? "shared backend"} unavailable";
        var accountId = ReadString(bootstrapDocument.RootElement, "accountId") ??
                        ReadStringPath(bootstrapDocument.RootElement, "account", "accountId");
        var displayName = ReadStringPath(
            bootstrapDocument.RootElement,
            "account",
            "profile",
            "displayName");
        var email = ReadStringPath(
            bootstrapDocument.RootElement,
            "account",
            "profile",
            "email");
        var scopeRoot = ReadString(bootstrapDocument.RootElement, "scopeRoot") ?? "account";
        var deviceBinding = ReadStringPath(
            bootstrapDocument.RootElement,
            "deviceBinding",
            "binding");
        var deviceId = ReadStringPath(
            bootstrapDocument.RootElement,
            "deviceBinding",
            "deviceId");
        var deviceLabel = ReadStringPath(
            bootstrapDocument.RootElement,
            "deviceBinding",
            "label");
        var devicePlatform = ReadStringPath(
            bootstrapDocument.RootElement,
            "deviceBinding",
            "platform");
        var backendSharedResources = ReadStringArrayPath(
            bootstrapDocument.RootElement,
            "runtimeContract",
            "backendShared");
        var localRuntimeResources = ReadStringArrayPath(
            bootstrapDocument.RootElement,
            "runtimeContract",
            "localRuntime");
        var sessionFoundationReady = healthOk && signedIn;
        var chatReady = healthOk &&
                        signedIn &&
                        accountReady &&
                        providerReady &&
                        !connectionRequired &&
                        string.Equals(nextStep, "ready", StringComparison.OrdinalIgnoreCase);

        return new HostStateSnapshot(
            Platform: "windows",
            AppVersion: ResolveAppVersion(),
            WindowsAppSdkVersion: WindowsAppSdkVersion,
            RootDirectory: _paths.RootDirectory,
            LogsDirectory: _paths.LogsDirectory,
            RefreshedAtUtc: refreshedAtUtc,
            RuntimeSource: cliResolution.Source,
            RuntimeCommand: cliResolution.DisplayCommand,
            RuntimeWorkingDirectory: cliResolution.WorkingDirectory,
            RuntimeAvailable: true,
            RuntimeStatus: BuildRuntimeStatus(cliResolution, runtimeVersion),
            RuntimeVersion: runtimeVersion,
            GatewayReachable: true,
            GatewayHealthy: healthOk,
            GatewayStatus: gatewayStatus,
            GatewayPort: configSnapshot.GatewayPort,
            ControlUiOrigin: BuildControlUiOrigin(configSnapshot.GatewayPort),
            ControlUiBasePath: configSnapshot.ControlUiBasePath,
            SharedBackendConnected: cloudAvailable,
            SharedBackendStatus: sharedBackendStatus,
            StartupState: startupState,
            NextStep: nextStep,
            ConnectionRequired: connectionRequired,
            WizardRequired: wizardRequired,
            WizardRunning: wizardRunning,
            AuthRequired: authRequired,
            SignedIn: signedIn,
            AccountReady: accountReady,
            ProviderReady: providerReady,
            CloudAvailable: cloudAvailable,
            CloudBackend: cloudBackend,
            ScopeRoot: scopeRoot,
            DeviceBinding: deviceBinding,
            DeviceId: deviceId,
            DeviceLabel: deviceLabel,
            DevicePlatform: devicePlatform,
            BackendSharedResources: backendSharedResources,
            LocalRuntimeResources: localRuntimeResources,
            SessionFoundationReady: sessionFoundationReady,
            ChatReady: chatReady,
            MainSessionKey: configSnapshot.MainSessionKey,
            AccountId: accountId,
            DisplayName: displayName,
            Email: email,
            LastError: null);
    }

    private HostStateSnapshot BuildUnavailableSnapshot(
        DateTimeOffset refreshedAtUtc,
        AlisioCliResolution resolution,
        bool runtimeAvailable,
        string runtimeStatus,
        string nextStep,
        string? lastError,
        string? runtimeVersion = null,
        bool gatewayReachable = false,
        bool gatewayHealthy = false,
        string? gatewayStatus = null)
    {
        return new HostStateSnapshot(
            Platform: "windows",
            AppVersion: ResolveAppVersion(),
            WindowsAppSdkVersion: WindowsAppSdkVersion,
            RootDirectory: _paths.RootDirectory,
            LogsDirectory: _paths.LogsDirectory,
            RefreshedAtUtc: refreshedAtUtc,
            RuntimeSource: resolution.Source,
            RuntimeCommand: resolution.DisplayCommand,
            RuntimeWorkingDirectory: resolution.WorkingDirectory,
            RuntimeAvailable: runtimeAvailable,
            RuntimeStatus: runtimeStatus,
            RuntimeVersion: runtimeVersion,
            GatewayReachable: gatewayReachable,
            GatewayHealthy: gatewayHealthy,
            GatewayStatus: gatewayStatus ?? "unavailable",
            GatewayPort: DefaultGatewayPort,
            ControlUiOrigin: BuildControlUiOrigin(DefaultGatewayPort),
            ControlUiBasePath: string.Empty,
            SharedBackendConnected: false,
            SharedBackendStatus: "unavailable",
            StartupState: "unknown",
            NextStep: nextStep,
            ConnectionRequired: false,
            WizardRequired: false,
            WizardRunning: false,
            AuthRequired: true,
            SignedIn: false,
            AccountReady: false,
            ProviderReady: false,
            CloudAvailable: false,
            CloudBackend: null,
            ScopeRoot: "account",
            DeviceBinding: null,
            DeviceId: null,
            DeviceLabel: null,
            DevicePlatform: null,
            BackendSharedResources: Array.Empty<string>(),
            LocalRuntimeResources: Array.Empty<string>(),
            SessionFoundationReady: false,
            ChatReady: false,
            MainSessionKey: "main",
            AccountId: null,
            DisplayName: null,
            Email: null,
            LastError: lastError);
    }

    private async Task<GatewayConfigSnapshot> ResolveGatewayConfigAsync()
    {
        try
        {
            var configResult = await _cliService.RunAsync(
                TimeSpan.FromSeconds(10),
                "gateway",
                "call",
                "config.get",
                "--json");
            if (!configResult.Ok)
            {
                return new GatewayConfigSnapshot(DefaultGatewayPort, string.Empty, "main");
            }

            using var configDocument = ParseJsonPayload(configResult.StandardOutput);
            var mainSessionKey = string.Equals(
                ReadStringPath(configDocument.RootElement, "config", "session", "scope"),
                "global",
                StringComparison.OrdinalIgnoreCase)
                ? "global"
                : "main";
            var configuredPort = ReadInt32Path(configDocument.RootElement, "config", "gateway", "port");
            var gatewayPort = configuredPort is > 0 ? configuredPort.Value : DefaultGatewayPort;
            var controlUiBasePath = NormalizeControlUiBasePath(
                ReadStringPath(
                    configDocument.RootElement,
                    "config",
                    "gateway",
                    "controlUi",
                    "basePath"));

            return new GatewayConfigSnapshot(gatewayPort, controlUiBasePath, mainSessionKey);
        }
        catch (Exception error)
        {
            await _logger.WriteAsync("failed to resolve gateway config for Windows host", error);
            return new GatewayConfigSnapshot(DefaultGatewayPort, string.Empty, "main");
        }
    }

    private static string BuildRuntimeStatus(AlisioCliResolution resolution, string? runtimeVersion)
    {
        return runtimeVersion is null
            ? $"available via {resolution.Source}"
            : $"available via {resolution.Source} ({runtimeVersion})";
    }

    private static string ResolveAppVersion()
    {
        var version = Assembly.GetExecutingAssembly().GetName().Version;
        return version is null ? "0.1.0-dev" : version.ToString();
    }

    private static string BuildControlUiOrigin(int gatewayPort)
    {
        return $"http://127.0.0.1:{gatewayPort}";
    }

    private static string NormalizeControlUiBasePath(string? basePath)
    {
        if (string.IsNullOrWhiteSpace(basePath))
        {
            return string.Empty;
        }

        var normalized = basePath.Trim();
        if (!normalized.StartsWith('/'))
        {
            normalized = $"/{normalized}";
        }

        if (string.Equals(normalized, "/", StringComparison.Ordinal))
        {
            return string.Empty;
        }

        return normalized.EndsWith('/', StringComparison.Ordinal)
            ? normalized[..^1]
            : normalized;
    }

    private static JsonDocument ParseJsonPayload(string raw)
    {
        try
        {
            return JsonDocument.Parse(raw);
        }
        catch (JsonException)
        {
            var firstBrace = raw.IndexOf('{');
            var lastBrace = raw.LastIndexOf('}');
            if (firstBrace >= 0 && lastBrace > firstBrace)
            {
                return JsonDocument.Parse(raw[firstBrace..(lastBrace + 1)]);
            }

            throw;
        }
    }

    private static string? ReadString(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var property) &&
               property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;
    }

    private static string? ReadStringPath(JsonElement element, params string[] path)
    {
        if (!TryReadPath(element, out var property, path))
        {
            return null;
        }

        return property.ValueKind == JsonValueKind.String ? property.GetString() : null;
    }

    private static IReadOnlyList<string> ReadStringArrayPath(JsonElement element, params string[] path)
    {
        if (!TryReadPath(element, out var property, path) || property.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<string>();
        }

        var values = new List<string>();
        foreach (var item in property.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(item.GetString()))
            {
                values.Add(item.GetString()!);
            }
        }

        return values;
    }

    private static bool ReadBoolean(
        JsonElement element,
        string propertyName,
        bool defaultValue = false)
    {
        return element.TryGetProperty(propertyName, out var property) &&
               (property.ValueKind == JsonValueKind.True || property.ValueKind == JsonValueKind.False)
            ? property.GetBoolean()
            : defaultValue;
    }

    private static bool ReadBooleanPath(
        JsonElement element,
        bool defaultValue,
        params string[] path)
    {
        if (!TryReadPath(element, out var property, path))
        {
            return defaultValue;
        }

        return property.ValueKind == JsonValueKind.True || property.ValueKind == JsonValueKind.False
            ? property.GetBoolean()
            : defaultValue;
    }

    private static double? ReadNumber(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var property) &&
               property.ValueKind == JsonValueKind.Number &&
               property.TryGetDouble(out var value)
            ? value
            : null;
    }

    private static int? ReadInt32Path(JsonElement element, params string[] path)
    {
        if (!TryReadPath(element, out var property, path))
        {
            return null;
        }

        if (property.ValueKind == JsonValueKind.Number && property.TryGetInt32(out var number))
        {
            return number;
        }

        if (property.ValueKind == JsonValueKind.String &&
            int.TryParse(property.GetString(), out var parsed))
        {
            return parsed;
        }

        return null;
    }

    private static bool TryReadPath(
        JsonElement element,
        out JsonElement value,
        params string[] path)
    {
        value = element;
        foreach (var segment in path)
        {
            if (value.ValueKind != JsonValueKind.Object ||
                !value.TryGetProperty(segment, out value))
            {
                return false;
            }
        }

        return true;
    }

    private static string? FirstNonEmptyLine(string text)
    {
        return text
            .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .FirstOrDefault();
    }
}
