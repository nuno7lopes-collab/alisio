import type { RunOptions } from "@grammyjs/runner";
import { resolveAgentMaxConcurrent } from "openclaw/plugin-sdk/config-runtime";
import { loadConfig } from "openclaw/plugin-sdk/config-runtime";
import { waitForAbortSignal } from "openclaw/plugin-sdk/runtime-env";
import { registerUnhandledRejectionHandler } from "openclaw/plugin-sdk/runtime-env";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { formatErrorMessage } from "openclaw/plugin-sdk/ssrf-runtime";
import { redactSensitiveText } from "openclaw/plugin-sdk/text-runtime";
import { resolveTelegramAccount } from "./accounts.js";
import { resolveTelegramAllowedUpdates } from "./allowed-updates.js";
import { TelegramExecApprovalHandler } from "./exec-approvals-handler.js";
import { resolveTelegramTransport } from "./fetch.js";
import {
  isRecoverableTelegramNetworkError,
  isTelegramPollingNetworkError,
} from "./network-errors.js";
import { TelegramPollingSession } from "./polling-session.js";
import { makeProxyFetch } from "./proxy.js";
import { readTelegramUpdateOffset, writeTelegramUpdateOffset } from "./update-offset-store.js";
import { startTelegramWebhook } from "./webhook.js";

type TelegramConfig = Parameters<typeof resolveTelegramAccount>[0]["cfg"];

export type MonitorTelegramOpts = {
  token?: string;
  accountId?: string;
  config?: TelegramConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  useWebhook?: boolean;
  webhookPath?: string;
  webhookPort?: number;
  webhookSecret?: string;
  webhookHost?: string;
  proxyFetch?: typeof fetch;
  webhookUrl?: string;
  webhookCertPath?: string;
  statusSink?: TelegramMonitorStatusSink;
};

export type TelegramMonitorStatusPatch = {
  running?: boolean;
  connected?: boolean;
  reconnectAttempts?: number;
  lastConnectedAt?: number | null;
  lastDisconnect?:
    | string
    | {
        at: number;
        status?: number;
        error?: string;
        loggedOut?: boolean;
      }
    | null;
  lastEventAt?: number | null;
  lastError?: string | null;
  healthState?: "starting" | "healthy" | "reconnecting" | "stopped";
  mode?: "polling" | "webhook";
  lastStartAt?: number | null;
  lastStopAt?: number | null;
};

export type TelegramMonitorStatusSink = (patch: TelegramMonitorStatusPatch) => void;

function sanitizeTelegramRuntimeError(err: unknown): string {
  return redactSensitiveText(formatErrorMessage(err));
}

export function createTelegramRunnerOptions(cfg: TelegramConfig): RunOptions<unknown> {
  return {
    sink: {
      concurrency: resolveAgentMaxConcurrent(cfg),
    },
    runner: {
      fetch: {
        // Match grammY defaults
        timeout: 30,
        // Request reactions without dropping default update types.
        allowed_updates: resolveTelegramAllowedUpdates(),
      },
      // Suppress grammY getUpdates stack traces; we log concise errors ourselves.
      silent: true,
      // Keep grammY retrying for a long outage window. If polling still
      // stops, the outer monitor loop restarts it with backoff.
      maxRetryTime: 60 * 60 * 1000,
      retryInterval: "exponential",
    },
  };
}

function normalizePersistedUpdateId(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    return null;
  }
  return value;
}

/** Check if error is a Grammy HttpError (used to scope unhandled rejection handling) */
const isGrammyHttpError = (err: unknown): boolean => {
  if (!err || typeof err !== "object") {
    return false;
  }
  return (err as { name?: string }).name === "HttpError";
};

