namespace Alisio.WindowsHost.Models;

public sealed class HostPreferences
{
    public int Version { get; set; } = 1;

    public bool ExperimentalShellBridgeEnabled { get; set; }
}
