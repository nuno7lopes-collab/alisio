using Alisio.WindowsHost.Interop;
using Microsoft.UI.Xaml;
using Windows.Storage.Pickers;
using WinRT.Interop;

namespace Alisio.WindowsHost.Services;

public sealed record FilePickerResult(bool Canceled, string? Path);

public sealed class FileAccessService
{
    private readonly Window _window;
    private readonly HostLogger _logger;

    public FileAccessService(Window window, HostLogger logger)
    {
        _window = window;
        _logger = logger;
    }

    public async Task<FilePickerResult> PickFileAsync(IReadOnlyList<string>? fileTypes = null)
    {
        var picker = new FileOpenPicker();
        InitializeWithWindow.Initialize(picker, WindowHandleProvider.GetWindowHandle(_window));

        foreach (var fileType in fileTypes is { Count: > 0 } ? fileTypes : new[] { "*" })
        {
            picker.FileTypeFilter.Add(fileType);
        }

        var file = await picker.PickSingleFileAsync();
        var selectedPath = file?.Path;
        await _logger.WriteAsync($"pick file canceled={file is null} path={selectedPath ?? "<none>"}");
        return new FilePickerResult(file is null, selectedPath);
    }

    public async Task<FilePickerResult> PickFolderAsync()
    {
        var picker = new FolderPicker();
        InitializeWithWindow.Initialize(picker, WindowHandleProvider.GetWindowHandle(_window));
        picker.FileTypeFilter.Add("*");

        var folder = await picker.PickSingleFolderAsync();
        var selectedPath = folder?.Path;
        await _logger.WriteAsync($"pick folder canceled={folder is null} path={selectedPath ?? "<none>"}");
        return new FilePickerResult(folder is null, selectedPath);
    }
}
