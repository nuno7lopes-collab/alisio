import type { PluginRuntime } from "alisio/plugin-sdk/core";
import { createPluginRuntimeStore } from "alisio/plugin-sdk/runtime-store";

const {
  setRuntime: setSlackRuntime,
  clearRuntime: clearSlackRuntime,
  getRuntime: getSlackRuntime,
} = createPluginRuntimeStore<PluginRuntime>("Slack runtime not initialized");
export { clearSlackRuntime, getSlackRuntime, setSlackRuntime };
