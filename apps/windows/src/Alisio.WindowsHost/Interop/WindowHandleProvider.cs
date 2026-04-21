using Microsoft.UI.Xaml;
using WinRT.Interop;

namespace Alisio.WindowsHost.Interop;

public static class WindowHandleProvider
{
    public static IntPtr GetWindowHandle(Window window)
    {
        return WindowNative.GetWindowHandle(window);
    }
}
