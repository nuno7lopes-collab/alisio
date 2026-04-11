import {
  startLazyPluginServiceModule,
  type LazyPluginServiceHandle,
  type AlisioPluginService,
} from "alisio/plugin-sdk/browser-support";

type BrowserControlHandle = LazyPluginServiceHandle | null;

export function createBrowserPluginService(): AlisioPluginService {
  let handle: BrowserControlHandle = null;

  return {
    id: "browser-control",
    start: async () => {
      if (handle) {
        return;
      }
      handle = await startLazyPluginServiceModule({
        skipEnvVar: "ALISIO_SKIP_BROWSER_CONTROL_SERVER",
        overrideEnvVar: "ALISIO_BROWSER_CONTROL_MODULE",
        // Keep the default module import static so compiled builds still bundle it.
        loadDefaultModule: async () => await import("./server.js"),
        startExportNames: [
          "startBrowserControlServiceFromConfig",
          "startBrowserControlServerFromConfig",
        ],
        stopExportNames: ["stopBrowserControlService", "stopBrowserControlServer"],
      });
    },
    stop: async () => {
      const current = handle;
      handle = null;
      if (!current) {
        return;
      }
      await current.stop().catch(() => {});
    },
  };
}
