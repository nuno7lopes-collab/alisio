import type { PluginRuntime } from "alisio/plugin-sdk/core";
import { createPluginRuntimeStore } from "alisio/plugin-sdk/runtime-store";

const { setRuntime: setSynologyRuntime, getRuntime: getSynologyRuntime } =
  createPluginRuntimeStore<PluginRuntime>(
    "Synology Chat runtime not initialized - plugin not registered",
  );
export { getSynologyRuntime, setSynologyRuntime };
