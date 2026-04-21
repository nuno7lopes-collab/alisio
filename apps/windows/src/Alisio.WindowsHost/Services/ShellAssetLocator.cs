namespace Alisio.WindowsHost.Services;

public sealed record ShellAssetResolution(
    bool Exists,
    string? DirectoryPath,
    string Source,
    string Message);

public sealed class ShellAssetLocator
{
    private readonly AlisioHostPaths _paths;

    public ShellAssetLocator(AlisioHostPaths paths)
    {
        _paths = paths;
    }

    public ShellAssetResolution Resolve()
    {
        var envOverride = Environment.GetEnvironmentVariable("ALISIO_WINDOWS_SHELL_DIR");
        if (TryResolveDirectory(envOverride, out var envDirectory))
        {
            return new ShellAssetResolution(
                true,
                envDirectory,
                "environment",
                "Loaded shared shell from ALISIO_WINDOWS_SHELL_DIR.");
        }

        if (TryResolveDirectory(_paths.StagedShellDirectory, out var stagedDirectory))
        {
            return new ShellAssetResolution(
                true,
                stagedDirectory,
                "staged-assets",
                "Loaded shared shell from staged app assets.");
        }

        var appBase = new DirectoryInfo(AppContext.BaseDirectory);
        foreach (var ancestor in EnumerateAncestors(appBase, 12))
        {
            var candidate = Path.Combine(ancestor.FullName, "ui", "dist");
            if (TryResolveDirectory(candidate, out var repoDirectory))
            {
                return new ShellAssetResolution(
                    true,
                    repoDirectory,
                    "repo-checkout",
                    "Loaded shared shell directly from ui/dist in this checkout.");
            }
        }

        if (TryResolveDirectory(Path.Combine(Environment.CurrentDirectory, "ui", "dist"), out var currentDirectory))
        {
            return new ShellAssetResolution(
                true,
                currentDirectory,
                "working-directory",
                "Loaded shared shell from the current working directory.");
        }

        return new ShellAssetResolution(
            false,
            null,
            "missing",
            "No shared shell was found. Build ui/dist or stage shell assets first.");
    }

    private static bool TryResolveDirectory(string? candidate, out string resolvedDirectory)
    {
        resolvedDirectory = string.Empty;
        if (string.IsNullOrWhiteSpace(candidate))
        {
            return false;
        }

        var fullDirectory = Path.GetFullPath(candidate);
        var indexPath = Path.Combine(fullDirectory, "index.html");
        if (!File.Exists(indexPath))
        {
            return false;
        }

        resolvedDirectory = fullDirectory;
        return true;
    }

    private static IEnumerable<DirectoryInfo> EnumerateAncestors(DirectoryInfo start, int maxDepth)
    {
        var current = start;
        for (var depth = 0; depth < maxDepth && current is not null; depth += 1)
        {
            yield return current;
            current = current.Parent!;
        }
    }
}
