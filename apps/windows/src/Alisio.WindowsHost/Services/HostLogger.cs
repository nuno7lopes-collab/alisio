using System.Text;

namespace Alisio.WindowsHost.Services;

public sealed class HostLogger
{
    private readonly SemaphoreSlim _writeGate = new(1, 1);
    private readonly string _logFilePath;

    public HostLogger(AlisioHostPaths paths)
    {
        Directory.CreateDirectory(paths.LogsDirectory);
        _logFilePath = Path.Combine(paths.LogsDirectory, "host.log");
    }

    public string LogFilePath => _logFilePath;

    public async Task WriteAsync(string message, Exception? error = null)
    {
        var line = new StringBuilder()
            .Append('[')
            .Append(DateTimeOffset.UtcNow.ToString("O"))
            .Append("] ")
            .Append(message);

        if (error is not null)
        {
            line.Append(" :: ").Append(error);
        }

        await _writeGate.WaitAsync().ConfigureAwait(false);
        try
        {
            await File.AppendAllTextAsync(_logFilePath, line.AppendLine().ToString()).ConfigureAwait(false);
        }
        finally
        {
            _writeGate.Release();
        }
    }
}
