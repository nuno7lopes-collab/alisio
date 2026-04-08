import type {
  ChannelAccountSnapshot,
  ChannelGatewayContext,
  AlisioConfig,
  RuntimeEnv,
} from "openclaw/plugin-sdk/testing";
import { vi } from "vitest";
import { createRuntimeEnv } from "./runtime-env.js";

export function createStartAccountContext<TAccount extends { accountId: string }>(params: {
  account: TAccount;
  abortSignal?: AbortSignal;
  cfg?: AlisioConfig;
  runtime?: RuntimeEnv;
  statusPatchSink?: (next: ChannelAccountSnapshot) => void;
}): ChannelGatewayContext<TAccount> {
  const snapshot: ChannelAccountSnapshot = {
    accountId: params.account.accountId,
    configured: true,
    enabled: true,
    running: false,
  };
  return {
    accountId: params.account.accountId,
    account: params.account,
    cfg: params.cfg ?? ({} as AlisioConfig),
    runtime: params.runtime ?? createRuntimeEnv(),
    abortSignal: params.abortSignal ?? new AbortController().signal,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    getStatus: () => snapshot,
    setStatus: (next) => {
      Object.assign(snapshot, next);
      params.statusPatchSink?.(snapshot);
    },
  };
}
