import { resolveChannelDefaultAccountId } from "../../channels/plugins/helpers.js";
import {
  type ChannelId,
  getChannelPlugin,
  listChannelPlugins,
  normalizeChannelId,
} from "../../channels/plugins/index.js";
import { buildChannelAccountSnapshot } from "../../channels/plugins/status.js";
import type { ChannelAccountSnapshot, ChannelPlugin } from "../../channels/plugins/types.js";
import { listChatChannels } from "../../channels/registry.js";
import { isChannelConfigured } from "../../config/channel-configured.js";
import type { OpenClawConfig } from "../../config/config.js";
import { loadConfig, readConfigFileSnapshot } from "../../config/config.js";
import { applyPluginAutoEnable } from "../../config/plugin-auto-enable.js";
import { getChannelActivity } from "../../infra/channel-activity.js";
import { collectChannelStatusIssues } from "../../infra/channels-status-issues.js";
import { DEFAULT_ACCOUNT_ID } from "../../routing/session-key.js";
import { defaultRuntime } from "../../runtime.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateChannelsLogoutParams,
  validateChannelsStatusParams,
} from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";
import type { GatewayRequestContext, GatewayRequestHandlers } from "./types.js";

type ChannelLogoutPayload = {
  channel: ChannelId;
  accountId: string;
  cleared: boolean;
  [key: string]: unknown;
};

const ALISIO_PUBLIC_CHANNEL_IDS = ["telegram", "whatsapp", "discord"] as const;

export async function logoutChannelAccount(params: {
  channelId: ChannelId;
  accountId?: string | null;
  cfg: OpenClawConfig;
  context: GatewayRequestContext;
  plugin: ChannelPlugin;
}): Promise<ChannelLogoutPayload> {
  const resolvedAccountId =
    params.accountId?.trim() ||
    params.plugin.config.defaultAccountId?.(params.cfg) ||
    params.plugin.config.listAccountIds(params.cfg)[0] ||
    DEFAULT_ACCOUNT_ID;
  const account = params.plugin.config.resolveAccount(params.cfg, resolvedAccountId);
  await params.context.stopChannel(params.channelId, resolvedAccountId);
  const result = await params.plugin.gateway?.logoutAccount?.({
    cfg: params.cfg,
    accountId: resolvedAccountId,
    account,
    runtime: defaultRuntime,
  });
  if (!result) {
    throw new Error(`Channel ${params.channelId} does not support logout`);
  }
  const cleared = Boolean(result.cleared);
  const loggedOut = typeof result.loggedOut === "boolean" ? result.loggedOut : cleared;
  if (loggedOut) {
    params.context.markChannelLoggedOut(params.channelId, true, resolvedAccountId);
  }
  return {
    channel: params.channelId,
    accountId: resolvedAccountId,
    ...result,
    cleared,
  };
}

