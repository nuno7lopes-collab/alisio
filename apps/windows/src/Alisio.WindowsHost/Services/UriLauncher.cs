using System.Diagnostics;
using Windows.System;

namespace Alisio.WindowsHost.Services;

public sealed class UriLauncher
{
    private readonly HostLogger _logger;

    public UriLauncher(HostLogger logger)
    {
        _logger = logger;
    }

    public async Task<bool> OpenExternalAsync(string rawUri)
    {
        if (!Uri.TryCreate(rawUri, UriKind.Absolute, out var uri))
        {
            throw new InvalidOperationException($"Expected an absolute URI, got '{rawUri}'.");
        }

        await _logger.WriteAsync($"open external uri={uri}");
        return await Launcher.LaunchUriAsync(uri);
    }

    public async Task OpenPathInExplorerAsync(string path)
    {
        var fullPath = Path.GetFullPath(path);
        if (!Directory.Exists(fullPath) && !File.Exists(fullPath))
        {
            throw new InvalidOperationException($"Path does not exist: {fullPath}");
        }

        await _logger.WriteAsync($"open explorer path={fullPath}");
        var arguments = File.Exists(fullPath)
            ? $"/select,\"{fullPath}\""
            : $"\"{fullPath}\"";
        Process.Start(new ProcessStartInfo
        {
            FileName = "explorer.exe",
            Arguments = arguments,
            UseShellExecute = true,
        });
    }
}
