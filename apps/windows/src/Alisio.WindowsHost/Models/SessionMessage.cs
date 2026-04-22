namespace Alisio.WindowsHost.Models;

public sealed record SessionMessage(
    string Id,
    string Role,
    string Title,
    string Body,
    DateTimeOffset? Timestamp,
    bool IsCallout,
    string? Kind);
