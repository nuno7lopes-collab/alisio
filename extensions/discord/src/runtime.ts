import type { PluginRuntime } from "alisio/plugin-sdk/core";
import { createPluginRuntimeStore } from "alisio/plugin-sdk/runtime-store";

const { setRuntime: setDiscordRuntime, getRuntime: getDiscordRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Discord runtime not initialized");
export { getDiscordRuntime, setDiscordRuntime };
