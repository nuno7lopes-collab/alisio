import {
  loadModelCatalog,
  type ModelCatalogEntry,
  resetModelCatalogCacheForTest,
} from "../agents/model-catalog.js";
import { getRuntimeConfig } from "../config/config.js";
import { loadAlisioModelProviderSnapshot } from "../infra/alisio-model-snapshot.js";
import type { NodeRegistry } from "./node-registry.js";

export type GatewayModelChoice = ModelCatalogEntry;

// Test-only escape hatch: model catalog is cached at module scope for the
// process lifetime, which is fine for the real gateway daemon, but makes
// isolated unit tests harder. Keep this intentionally obscure.
export function __resetModelCatalogCacheForTest() {
  resetModelCatalogCacheForTest();
}

export async function loadGatewayModelCatalog(params?: {
  getConfig?: () => ReturnType<typeof getRuntimeConfig>;
  nodeRegistry?: NodeRegistry;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<GatewayModelChoice[]> {
  const configuredCatalog = await loadModelCatalog({
    config: (params?.getConfig ?? getRuntimeConfig)(),
  });
  const dynamicCatalog = params?.nodeRegistry
    ? (
        await loadAlisioModelProviderSnapshot({
          nodeRegistry: params.nodeRegistry,
          env: params.env,
          fetchImpl: params.fetchImpl,
        })
      ).dynamicCatalogEntries
    : [];
  if (dynamicCatalog.length === 0) {
    return configuredCatalog;
  }
  const merged = new Map<string, GatewayModelChoice>();
  for (const entry of [...configuredCatalog, ...dynamicCatalog]) {
    const key = `${entry.provider.toLowerCase().trim()}::${entry.id.toLowerCase().trim()}`;
    if (merged.has(key)) {
      continue;
    }
    merged.set(key, entry);
  }
  return [...merged.values()].toSorted((left, right) => {
    const provider = (left.providerLabel ?? left.provider).localeCompare(
      right.providerLabel ?? right.provider,
    );
    if (provider !== 0) {
      return provider;
    }
    const name = left.name.localeCompare(right.name);
    if (name !== 0) {
      return name;
    }
    return left.id.localeCompare(right.id);
  });
}
