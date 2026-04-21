using System.Text.Json;
using Alisio.WindowsHost.Models;

namespace Alisio.WindowsHost.Services;

public static class HostPreferenceStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    public static HostPreferences Load(string path)
    {
        try
        {
            if (!File.Exists(path))
            {
                return new HostPreferences();
            }

            var raw = File.ReadAllText(path);
            var parsed = JsonSerializer.Deserialize<HostPreferences>(raw, JsonOptions);
            return parsed ?? new HostPreferences();
        }
        catch
        {
            return new HostPreferences();
        }
    }

    public static void Save(string path, HostPreferences preferences)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var raw = JsonSerializer.Serialize(preferences, JsonOptions);
        File.WriteAllText(path, raw);
    }
}
