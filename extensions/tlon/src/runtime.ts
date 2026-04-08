import type { PluginRuntime } from "alisio/plugin-sdk/plugin-runtime";
import { createPluginRuntimeStore } from "alisio/plugin-sdk/runtime-store";

const { setRuntime: setTlonRuntime, getRuntime: getTlonRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Tlon runtime not initialized");
export { getTlonRuntime, setTlonRuntime };
