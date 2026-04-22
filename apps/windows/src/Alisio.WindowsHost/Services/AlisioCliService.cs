using System.Diagnostics;

namespace Alisio.WindowsHost.Services;

public sealed record AlisioCliResolution(
    bool Available,
    string Source,
    string DisplayCommand,
    string? WorkingDirectory,
    string? ExecutablePath,
    IReadOnlyList<string>? BaseArguments,
    string? Error);

public sealed record AlisioCliResult(
    AlisioCliResolution Resolution,
    bool Ok,
    int ExitCode,
    string StandardOutput,
    string StandardError,
    TimeSpan Duration,
    string? ErrorMessage);

public sealed class AlisioCliService
{
    private readonly HostLogger _logger;

    public AlisioCliService(HostLogger logger)
    {
        _logger = logger;
    }

    public AlisioCliResolution Resolve()
    {
        var envCliPath = Environment.GetEnvironmentVariable("ALISIO_WINDOWS_CLI_PATH");
        if (!string.IsNullOrWhiteSpace(envCliPath))
        {
            var explicitPath = Path.GetFullPath(envCliPath);
            if (File.Exists(explicitPath))
            {
                return BuildDirectResolution("environment", explicitPath, null);
            }

            return new AlisioCliResolution(
                Available: false,
                Source: "environment",
                DisplayCommand: explicitPath,
                WorkingDirectory: null,
                ExecutablePath: null,
                BaseArguments: null,
                Error: $"ALISIO_WINDOWS_CLI_PATH does not exist: {explicitPath}");
        }

        var repoRoot = ResolveRepoRoot();
        if (repoRoot is not null)
        {
            var localCli = Path.Combine(
                repoRoot,
                "node_modules",
                ".bin",
                OperatingSystem.IsWindows() ? "alisio.cmd" : "alisio");
            if (File.Exists(localCli))
            {
                return BuildDirectResolution("repo-node-modules", localCli, repoRoot);
            }
        }

        if (TryFindExecutable("alisio", out var alisioPath))
        {
            return BuildDirectResolution("path", alisioPath, null);
        }

        if (repoRoot is not null && TryFindExecutable("pnpm", out var pnpmPath))
        {
            return BuildDirectResolution(
                "repo-pnpm",
                pnpmPath,
                repoRoot,
                ["--silent", "alisio"]);
        }

        if (repoRoot is not null &&
            TryFindExecutable("node", out var nodePath) &&
            ResolveRepoEntrypoint(repoRoot) is { } entrypoint)
        {
            return BuildDirectResolution(
                "repo-node-entrypoint",
                nodePath,
                repoRoot,
                [entrypoint]);
        }

        return new AlisioCliResolution(
            Available: false,
            Source: "missing",
            DisplayCommand: "alisio",
            WorkingDirectory: repoRoot,
            ExecutablePath: null,
            BaseArguments: null,
            Error:
                "Alisio CLI/runtime not found. Install the CLI or run this host from a repo checkout with pnpm dependencies.");
    }

