import type { PluginRuntime } from "alisio/plugin-sdk/core";
import { createPluginRuntimeStore } from "alisio/plugin-sdk/runtime-store";

const { setRuntime: setIMessageRuntime, getRuntime: getIMessageRuntime } =
  createPluginRuntimeStore<PluginRuntime>("iMessage runtime not initialized");
export { getIMessageRuntime, setIMessageRuntime };
