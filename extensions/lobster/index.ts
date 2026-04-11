import { definePluginEntry } from "alisio/plugin-sdk/plugin-entry";
import type { AnyAgentTool, AlisioPluginApi, AlisioPluginToolFactory } from "./runtime-api.js";
import { createLobsterTool } from "./src/lobster-tool.js";

export default definePluginEntry({
  id: "lobster",
  name: "Lobster",
  description: "Optional local shell helper tools",
  register(api: AlisioPluginApi) {
    api.registerTool(
      ((ctx) => {
        if (ctx.sandboxed) {
          return null;
        }
        return createLobsterTool(api) as AnyAgentTool;
      }) as AlisioPluginToolFactory,
      { optional: true },
    );
  },
});
