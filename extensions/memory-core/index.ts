import { definePluginEntry } from "alisio/plugin-sdk/plugin-entry";
import { registerMemoryCli } from "./src/cli.js";
import {
  buildCompactionBacklogSeedContent,
  buildMemoryFlushPlan,
  DEFAULT_MEMORY_FLUSH_FORCE_TRANSCRIPT_BYTES,
  DEFAULT_MEMORY_FLUSH_PROMPT,
  DEFAULT_MEMORY_FLUSH_SOFT_TOKENS,
} from "./src/flush-plan.js";
import { handleMemoryGraphGatewayRequest } from "./src/gateway.js";
import {
  handleMemoryExportGatewayRequest,
  handleMemoryNotesGetGatewayRequest,
  handleMemoryNotesHistoryGatewayRequest,
  handleMemoryNotesListGatewayRequest,
  handleMemoryNotesUpdateGatewayRequest,
  handleMemoryTraceGetGatewayRequest,
} from "./src/gateway.native.js";
import {
  handleMemoryFilesGetGatewayRequest,
  handleMemoryFilesListGatewayRequest,
} from "./src/gateway/files.js";
import {
  handleMemoryJobsCancelGatewayRequest,
  handleMemoryJobsRunOnceGatewayRequest,
  handleMemoryJobsStatusGatewayRequest,
  primeMemoryJobsRuntime,
  withMemoryJobsGatewayActivity,
} from "./src/jobs/gateway.js";
import { registerBuiltInMemoryEmbeddingProviders } from "./src/memory/provider-adapters.js";
import { buildPromptSection } from "./src/prompt-section.js";
import { memoryRuntime } from "./src/runtime-provider.js";
import { createMemoryGetTool, createMemoryGraphTool, createMemorySearchTool } from "./src/tools.js";
export {
  buildCompactionBacklogSeedContent,
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
    primeMemoryJobsRuntime();
    registerBuiltInMemoryEmbeddingProviders(api);
    api.registerMemoryPromptSection(buildPromptSection);
    api.registerMemoryFlushPlan(buildMemoryFlushPlan);
    api.registerMemoryRuntime(memoryRuntime);
    api.registerGatewayMethod(
      "memory.graph",
      withMemoryJobsGatewayActivity(handleMemoryGraphGatewayRequest),
      {
        scope: "operator.read",
      },
    );
    api.registerGatewayMethod(
      "memory.notes.list",
      withMemoryJobsGatewayActivity(handleMemoryNotesListGatewayRequest),
      {
        scope: "operator.read",
      },
    );
    api.registerGatewayMethod(
      "memory.notes.get",
      withMemoryJobsGatewayActivity(handleMemoryNotesGetGatewayRequest),
      {
        scope: "operator.read",
      },
    );
    api.registerGatewayMethod(
      "memory.notes.update",
      withMemoryJobsGatewayActivity(handleMemoryNotesUpdateGatewayRequest),
      {
        scope: "operator.write",
      },
    );
    api.registerGatewayMethod(
      "memory.notes.history",
      withMemoryJobsGatewayActivity(handleMemoryNotesHistoryGatewayRequest),
      {
        scope: "operator.read",
      },
    );
    api.registerGatewayMethod(
      "memory.files.list",
      withMemoryJobsGatewayActivity(handleMemoryFilesListGatewayRequest),
      {
        scope: "operator.read",
      },
    );
    api.registerGatewayMethod(
      "memory.files.get",
      withMemoryJobsGatewayActivity(handleMemoryFilesGetGatewayRequest),
      {
        scope: "operator.read",
      },
    );
    api.registerGatewayMethod(
      "memory.trace.get",
      withMemoryJobsGatewayActivity(handleMemoryTraceGetGatewayRequest),
      {
        scope: "operator.read",
      },
    );
    api.registerGatewayMethod(
      "memory.export",
      withMemoryJobsGatewayActivity(handleMemoryExportGatewayRequest),
      {
        scope: "operator.read",
      },
    );
    api.registerGatewayMethod("memory.jobs.status", handleMemoryJobsStatusGatewayRequest, {
      scope: "operator.read",
    });
    api.registerGatewayMethod("memory.jobs.runOnce", handleMemoryJobsRunOnceGatewayRequest, {
      scope: "operator.write",
    });
    api.registerGatewayMethod("memory.jobs.cancel", handleMemoryJobsCancelGatewayRequest, {
      scope: "operator.write",
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