export async function monitorTelegramProvider(opts: MonitorTelegramOpts = {}) {
  const log = opts.runtime?.error ?? console.error;
  let pollingSession: TelegramPollingSession | undefined;
  let execApprovalsHandler: TelegramExecApprovalHandler | undefined;
  const mode = opts.useWebhook ? "webhook" : "polling";
  let startedAt: number | null = null;
  let lastFatalError: string | null = null;
  const pushStatus = (patch: TelegramMonitorStatusPatch) => {
    opts.statusSink?.({
      mode,
      ...patch,
    });
  };

  const unregisterHandler = registerUnhandledRejectionHandler((err) => {
    const isNetworkError = isRecoverableTelegramNetworkError(err, { context: "polling" });
    const isTelegramPollingError = isTelegramPollingNetworkError(err);
    if (isGrammyHttpError(err) && isNetworkError && isTelegramPollingError) {
      log(`[telegram] Suppressed network error: ${formatErrorMessage(err)}`);
      return true;
    }

    const activeRunner = pollingSession?.activeRunner;
    if (isNetworkError && isTelegramPollingError && activeRunner && activeRunner.isRunning()) {
      pollingSession?.markForceRestarted();
      pollingSession?.markTransportDirty();
      pollingSession?.abortActiveFetch();
      void activeRunner.stop().catch(() => {});
      log("[telegram][diag] marking transport dirty after polling network failure");
      log(
        `[telegram] Restarting polling after unhandled network error: ${formatErrorMessage(err)}`,
      );
      return true;
    }

    return false;
  });

  try {
    const cfg = opts.config ?? loadConfig();
    const account = resolveTelegramAccount({
      cfg,
      accountId: opts.accountId,
    });
    const token = opts.token?.trim() || account.token;
    if (!token) {
      throw new Error(
        `Telegram bot token missing for account "${account.accountId}" (set channels.telegram.accounts.${account.accountId}.botToken/tokenFile or TELEGRAM_BOT_TOKEN for default).`,
      );
    }
    startedAt = Date.now();
    pushStatus({
      running: true,
      connected: false,
      reconnectAttempts: 0,
      healthState: "starting",
      lastError: null,
      lastStartAt: startedAt,
      lastStopAt: null,
    });

    const proxyFetch =
      opts.proxyFetch ?? (account.config.proxy ? makeProxyFetch(account.config.proxy) : undefined);

    execApprovalsHandler = new TelegramExecApprovalHandler({
      token,
      accountId: account.accountId,
      cfg,
      runtime: opts.runtime,
    });
    await execApprovalsHandler.start();

    const persistedOffsetRaw = await readTelegramUpdateOffset({
      accountId: account.accountId,
      botToken: token,
    });
    let lastUpdateId = normalizePersistedUpdateId(persistedOffsetRaw);
    if (persistedOffsetRaw !== null && lastUpdateId === null) {
      log(
        `[telegram] Ignoring invalid persisted update offset (${String(persistedOffsetRaw)}); starting without offset confirmation.`,
      );
    }

    const persistUpdateId = async (updateId: number) => {
      const normalizedUpdateId = normalizePersistedUpdateId(updateId);
      if (normalizedUpdateId === null) {
        log(`[telegram] Ignoring invalid update_id value: ${String(updateId)}`);
        return;
      }
      if (lastUpdateId !== null && normalizedUpdateId <= lastUpdateId) {
        return;
      }
      lastUpdateId = normalizedUpdateId;
      try {
        await writeTelegramUpdateOffset({
          accountId: account.accountId,
          updateId: normalizedUpdateId,
          botToken: token,
        });
      } catch (err) {
        (opts.runtime?.error ?? console.error)(
          `telegram: failed to persist update offset: ${String(err)}`,
        );
      }
    };

    if (opts.useWebhook) {
      await startTelegramWebhook({
        token,
        accountId: account.accountId,
        config: cfg,
        path: opts.webhookPath,
        port: opts.webhookPort,
        secret: opts.webhookSecret ?? account.config.webhookSecret,
        host: opts.webhookHost ?? account.config.webhookHost,
        runtime: opts.runtime as RuntimeEnv,
        fetch: proxyFetch,
        abortSignal: opts.abortSignal,
        publicUrl: opts.webhookUrl,
        webhookCertPath: opts.webhookCertPath,
      });
      pushStatus({
        running: true,
        connected: true,
        reconnectAttempts: 0,
        healthState: "healthy",
        lastConnectedAt: Date.now(),
        lastEventAt: Date.now(),
        lastError: null,
      });
      await waitForAbortSignal(opts.abortSignal);
      return;
    }

    // Preserve sticky IPv4 fallback state across clean/conflict restarts.
    // Dirty polling cycles rebuild transport inside TelegramPollingSession.
    const createTelegramTransportForPolling = () =>
      resolveTelegramTransport(proxyFetch, {
        network: account.config.network,
      });
    const telegramTransport = createTelegramTransportForPolling();

    pollingSession = new TelegramPollingSession({
      token,
      config: cfg,
      accountId: account.accountId,
      runtime: opts.runtime,
      proxyFetch,
      abortSignal: opts.abortSignal,
      runnerOptions: createTelegramRunnerOptions(cfg),
      getLastUpdateId: () => lastUpdateId,
      persistUpdateId,
      log,
      statusSink: pushStatus,
      telegramTransport,
      createTelegramTransport: createTelegramTransportForPolling,
    });
    await pollingSession.runUntilAbort();
  } catch (err) {
    lastFatalError = sanitizeTelegramRuntimeError(err);
    pushStatus({
      connected: false,
      healthState: "stopped",
      lastError: lastFatalError,
      lastEventAt: Date.now(),
    });
    throw err;
  } finally {
    pushStatus({
      running: false,
      connected: false,
      healthState: "stopped",
      lastStopAt: Date.now(),
      ...(lastFatalError ? { lastError: lastFatalError } : {}),
      ...(startedAt ? { lastStartAt: startedAt } : {}),
    });
    await execApprovalsHandler?.stop().catch(() => {});
    unregisterHandler();
  }
}