    public async Task<AlisioCliResult> RunAsync(TimeSpan timeout, params string[] arguments)
    {
        var resolution = Resolve();
        if (!resolution.Available || string.IsNullOrWhiteSpace(resolution.ExecutablePath))
        {
            return new AlisioCliResult(
                Resolution: resolution,
                Ok: false,
                ExitCode: -1,
                StandardOutput: string.Empty,
                StandardError: string.Empty,
                Duration: TimeSpan.Zero,
                ErrorMessage: resolution.Error ?? "Alisio CLI/runtime unavailable.");
        }

        using var process = new Process();
        process.StartInfo.FileName = resolution.ExecutablePath;
        process.StartInfo.UseShellExecute = false;
        process.StartInfo.CreateNoWindow = true;
        process.StartInfo.RedirectStandardOutput = true;
        process.StartInfo.RedirectStandardError = true;
        if (!string.IsNullOrWhiteSpace(resolution.WorkingDirectory))
        {
            process.StartInfo.WorkingDirectory = resolution.WorkingDirectory;
        }

        foreach (var baseArgument in resolution.BaseArguments ?? Array.Empty<string>())
        {
            process.StartInfo.ArgumentList.Add(baseArgument);
        }

        foreach (var argument in arguments)
        {
            process.StartInfo.ArgumentList.Add(argument);
        }

        var stopwatch = Stopwatch.StartNew();
        try
        {
            await _logger.WriteAsync(
                $"cli invoke source={resolution.Source} command={resolution.DisplayCommand} args={string.Join(" ", arguments)}");

            process.Start();

            using var timeoutCts = new CancellationTokenSource(timeout);
            var stdoutTask = process.StandardOutput.ReadToEndAsync(timeoutCts.Token);
            var stderrTask = process.StandardError.ReadToEndAsync(timeoutCts.Token);
            await process.WaitForExitAsync(timeoutCts.Token);

            var stdout = await stdoutTask;
            var stderr = await stderrTask;
            stopwatch.Stop();

            var ok = process.ExitCode == 0;
            if (!ok)
            {
                await _logger.WriteAsync(
                    $"cli invoke failed exit={process.ExitCode} stderr={TrimForLog(stderr)} stdout={TrimForLog(stdout)}");
            }

            return new AlisioCliResult(
                Resolution: resolution,
                Ok: ok,
                ExitCode: process.ExitCode,
                StandardOutput: stdout,
                StandardError: stderr,
                Duration: stopwatch.Elapsed,
                ErrorMessage: ok
                    ? null
                    : $"{resolution.DisplayCommand} failed: {FirstNonEmptyLine(stderr) ?? FirstNonEmptyLine(stdout) ?? $"exit code {process.ExitCode}"}");
        }
        catch (OperationCanceledException)
        {
            stopwatch.Stop();
            try
            {
                if (!process.HasExited)
                {
                    process.Kill(entireProcessTree: true);
                }
            }
            catch
            {
                // Best-effort cleanup.
            }

            await _logger.WriteAsync($"cli invoke timed out command={resolution.DisplayCommand}");
            return new AlisioCliResult(
                Resolution: resolution,
                Ok: false,
                ExitCode: -1,
                StandardOutput: string.Empty,
                StandardError: string.Empty,
                Duration: stopwatch.Elapsed,
                ErrorMessage: $"Command timed out after {Math.Max(1, Math.Round(timeout.TotalSeconds))}s.");
        }
        catch (Exception error)
        {
            stopwatch.Stop();
            await _logger.WriteAsync("cli invoke crashed", error);
            return new AlisioCliResult(
                Resolution: resolution,
                Ok: false,
                ExitCode: -1,
                StandardOutput: string.Empty,
                StandardError: string.Empty,
                Duration: stopwatch.Elapsed,
                ErrorMessage: error.Message);
        }
    }

    private static AlisioCliResolution BuildDirectResolution(
        string source,
        string executablePath,
        string? workingDirectory,
        IReadOnlyList<string>? additionalArguments = null)
    {
        if (IsBatchScript(executablePath))
        {
            var commandProcessor = Environment.GetEnvironmentVariable("ComSpec");
            var fileName = !string.IsNullOrWhiteSpace(commandProcessor) ? commandProcessor : "cmd.exe";
            var arguments = new List<string> { "/c", executablePath };
            if (additionalArguments is not null)
            {
                arguments.AddRange(additionalArguments);
            }

            return new AlisioCliResolution(
                Available: true,
                Source: source,
                DisplayCommand: BuildDisplayCommand(executablePath, additionalArguments),
                WorkingDirectory: workingDirectory,
                ExecutablePath: fileName,
                BaseArguments: arguments,
                Error: null);
        }

        return new AlisioCliResolution(
            Available: true,
            Source: source,
            DisplayCommand: BuildDisplayCommand(executablePath, additionalArguments),
            WorkingDirectory: workingDirectory,
            ExecutablePath: executablePath,
            BaseArguments: additionalArguments ?? Array.Empty<string>(),
            Error: null);
    }

