import type { GatewayRequestHandlerOptions } from "alisio/plugin-sdk/core";
import { loadConfig } from "alisio/plugin-sdk/memory-core-host-runtime-core";
import type { CanonicalMemoryStoreStatus } from "./memory/canonical-store.js";
import { queryCanonicalMemoryGraph } from "./memory/canonical-store.js";
import { getMemorySearchManager } from "./memory/index.js";

function respondGatewayError(
  respond: GatewayRequestHandlerOptions["respond"],
  code: string,
  message: string,
) {
  respond(false, undefined, { code, message });
}

function parseOptionalPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

function asCanonicalStoreStatus(value: unknown): CanonicalMemoryStoreStatus | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<CanonicalMemoryStoreStatus>;
  if (
    !record.path ||
    !record.profileId ||
    !record.workspaceScope ||
    !record.backend ||
    !record.projectionInterface ||
    !record.syncMode ||
    !record.cloudSync ||
    !record.state
  ) {
    return null;
  }
  return record as CanonicalMemoryStoreStatus;
}

export async function handleMemoryGraphGatewayRequest({
  params,
  respond,
}: GatewayRequestHandlerOptions) {
  const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
  const query = typeof params.query === "string" ? params.query.trim() : "";
  if (!agentId) {
    respondGatewayError(respond, "INVALID_REQUEST", "memory.graph requires agentId");
    return;
  }
  if (!query) {
    respondGatewayError(respond, "INVALID_REQUEST", "memory.graph requires query");
    return;
  }
  const direction =
    params.direction === "incoming" ||
    params.direction === "outgoing" ||
    params.direction === "both"
      ? params.direction
      : "both";
  const matchLimit = parseOptionalPositiveInt(params.matchLimit);
  const relationLimit = parseOptionalPositiveInt(params.relationLimit);
  const cfg = loadConfig();
  const { manager, error } = await getMemorySearchManager({
    cfg,
    agentId,
    purpose: "status",
  });
  if (!manager) {
    respondGatewayError(
      respond,
      "UNAVAILABLE",
      `memory.graph unavailable: ${error ?? "memory manager unavailable"}`,
    );
    return;
  }

  try {
    const canonicalStore = asCanonicalStoreStatus(manager.status().custom?.canonicalStore);
    if (!canonicalStore) {
      respondGatewayError(
        respond,
        "UNAVAILABLE",
        "canonical memory store unavailable for this agent",
      );
      return;
    }
    respond(
      true,
      queryCanonicalMemoryGraph({
        status: canonicalStore,
        query,
        direction,
        ...(matchLimit ? { matchLimit } : {}),
        ...(relationLimit ? { relationLimit } : {}),
      }),
      undefined,
    );
  } catch (err) {
    respondGatewayError(
      respond,
      "UNAVAILABLE",
      `memory.graph failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    await manager.close?.().catch(() => {});
  }
}
