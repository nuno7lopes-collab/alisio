import type { GatewayBrowserClient } from "../gateway.ts";
import type { ModelCatalogEntry } from "../types.ts";

export type LoadModelsOptions = {
  scope?: "allowed" | "all";
};

export type ModelCatalogPair = {
  chatCatalog: ModelCatalogEntry[];
  managementCatalog: ModelCatalogEntry[];
};

/**
 * Fetch the model catalog from the gateway.
 *
 * Accepts a {@link GatewayBrowserClient} (matching the existing ui/ controller
 * convention).  Returns an array of {@link ModelCatalogEntry}; on failure the
 * caller receives an empty array rather than throwing.
 */
export async function loadModels(
  client: GatewayBrowserClient,
  opts?: LoadModelsOptions,
): Promise<ModelCatalogEntry[]> {
  try {
    const params = opts?.scope === "all" ? { scope: "all" as const } : {};
    const result = await client.request<{ models: ModelCatalogEntry[] }>("models.list", params);
    return result?.models ?? [];
  } catch {
    return [];
  }
}

export async function loadModelCatalogPair(
  client: GatewayBrowserClient,
): Promise<ModelCatalogPair | null> {
  try {
    const [chatCatalog, managementCatalog] = await Promise.all([
      loadModels(client),
      loadModels(client, { scope: "all" }),
    ]);
    return { chatCatalog, managementCatalog };
  } catch {
    return null;
  }
}
