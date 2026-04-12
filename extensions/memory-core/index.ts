import { definePluginEntry } from "alisio/plugin-sdk/plugin-entry";
import { registerMemoryCli } from "./src/cli.js";
import {
  buildMemoryFlushPlan,
  DEFAULT_MEMORY_FLUSH_FORCE_TRANSCRIPT_BYTES,
  DEFAULT_MEMORY_FLUSH_PROMPT,
  DEFAULT_MEMORY_FLUSH_SOFT_TOKENS,
} from "./src/flush-plan.js";
import { handleMemoryGraphGatewayRequest } from "./src/gateway.js";
import {
  handleMemoryFilesGetGatewayRequest,
  handleMemoryFilesListGatewayRequest,
} from "./src/gateway/files.js";
import {
  handleMemoryExportGatewayRequest,
  handleMemoryTraceGetGatewayRequest,
  handleMemoryWikiGetGatewayRequest,
  handleMemoryWikiHistoryGatewayRequest,
  handleMemoryWikiListGatewayRequest,
  handleMemoryWikiUpdateGatewayRequest,
} from "./src/gateway.native.js";
import { registerBuiltInMemoryEmbeddingProviders } from "./src/memory/provider-adapters.js";
import { buildPromptSection } from "./src/prompt-section.js";
import { memoryRuntime } from "./src/runtime-provider.js";
import { createMemoryGetTool, createMemoryGraphTool, createMemorySearchTool } from "./src/tools.js";
export {
  buildMemoryFlushPlan,
  DEFAULT_MEMORY_FLUSH_FORCE_TRANSCRIPT_BYTES,
  DEFAULT_MEMORY_FLUSH_PROMPT,
  DEFAULT_MEMORY_FLUSH_SOFT_TOKENS,
} from "./src/flush-plan.js";
export { buildPromptSection } from "./src/prompt-section.js";

export default definePluginEntry({
  id: "memory-core",
  name: "Memory (Core)",
  description: "Native memory retrieval tools and CLI",
  kind: "memory",
  register(api) {
    registerBuiltInMemoryEmbeddingProviders(api);
    api.registerMemoryPromptSection(buildPromptSection);
    api.registerMemoryFlushPlan(buildMemoryFlushPlan);
    api.registerMemoryRuntime(memoryRuntime);
    api.registerGatewayMethod("memory.graph", handleMemoryGraphGatewayRequest, {
      scope: "operator.read",
    });
    api.registerGatewayMethod("memory.wiki.list", handleMemoryWikiListGatewayRequest, {
      scope: "operator.read",
    });
    api.registerGatewayMethod("memory.wiki.get", handleMemoryWikiGetGatewayRequest, {
      scope: "operator.read",
    });
    api.registerGatewayMethod("memory.wiki.update", handleMemoryWikiUpdateGatewayRequest, {
      scope: "operator.write",
    });
    api.registerGatewayMethod("memory.wiki.history", handleMemoryWikiHistoryGatewayRequest, {
      scope: "operator.read",
    });
    api.registerGatewayMethod("memory.files.list", handleMemoryFilesListGatewayRequest, {
      scope: "operator.read",
    });
    api.registerGatewayMethod("memory.files.get", handleMemoryFilesGetGatewayRequest, {
      scope: "operator.read",
    });
    api.registerGatewayMethod("memory.trace.get", handleMemoryTraceGetGatewayRequest, {
      scope: "operator.read",
    });
    api.registerGatewayMethod("memory.export", handleMemoryExportGatewayRequest, {
      scope: "operator.read",
    });

    api.registerTool(
      (ctx) =>
        createMemorySearchTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      { names: ["memory_search"] },
    );

    api.registerTool(
      (ctx) =>
        createMemoryGetTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      { names: ["memory_get"] },
    );

    api.registerTool(
      (ctx) =>
        createMemoryGraphTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      { names: ["memory_graph"] },
    );

    api.registerCli(
      ({ program }) => {
        registerMemoryCli(program);
      },
      {
        descriptors: [
          {
            name: "memory",
            description: "Search, inspect, and sync native memory",
            hasSubcommands: true,
          },
        ],
      },
    );
  },
});
