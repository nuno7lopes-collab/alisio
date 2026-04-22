namespace Alisio.WindowsHost.Models;

public sealed record SessionTranscriptLoadResult(
    IReadOnlyList<SessionMessage> Messages,
    bool MissingTranscript,
    string? Error);