    private static string BuildDisplayCommand(
        string executablePath,
        IReadOnlyList<string>? additionalArguments)
    {
        if (additionalArguments is null || additionalArguments.Count == 0)
        {
            return executablePath;
        }

        return $"{executablePath} {string.Join(" ", additionalArguments)}";
    }

    private static string? ResolveRepoRoot()
    {
        var envRoot = Environment.GetEnvironmentVariable("ALISIO_WINDOWS_PROJECT_ROOT");
        if (!string.IsNullOrWhiteSpace(envRoot))
        {
            var explicitRoot = Path.GetFullPath(envRoot);
            if (IsRepoRoot(explicitRoot))
            {
                return explicitRoot;
            }
        }

        foreach (var start in new[] { AppContext.BaseDirectory, Environment.CurrentDirectory })
        {
            var current = new DirectoryInfo(Path.GetFullPath(start));
            for (var depth = 0; depth < 12 && current is not null; depth += 1)
            {
                if (IsRepoRoot(current.FullName))
                {
                    return current.FullName;
                }

                current = current.Parent;
            }
        }

        return null;
    }

    private static bool IsRepoRoot(string directory)
    {
        return File.Exists(Path.Combine(directory, "package.json")) &&
               File.Exists(
                   Path.Combine(
                       directory,
                       "apps",
                       "windows",
                       "src",
                       "Alisio.WindowsHost",
                       "Alisio.WindowsHost.csproj"));
    }

    private static string? ResolveRepoEntrypoint(string repoRoot)
    {
        foreach (var candidate in new[]
                 {
                     Path.Combine(repoRoot, "alisio.mjs"),
                     Path.Combine(repoRoot, "bin", "alisio.js"),
                     Path.Combine(repoRoot, "dist", "index.js"),
                 })
        {
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        return null;
    }

    private static bool TryFindExecutable(string name, out string resolvedPath)
    {
        resolvedPath = string.Empty;

        if (Path.IsPathRooted(name) && File.Exists(name))
        {
            resolvedPath = Path.GetFullPath(name);
            return true;
        }

        var pathValue = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrWhiteSpace(pathValue))
        {
            return false;
        }

        foreach (var rawDirectory in pathValue.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            var directory = rawDirectory.Trim();
            if (string.IsNullOrWhiteSpace(directory) || !Directory.Exists(directory))
            {
                continue;
            }

            foreach (var candidate in EnumerateExecutableCandidates(directory, name))
            {
                if (File.Exists(candidate))
                {
                    resolvedPath = candidate;
                    return true;
                }
            }
        }

        return false;
    }

    private static IEnumerable<string> EnumerateExecutableCandidates(string directory, string name)
    {
        if (OperatingSystem.IsWindows())
        {
            if (!string.IsNullOrWhiteSpace(Path.GetExtension(name)))
            {
                yield return Path.Combine(directory, name);
                yield break;
            }

            foreach (var extension in new[] { ".exe", ".cmd", ".bat" })
            {
                yield return Path.Combine(directory, $"{name}{extension}");
            }

            yield break;
        }

        yield return Path.Combine(directory, name);
    }

    private static bool IsBatchScript(string path)
    {
        var extension = Path.GetExtension(path);
        return extension.Equals(".cmd", StringComparison.OrdinalIgnoreCase) ||
               extension.Equals(".bat", StringComparison.OrdinalIgnoreCase);
    }

    private static string? FirstNonEmptyLine(string text)
    {
        return text
            .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .FirstOrDefault();
    }

    private static string TrimForLog(string text)
    {
        var trimmed = text.Trim();
        if (trimmed.Length <= 280)
        {
            return trimmed;
        }

        return $"{trimmed[..280]}...";
    }
}
