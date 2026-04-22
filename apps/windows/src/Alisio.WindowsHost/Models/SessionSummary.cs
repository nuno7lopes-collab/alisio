namespace Alisio.WindowsHost.Models;

public sealed record SessionSummary(
    string Key,
    string SessionId,
    string AgentId,
    string DisplayName,
    string Kind,
    string? Model,
    string? Status,
    string StorePath,
    string TranscriptPath,
    bool TranscriptExists,
    DateTimeOffset? UpdatedAt,
    bool IsMainSession);
