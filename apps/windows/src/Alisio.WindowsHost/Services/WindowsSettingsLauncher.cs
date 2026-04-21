namespace Alisio.WindowsHost.Services;

public sealed class WindowsSettingsLauncher
{
    private readonly UriLauncher _uriLauncher;

    public WindowsSettingsLauncher(UriLauncher uriLauncher)
    {
        _uriLauncher = uriLauncher;
    }

    public Task<bool> OpenAsync(string page)
    {
        var settingsUri = page switch
        {
            "camera" => "ms-settings:privacy-webcam",
            "location" => "ms-settings:privacy-location",
            "microphone" => "ms-settings:privacy-microphone",
            "notifications" => "ms-settings:notifications",
            "speech" => "ms-settings:privacy-speech",
            "screenRecording" => "ms-settings:privacy-graphicscaptureprogrammatic",
            _ => "ms-settings:",
        };

        return _uriLauncher.OpenExternalAsync(settingsUri);
    }
}
