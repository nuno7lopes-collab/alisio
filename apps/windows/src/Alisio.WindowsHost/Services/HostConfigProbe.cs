using System.Text;
using System.Text.RegularExpressions;

namespace Alisio.WindowsHost.Services;

public sealed record HostConfigSnapshot(
    bool Exists,
    string? WorkspaceDirectory,
    string? SessionStoreTemplate,
    string? GatewayMode,
    string? GatewayRemoteUrl,
    string? Error);

public sealed class HostConfigProbe
{
    private readonly AlisioHostPaths _paths;

    public HostConfigProbe(AlisioHostPaths paths)
    {
        _paths = paths;
    }

    public HostConfigSnapshot Read()
    {
        if (!File.Exists(_paths.ConfigFile))
        {
            return new HostConfigSnapshot(
                Exists: false,
                WorkspaceDirectory: null,
                SessionStoreTemplate: null,
                GatewayMode: null,
                GatewayRemoteUrl: null,
                Error: null);
        }

        try
        {
            var raw = File.ReadAllText(_paths.ConfigFile);
            var sanitized = StripComments(raw);

            var workspace = ExtractNestedString(sanitized, "agents", "defaults", "workspace");
            var store = ExtractNestedString(sanitized, "session", "store");
            var gatewayMode = ExtractNestedString(sanitized, "gateway", "mode");
            var gatewayUrl = ExtractNestedString(sanitized, "gateway", "remote", "url");

            return new HostConfigSnapshot(
                Exists: true,
                WorkspaceDirectory: !string.IsNullOrWhiteSpace(workspace)
                    ? AlisioHostPaths.ExpandUserPath(workspace!, UserProfileDirectory)
                    : null,
                SessionStoreTemplate: store,
                GatewayMode: gatewayMode,
                GatewayRemoteUrl: gatewayUrl,
                Error: null);
        }
        catch (Exception error)
        {
            return new HostConfigSnapshot(
                Exists: true,
                WorkspaceDirectory: null,
                SessionStoreTemplate: null,
                GatewayMode: null,
                GatewayRemoteUrl: null,
                Error: $"Could not read {_paths.ConfigFile}: {error.Message}");
        }
    }

    private string UserProfileDirectory =>
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

    private static string StripComments(string raw)
    {
        var builder = new StringBuilder(raw.Length);
        var inString = false;
        var stringDelimiter = '\0';
        var escape = false;
        var inLineComment = false;
        var inBlockComment = false;

        for (var index = 0; index < raw.Length; index += 1)
        {
            var current = raw[index];
            var next = index + 1 < raw.Length ? raw[index + 1] : '\0';

            if (inLineComment)
            {
                if (current == '\r' || current == '\n')
                {
                    inLineComment = false;
                    builder.Append(current);
                }

                continue;
            }

            if (inBlockComment)
            {
                if (current == '*' && next == '/')
                {
                    inBlockComment = false;
                    index += 1;
                }

                continue;
            }

            if (inString)
            {
                builder.Append(current);
                if (escape)
                {
                    escape = false;
                    continue;
                }

                if (current == '\\')
                {
                    escape = true;
                    continue;
                }

                if (current == stringDelimiter)
                {
                    inString = false;
                    stringDelimiter = '\0';
                }

                continue;
            }

            if (current == '"' || current == '\'')
            {
                inString = true;
                stringDelimiter = current;
                builder.Append(current);
                continue;
            }

            if (current == '/' && next == '/')
            {
                inLineComment = true;
                index += 1;
                continue;
            }

            if (current == '/' && next == '*')
            {
                inBlockComment = true;
                index += 1;
                continue;
            }

            builder.Append(current);
        }

        return builder.ToString();
    }

    private static string? ExtractNestedString(string source, params string[] keys)
    {
        if (keys.Length == 0)
        {
            return null;
        }

        var offset = 0;
        for (var index = 0; index < keys.Length - 1; index += 1)
        {
            var prefixMatch = Regex.Match(
                source[offset..],
                $@"\b{Regex.Escape(keys[index])}\b",
                RegexOptions.IgnoreCase);
            if (!prefixMatch.Success)
            {
                return null;
            }

            offset += prefixMatch.Index + prefixMatch.Length;
        }

        var pattern =
            $@"\b{Regex.Escape(keys[^1])}\b\s*:\s*(?:(?:""(?<double>(?:\\.|[^""])*)"")|(?:'(?<single>(?:\\.|[^'])*)')|(?<bare>[A-Za-z0-9._:/{{}}\\-]+))";
        var finalMatch = Regex.Match(
            source[offset..],
            pattern,
            RegexOptions.IgnoreCase | RegexOptions.Singleline);
        if (!finalMatch.Success)
        {
            return null;
        }

        if (finalMatch.Groups["double"].Success)
        {
            return Regex.Unescape(finalMatch.Groups["double"].Value);
        }

        if (finalMatch.Groups["single"].Success)
        {
            return Regex.Unescape(finalMatch.Groups["single"].Value);
        }

        if (finalMatch.Groups["bare"].Success)
        {
            var bare = finalMatch.Groups["bare"].Value.Trim();
            return string.IsNullOrWhiteSpace(bare) ? null : bare;
        }

        return null;
    }
}
