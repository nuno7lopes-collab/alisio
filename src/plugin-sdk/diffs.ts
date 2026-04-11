// Narrow plugin-sdk surface for the bundled diffs plugin.
// Keep this list additive and scoped to the bundled diffs surface.

export { definePluginEntry } from "./plugin-entry.js";
export type { AlisioConfig } from "../config/config.js";
export { resolveGatewayPort } from "../config/paths.js";
export {
  resolvePreferredAlisioTmpDir,
} from "../infra/tmp-alisio-dir.js";
export type {
  AnyAgentTool,
  AlisioPluginApi,
  AlisioPluginConfigSchema,
  AlisioPluginToolContext,
  PluginLogger,
} from "../plugins/types.js";
