namespace Alisio.WindowsHost.Models;

public enum WorkspaceConnectionState
{
    Ready,
    Reconnecting,
    LocalStateOnly,
    NeedsSetup,
    Error,
}