export const channelsHandlers: GatewayRequestHandlers = {
  "channels.status": async ({ params, respond, context }) => {
    if (!validateChannelsStatusParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid channels.status params: ${formatValidationErrors(validateChannelsStatusParams.errors)}`,
        ),
      );
      return;
    }
    const probe = (params as { probe?: boolean }).probe === true;
    const timeoutMsRaw = (params as { timeoutMs?: unknown }).timeoutMs;
    const timeoutMs = typeof timeoutMsRaw === "number" ? Math.max(1000, timeoutMsRaw) : 10_000;
    const cfg = applyPluginAutoEnable({
      config: loadConfig(),
      env: process.env,
    }).config;
    const runtime = context.getRuntimeSnapshot();
    const runtimePlugins = listChannelPlugins();
    const pluginMap = new Map<ChannelId, ChannelPlugin>(
      runtimePlugins.map((plugin) => [plugin.id, plugin]),
    );
    const resolvedEntries = listChatChannels()
      .filter((entry) =>
        ALISIO_PUBLIC_CHANNEL_IDS.includes(entry.id as (typeof ALISIO_PUBLIC_CHANNEL_IDS)[number]),
      )
      .map((entry) => ({
        id: entry.id,
        meta: entry,
      }));

    const resolveRuntimeSnapshot = (
      channelId: ChannelId,
      accountId: string,
      defaultAccountId: string,
    ): ChannelAccountSnapshot | undefined => {
      const accounts = runtime.channelAccounts[channelId];
      const defaultRuntime = runtime.channels[channelId];
      const raw =
        accounts?.[accountId] ?? (accountId === defaultAccountId ? defaultRuntime : undefined);
      if (!raw) {
        return undefined;
      }
      return raw;
    };

    const isAccountEnabled = (plugin: ChannelPlugin, account: unknown) =>
      plugin.config.isEnabled
        ? plugin.config.isEnabled(account, cfg)
        : !account ||
          typeof account !== "object" ||
          (account as { enabled?: boolean }).enabled !== false;

    const buildChannelAccounts = async (channelId: ChannelId) => {
      const plugin = pluginMap.get(channelId);
      if (!plugin) {
        return {
          accounts: [] as ChannelAccountSnapshot[],
          defaultAccountId: DEFAULT_ACCOUNT_ID,
          defaultAccount: undefined as ChannelAccountSnapshot | undefined,
          resolvedAccounts: {} as Record<string, unknown>,
        };
      }
      const accountIds = plugin.config.listAccountIds(cfg);
      const defaultAccountId = resolveChannelDefaultAccountId({
        plugin,
        cfg,
        accountIds,
      });
      const accounts: ChannelAccountSnapshot[] = [];
      const resolvedAccounts: Record<string, unknown> = {};
      for (const accountId of accountIds) {
        const account = plugin.config.resolveAccount(cfg, accountId);
        const enabled = isAccountEnabled(plugin, account);
        resolvedAccounts[accountId] = account;
        let probeResult: unknown;
        let lastProbeAt: number | null = null;
        if (probe && enabled && plugin.status?.probeAccount) {
          let configured = true;
          if (plugin.config.isConfigured) {
            configured = await plugin.config.isConfigured(account, cfg);
          }
          if (configured) {
            probeResult = await plugin.status.probeAccount({
              account,
              timeoutMs,
              cfg,
            });
            lastProbeAt = Date.now();
          }
        }
        let auditResult: unknown;
        if (probe && enabled && plugin.status?.auditAccount) {
          let configured = true;
          if (plugin.config.isConfigured) {
            configured = await plugin.config.isConfigured(account, cfg);
          }
          if (configured) {
            auditResult = await plugin.status.auditAccount({
              account,
              timeoutMs,
              cfg,
              probe: probeResult,
            });
          }
        }
        const runtimeSnapshot = resolveRuntimeSnapshot(channelId, accountId, defaultAccountId);
        const snapshot = await buildChannelAccountSnapshot({
          plugin,
          cfg,
          accountId,
          runtime: runtimeSnapshot,
          probe: probeResult,
          audit: auditResult,
        });
        if (lastProbeAt) {
          snapshot.lastProbeAt = lastProbeAt;
        }
        const activity = getChannelActivity({
          channel: channelId as never,
          accountId,
        });
        if (snapshot.lastInboundAt == null) {
          snapshot.lastInboundAt = activity.inboundAt;
        }
        if (snapshot.lastOutboundAt == null) {
          snapshot.lastOutboundAt = activity.outboundAt;
        }
        accounts.push(snapshot);
      }
      const defaultAccount =
        accounts.find((entry) => entry.accountId === defaultAccountId) ?? accounts[0];
      return { accounts, defaultAccountId, defaultAccount, resolvedAccounts };
    };

    const channelOrder = resolvedEntries.map((entry) => entry.id);
    const channelLabels = Object.fromEntries(
      resolvedEntries.map((entry) => [entry.id, entry.meta.label]),
    );
    const channelDetailLabels = Object.fromEntries(
      resolvedEntries.map((entry) => [entry.id, entry.meta.detailLabel ?? entry.meta.label]),
    );
    const channelSystemImages = Object.fromEntries(
      resolvedEntries.flatMap((entry) =>
        entry.meta.systemImage?.trim() ? [[entry.id, entry.meta.systemImage.trim()] as const] : [],
      ),
    );
    const payload: Record<string, unknown> = {
      ts: Date.now(),
      channelOrder,
      channelLabels,
      channelDetailLabels,
      channelSystemImages,
      wizard: (() => {
        const running = context.getRunningChannelWizard();
        return {
          running: Boolean(running),
          sessionId: running?.sessionId ?? null,
          channelId: running?.channelId ?? null,
        };
      })(),
      channelMeta: resolvedEntries.map((entry) => ({
        id: entry.id,
        label: entry.meta.label,
        detailLabel: entry.meta.detailLabel ?? entry.meta.label,
        ...(entry.meta.blurb?.trim() ? { blurb: entry.meta.blurb.trim() } : {}),
        ...(entry.meta.docsPath?.trim() ? { docsPath: entry.meta.docsPath.trim() } : {}),
        ...(entry.meta.docsLabel?.trim() ? { docsLabel: entry.meta.docsLabel.trim() } : {}),
        ...(entry.meta.systemImage?.trim() ? { systemImage: entry.meta.systemImage.trim() } : {}),
      })),
      channelIssues: {} as Record<string, unknown>,
      channels: {} as Record<string, unknown>,
      channelAccounts: {} as Record<string, unknown>,
      channelDefaultAccountId: {} as Record<string, unknown>,
    };
    const issuesMap = payload.channelIssues as Record<string, unknown>;
    const channelsMap = payload.channels as Record<string, unknown>;
    const accountsMap = payload.channelAccounts as Record<string, unknown>;
    const defaultAccountIdMap = payload.channelDefaultAccountId as Record<string, unknown>;
    for (const entry of resolvedEntries) {
      const plugin = pluginMap.get(entry.id);
      const configured = isChannelConfigured(cfg, entry.id, process.env);
      const linkMode = entry.id === "whatsapp" ? "qr" : "wizard";
      if (!plugin) {
        channelsMap[entry.id] = {
          configured,
          linked: entry.id === "whatsapp" ? false : configured,
          running: false,
          connected: false,
          setupOnly: true,
          setupAvailable: true,
          logoutAvailable: false,
          linkMode,
        };
        accountsMap[entry.id] = [
          {
            accountId: DEFAULT_ACCOUNT_ID,
            configured,
            linked: entry.id === "whatsapp" ? false : configured,
            running: false,
            connected: false,
          },
        ] satisfies ChannelAccountSnapshot[];
        defaultAccountIdMap[entry.id] = DEFAULT_ACCOUNT_ID;
        continue;
      }

      const { accounts, defaultAccountId, defaultAccount, resolvedAccounts } =
        await buildChannelAccounts(plugin.id);
      const fallbackAccount =
        resolvedAccounts[defaultAccountId] ?? plugin.config.resolveAccount(cfg, defaultAccountId);
      const summary = plugin.status?.buildChannelSummary
        ? await plugin.status.buildChannelSummary({
            account: fallbackAccount,
            cfg,
            defaultAccountId,
            snapshot:
              defaultAccount ??
              ({
                accountId: defaultAccountId,
              } as ChannelAccountSnapshot),
          })
        : {
            configured: defaultAccount?.configured ?? false,
          };
      channelsMap[plugin.id] = {
        ...summary,
        setupAvailable: true,
        logoutAvailable: Boolean(plugin.gateway?.logoutAccount),
        linkMode,
      };
      accountsMap[plugin.id] = accounts;
      defaultAccountIdMap[plugin.id] = defaultAccountId;
    }
    for (const issue of collectChannelStatusIssues(payload)) {
      const channelIssues = (issuesMap[issue.channel] as Array<typeof issue> | undefined) ?? [];
      channelIssues.push(issue);
      issuesMap[issue.channel] = channelIssues;
    }

    respond(true, payload, undefined);
  },
  "channels.logout": async ({ params, respond, context }) => {
    if (!validateChannelsLogoutParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid channels.logout params: ${formatValidationErrors(validateChannelsLogoutParams.errors)}`,
        ),
      );
      return;
    }
    const rawChannel = (params as { channel?: unknown }).channel;
    const channelId = typeof rawChannel === "string" ? normalizeChannelId(rawChannel) : null;
    if (!channelId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid channels.logout channel"),
      );
      return;
    }
    const plugin = getChannelPlugin(channelId);
    if (!plugin?.gateway?.logoutAccount) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `channel ${channelId} does not support logout`),
      );
      return;
    }
    const accountIdRaw = (params as { accountId?: unknown }).accountId;
    const accountId = typeof accountIdRaw === "string" ? accountIdRaw.trim() : undefined;
    const snapshot = await readConfigFileSnapshot();
    if (!snapshot.valid) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "config invalid; fix it before logging out"),
      );
      return;
    }
    try {
      const payload = await logoutChannelAccount({
        channelId,
        accountId,
        cfg: snapshot.config ?? {},
        context,
        plugin,
      });
      respond(true, payload, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
};
