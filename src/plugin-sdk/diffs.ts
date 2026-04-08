// Narrow plugin-sdk surface for the bundled diffs plugin.
// Keep this list additive and scoped to the bundled diffs surface.

export { definePluginEntry } from "./plugin-entry.js";
export type { AlisioConfig } from "../config/config.js";
export type { AlisioConfig as OpenClawConfig } from "../config/config.js";
export {
  resolvePreferredAlisioTmpDir,
  resolvePreferredAlisioTmpDir as resolvePreferredOpenClawTmpDir,
} from "../infra/tmp-alisio-dir.js";
export type {
  AnyAgentTool,
  OpenClawPluginApi,
  OpenClawPluginConfigSchema,
  OpenClawPluginToolContext,
  PluginLogger,
} from "../plugins/types.js";
