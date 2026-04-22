using System.Text.Json;
using Alisio.WindowsHost.Models;

namespace Alisio.WindowsHost.Services;

public sealed record SessionStoreLoadResult(
    IReadOnlyList<string> AttemptedStorePaths,
    IReadOnlyList<SessionSummary> Sessions,
    IReadOnlyList<string> Warnings);

public sealed class SessionStoreService
{
    private readonly AlisioHostPaths _paths;

    public SessionStoreService(AlisioHostPaths paths)
    {
        _paths = paths;
    }

    public string UserProfileDirectory =>
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

    public IReadOnlyList<string> DiscoverDefaultStorePaths()
    {
        if (!Directory.Exists(_paths.AgentsDirectory))
        {
            return Array.Empty<string>();
        }

        return Directory
            .GetDirectories(_paths.AgentsDirectory)
            .Select((agentDir) => Path.Combine(agentDir, "sessions", "sessions.json"))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public SessionStoreLoadResult LoadSessions(IReadOnlyList<string> storePaths)
    {
        var warnings = new List<string>();
        var sessions = new List<SessionSummary>();
        var attemptedPaths = storePaths
            .Where((path) => !string.IsNullOrWhiteSpace(path))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        foreach (var storePath in attemptedPaths)
        {
            if (!File.Exists(storePath))
            {
                continue;
            }

            try
            {
                using var document = JsonDocument.Parse(File.ReadAllText(storePath));
                if (document.RootElement.ValueKind != JsonValueKind.Object)
                {
                    warnings.Add($"Ignored malformed session store: {storePath}");
                    continue;
                }

                var sessionsDirectory = Path.GetDirectoryName(storePath) ?? string.Empty;
                var agentId = ResolveAgentId(storePath);
                foreach (var property in document.RootElement.EnumerateObject())
                {
                    if (property.Value.ValueKind != JsonValueKind.Object)
                    {
                        continue;
                    }

                    var sessionId = ReadString(property.Value, "sessionId");
                    if (string.IsNullOrWhiteSpace(sessionId))
                    {
                        continue;
                    }

                    var transcriptPath = ResolveTranscriptPath(
                        sessionsDirectory,
                        sessionId!,
                        ReadString(property.Value, "sessionFile"));
                    var updatedAt = ReadDateTimeOffset(property.Value, "updatedAt");
                    var displayName = ResolveDisplayName(property.Name, property.Value);
                    var kind = ResolveKind(property.Name, property.Value);
                    var status = ReadString(property.Value, "status");
                    var model = ReadString(property.Value, "model");

                    sessions.Add(new SessionSummary(
                        Key: property.Name,
                        SessionId: sessionId!,
                        AgentId: agentId,
                        DisplayName: displayName,
                        Kind: kind,
                        Model: model,
                        Status: status,
                        StorePath: storePath,
                        TranscriptPath: transcriptPath,
                        TranscriptExists: File.Exists(transcriptPath),
                        UpdatedAt: updatedAt,
                        IsMainSession: IsMainSession(property.Name)));
                }
            }
            catch (Exception error)
            {
                warnings.Add($"Could not read {storePath}: {error.Message}");
            }
        }

        var ordered = sessions
            .OrderByDescending((session) => session.UpdatedAt ?? DateTimeOffset.MinValue)
            .ThenBy((session) => session.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new SessionStoreLoadResult(
            AttemptedStorePaths: attemptedPaths,
            Sessions: ordered,
            Warnings: warnings);
    }

    public SessionTranscriptLoadResult LoadTranscript(SessionSummary session)
    {
        if (!File.Exists(session.TranscriptPath))
        {
            return new SessionTranscriptLoadResult(
                Messages: Array.Empty<SessionMessage>(),
                MissingTranscript: true,
                Error: null);
        }

        try
        {
            var messages = new List<SessionMessage>();
            foreach (var line in File.ReadLines(session.TranscriptPath))
            {
                if (string.IsNullOrWhiteSpace(line))
                {
                    continue;
                }

                using var document = JsonDocument.Parse(line);
                var root = document.RootElement;
                if (root.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                if (root.TryGetProperty("message", out var message) &&
                    message.ValueKind == JsonValueKind.Object)
                {
                    messages.Add(BuildChatMessage(root, message));
                    continue;
                }

                if (ReadString(root, "type") == "compaction")
                {
                    messages.Add(new SessionMessage(
                        Id: ReadString(root, "id") ?? $"compaction-{messages.Count + 1}",
                        Role: "system",
                        Title: "Compaction",
                        Body: "Earlier turns were compacted before this point.",
                        Timestamp: ReadDateTimeOffset(root, "timestamp"),
                        IsCallout: true,
                        Kind: "compaction"));
                }
            }

            if (messages.Count > 200)
            {
                messages = messages.Skip(messages.Count - 200).ToList();
            }

            return new SessionTranscriptLoadResult(
                Messages: messages,
                MissingTranscript: false,
                Error: null);
        }
        catch (Exception error)
        {
            return new SessionTranscriptLoadResult(
                Messages: Array.Empty<SessionMessage>(),
                MissingTranscript: false,
                Error: error.Message);
        }
    }

    private static SessionMessage BuildChatMessage(JsonElement root, JsonElement message)
    {
        var role = ReadString(message, "role") ?? "assistant";
        return new SessionMessage(
            Id: ReadString(root, "id") ?? Guid.NewGuid().ToString("N"),
            Role: role,
            Title: role switch
            {
                "user" => "You",
                "assistant" => "Alisio",
                "system" => "System",
                _ => ToSentenceCase(role),
            },
            Body: ExtractBody(message),
            Timestamp: ReadDateTimeOffset(message, "timestamp") ?? ReadDateTimeOffset(root, "timestamp"),
            IsCallout: role == "system",
            Kind: null);
    }

    private static string ExtractBody(JsonElement message)
    {
        if (message.TryGetProperty("content", out var content))
        {
            if (content.ValueKind == JsonValueKind.String)
            {
                var text = content.GetString();
                if (!string.IsNullOrWhiteSpace(text))
                {
                    return text!;
                }
            }

            if (content.ValueKind == JsonValueKind.Array)
            {
                var parts = new List<string>();
                foreach (var item in content.EnumerateArray())
                {
                    if (item.ValueKind == JsonValueKind.String)
                    {
                        var text = item.GetString();
                        if (!string.IsNullOrWhiteSpace(text))
                        {
                            parts.Add(text!);
                        }

                        continue;
                    }

                    if (item.ValueKind != JsonValueKind.Object)
                    {
                        continue;
                    }

                    var type = ReadString(item, "type");
                    var textValue = ReadString(item, "text") ?? ReadString(item, "content");
                    switch (type)
                    {
                        case "text":
                        case "input_text":
                        case "output_text":
                            if (!string.IsNullOrWhiteSpace(textValue))
                            {
                                parts.Add(textValue!);
                            }

                            break;
                        case "tool_use":
                        case "tool_call":
                            parts.Add($"Tool call: {ReadString(item, "name") ?? "tool"}");
                            break;
                        case "tool_result":
                        case "tool_output":
                            parts.Add(!string.IsNullOrWhiteSpace(textValue)
                                ? $"Tool result{Environment.NewLine}{textValue}"
                                : "Tool result");
                            break;
                        case "image":
                        case "input_image":
                        case "output_image":
                            parts.Add("Image attachment");
                            break;
                        default:
                            if (!string.IsNullOrWhiteSpace(textValue))
                            {
                                parts.Add(textValue!);
                            }
                            else if (!string.IsNullOrWhiteSpace(type))
                            {
                                parts.Add(ToSentenceCase(type!.Replace('_', ' ')));
                            }

                            break;
                    }
                }

                if (parts.Count > 0)
                {
                    return string.Join(Environment.NewLine + Environment.NewLine, parts);
                }
            }
        }

        return "No renderable text was persisted for this turn.";
    }

    private static string ResolveAgentId(string storePath)
    {
        var sessionsDirectory = Path.GetDirectoryName(storePath);
        var agentDirectory = sessionsDirectory is null ? null : Path.GetDirectoryName(sessionsDirectory);
        return string.IsNullOrWhiteSpace(agentDirectory)
            ? "main"
            : Path.GetFileName(agentDirectory) ?? "main";
    }

    private static string ResolveTranscriptPath(
        string sessionsDirectory,
        string sessionId,
        string? storedRelativePath)
    {
        if (!string.IsNullOrWhiteSpace(storedRelativePath))
        {
            if (Path.IsPathRooted(storedRelativePath))
            {
                return Path.GetFullPath(storedRelativePath);
            }

            return Path.GetFullPath(Path.Combine(sessionsDirectory, storedRelativePath));
        }

        return Path.GetFullPath(Path.Combine(sessionsDirectory, $"{sessionId}.jsonl"));
    }

    private static string ResolveDisplayName(string key, JsonElement session)
    {
        foreach (var propertyName in new[] { "displayName", "label", "subject" })
        {
            var value = ReadString(session, propertyName);
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value!;
            }
        }

        return IsMainSession(key) ? "Main session" : key;
    }

    private static string ResolveKind(string key, JsonElement session)
    {
        var chatType = ReadString(session, "chatType");
        if (!string.IsNullOrWhiteSpace(chatType))
        {
            return ToSentenceCase(chatType!);
        }

        if (key.Equals("global", StringComparison.OrdinalIgnoreCase))
        {
            return "Global";
        }

        if (key.Contains(":group:", StringComparison.OrdinalIgnoreCase))
        {
            return "Group";
        }

        if (key.Contains(":channel:", StringComparison.OrdinalIgnoreCase))
        {
            return "Channel";
        }

        if (IsMainSession(key))
        {
            return "Main";
        }

        return "Session";
    }

    private static bool IsMainSession(string key)
    {
        return key.Equals("main", StringComparison.OrdinalIgnoreCase) ||
               key.EndsWith(":main", StringComparison.OrdinalIgnoreCase);
    }

    private static string? ReadString(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var property) ||
            property.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        var value = property.GetString();
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    private static DateTimeOffset? ReadDateTimeOffset(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var property))
        {
            return null;
        }

        if (property.ValueKind == JsonValueKind.String &&
            DateTimeOffset.TryParse(property.GetString(), out var parsed))
        {
            return parsed;
        }

        if (property.ValueKind == JsonValueKind.Number &&
            property.TryGetInt64(out var milliseconds))
        {
            try
            {
                return DateTimeOffset.FromUnixTimeMilliseconds(milliseconds);
            }
            catch
            {
                return null;
            }
        }

        return null;
    }

    private static string ToSentenceCase(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return value;
        }

        var normalized = value.Trim();
        return char.ToUpperInvariant(normalized[0]) + normalized[1..];
    }
}
