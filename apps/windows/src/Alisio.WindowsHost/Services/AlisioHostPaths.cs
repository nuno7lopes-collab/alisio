namespace Alisio.WindowsHost.Services;

public sealed class AlisioHostPaths
{
    public AlisioHostPaths()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        RootDirectory = Path.Combine(localAppData, "Alisio", "windows-host");
        LogsDirectory = Path.Combine(RootDirectory, "logs");
        AlisioStateDirectory = ExpandUserPath(
            Environment.GetEnvironmentVariable("ALISIO_STATE_DIR") ??
            Path.Combine(userProfile, ".alisio"),
            userProfile);
        ConfigFile = ExpandUserPath(
            Environment.GetEnvironmentVariable("ALISIO_CONFIG_PATH") ??
            Path.Combine(AlisioStateDirectory, "alisio.json"),
            userProfile);
        DefaultWorkspaceDirectory = Path.Combine(AlisioStateDirectory, "workspace");
        AgentsDirectory = Path.Combine(AlisioStateDirectory, "agents");
    }

    public string RootDirectory { get; }

    public string LogsDirectory { get; }

    public string AlisioStateDirectory { get; }

    public string ConfigFile { get; }

    public string DefaultWorkspaceDirectory { get; }

    public string AgentsDirectory { get; }

    public static string ExpandUserPath(string input, string userProfile)
    {
        var trimmed = input.Trim();
        if (trimmed.StartsWith("~"))
        {
            trimmed = Path.Combine(
                userProfile,
                trimmed[1..].TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        }

        trimmed = Environment.ExpandEnvironmentVariables(trimmed);
        return Path.GetFullPath(trimmed);
    }
}
