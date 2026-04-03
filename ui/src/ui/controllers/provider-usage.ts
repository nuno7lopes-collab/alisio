import type { GatewayBrowserClient } from "../gateway.ts";
import type { ProviderUsageSummary } from "../types.ts";

export type ProviderUsageState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  providerUsageLoading: boolean;
  providerUsageError: string | null;
  providerUsageSummary: ProviderUsageSummary | null;
};

export async function loadProviderUsageStatus(
  state: ProviderUsageState,
  opts?: { quiet?: boolean },
) {
  if (!state.client || !state.connected || state.providerUsageLoading) {
    return;
  }
  state.providerUsageLoading = true;
  if (!opts?.quiet) {
    state.providerUsageError = null;
  }
  try {
    state.providerUsageSummary = await state.client.request<ProviderUsageSummary>(
      "usage.status",
      {},
    );
  } catch (error) {
    if (!opts?.quiet) {
      state.providerUsageError = String(error);
    }
  } finally {
    state.providerUsageLoading = false;
  }
}
