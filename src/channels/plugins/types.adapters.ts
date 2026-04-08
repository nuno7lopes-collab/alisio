import type { ReplyPayload } from "../../auto-reply/types.js";
import type { ConfiguredBindingRule } from "../../config/bindings.js";
import type { AlisioConfig } from "../../config/config.js";
import type { GroupToolPolicyConfig } from "../../config/types.tools.js";
import type { ExecApprovalRequest, ExecApprovalResolved } from "../../infra/exec-approvals.js";
import type { OutboundDeliveryResult, OutboundSendDeps } from "../../infra/outbound/deliver.js";
import type { OutboundIdentity } from "../../infra/outbound/identity.js";
import type {
  PluginApprovalRequest,
  PluginApprovalResolved,
} from "../../infra/plugin-approvals.js";
import type { PluginRuntime } from "../../plugins/runtime/types.js";
import type { RuntimeEnv } from "../../runtime.js";
import type { ConfigWriteTarget } from "./config-writes.js";
import type {
  ChannelAccountSnapshot,
  ChannelAccountState,
  ChannelDirectoryEntry,
  ChannelGroupContext,
  ChannelHeartbeatDeps,
  ChannelLogSink,
  ChannelOutboundTargetMode,
  ChannelPollContext,
  ChannelPollResult,
  ChannelSecurityContext,
  ChannelSecurityDmPolicy,
  ChannelSetupInput,
  ChannelStatusIssue,
} from "./types.core.js";

export type ChannelActionAvailabilityState =
  | { kind: "enabled" }
  | { kind: "disabled" }
  | { kind: "unsupported" };

export type ChannelApprovalInitiatingSurfaceState = ChannelActionAvailabilityState;

export type ChannelApprovalForwardTarget = {
  channel: string;
  to: string;
  accountId?: string | null;
  threadId?: string | number | null;
  source?: "session" | "target";
};

export type ChannelCapabilitiesDisplayTone = "default" | "muted" | "success" | "warn" | "error";

export type ChannelCapabilitiesDisplayLine = {
  text: string;
  tone?: ChannelCapabilitiesDisplayTone;
};

export type ChannelCapabilitiesDiagnostics = {
  lines?: ChannelCapabilitiesDisplayLine[];
  details?: Record<string, unknown>;
};

type BivariantCallback<T extends (...args: never[]) => unknown> = {
  bivarianceHack: T;
}["bivarianceHack"];

export type ChannelSetupAdapter = {
  resolveAccountId?: (params: {
    cfg: AlisioConfig;
    accountId?: string;
    input?: ChannelSetupInput;
  }) => string;
  resolveBindingAccountId?: (params: {
    cfg: AlisioConfig;
    agentId: string;
    accountId?: string;
  }) => string | undefined;
  applyAccountName?: (params: {
    cfg: AlisioConfig;
    accountId: string;
    name?: string;
  }) => AlisioConfig;
  applyAccountConfig: (params: {
    cfg: AlisioConfig;
    accountId: string;
    input: ChannelSetupInput;
  }) => AlisioConfig;
  afterAccountConfigWritten?: (params: {
    previousCfg: AlisioConfig;
    cfg: AlisioConfig;
    accountId: string;
    input: ChannelSetupInput;
    runtime: RuntimeEnv;
  }) => Promise<void> | void;
  validateInput?: (params: {
    cfg: AlisioConfig;
    accountId: string;
    input: ChannelSetupInput;
  }) => string | null;
};

export type ChannelConfigAdapter<ResolvedAccount> = {
  listAccountIds: (cfg: AlisioConfig) => string[];
  resolveAccount: (cfg: AlisioConfig, accountId?: string | null) => ResolvedAccount;
  inspectAccount?: (cfg: AlisioConfig, accountId?: string | null) => unknown;
  defaultAccountId?: (cfg: AlisioConfig) => string;
  setAccountEnabled?: (params: {
    cfg: AlisioConfig;
    accountId: string;
    enabled: boolean;
  }) => AlisioConfig;
  deleteAccount?: (params: { cfg: AlisioConfig; accountId: string }) => AlisioConfig;
  isEnabled?: (account: ResolvedAccount, cfg: AlisioConfig) => boolean;
  disabledReason?: (account: ResolvedAccount, cfg: AlisioConfig) => string;
  isConfigured?: (account: ResolvedAccount, cfg: AlisioConfig) => boolean | Promise<boolean>;
  unconfiguredReason?: (account: ResolvedAccount, cfg: AlisioConfig) => string;
  describeAccount?: (account: ResolvedAccount, cfg: AlisioConfig) => ChannelAccountSnapshot;
  resolveAllowFrom?: (params: {
    cfg: AlisioConfig;
    accountId?: string | null;
  }) => Array<string | number> | undefined;
  formatAllowFrom?: (params: {
    cfg: AlisioConfig;
    accountId?: string | null;
    allowFrom: Array<string | number>;
  }) => string[];
  resolveDefaultTo?: (params: {
    cfg: AlisioConfig;
    accountId?: string | null;
  }) => string | undefined;
};

export type ChannelGroupAdapter = {
  resolveRequireMention?: (params: ChannelGroupContext) => boolean | undefined;
  resolveGroupIntroHint?: (params: ChannelGroupContext) => string | undefined;
  resolveToolPolicy?: (params: ChannelGroupContext) => GroupToolPolicyConfig | undefined;
};

export type ChannelOutboundContext = {
  cfg: AlisioConfig;
  to: string;
  text: string;
  mediaUrl?: string;
  audioAsVoice?: boolean;
  mediaLocalRoots?: readonly string[];
  gifPlayback?: boolean;
  /** Send image as document to avoid Telegram compression. */
  forceDocument?: boolean;
  replyToId?: string | null;
  threadId?: string | number | null;
  accountId?: string | null;
  identity?: OutboundIdentity;
  deps?: OutboundSendDeps;
  silent?: boolean;
  gatewayClientScopes?: readonly string[];
};

export type ChannelOutboundPayloadContext = ChannelOutboundContext & {
  payload: ReplyPayload;
};

export type ChannelOutboundPayloadHint =
  | { kind: "approval-pending"; approvalKind: "exec" | "plugin" }
  | { kind: "approval-resolved"; approvalKind: "exec" | "plugin" };

export type ChannelOutboundTargetRef = {
  channel: string;
  to: string;
  accountId?: string | null;
  threadId?: string | number | null;
};

export type ChannelOutboundFormattedContext = ChannelOutboundContext & {
  abortSignal?: AbortSignal;
};

export type ChannelOutboundAdapter = {
  deliveryMode: "direct" | "gateway" | "hybrid";
  chunker?: ((text: string, limit: number) => string[]) | null;
  chunkerMode?: "text" | "markdown";
  textChunkLimit?: number;
  pollMaxOptions?: number;
  normalizePayload?: (params: { payload: ReplyPayload }) => ReplyPayload | null;
  shouldSkipPlainTextSanitization?: (params: { payload: ReplyPayload }) => boolean;
  resolveEffectiveTextChunkLimit?: (params: {
    cfg: AlisioConfig;
    accountId?: string | null;
    fallbackLimit?: number;
  }) => number | undefined;
  shouldSuppressLocalPayloadPrompt?: (params: {
    cfg: AlisioConfig;
    accountId?: string | null;
    payload: ReplyPayload;
    hint?: ChannelOutboundPayloadHint;
  }) => boolean;
  beforeDeliverPayload?: (params: {
    cfg: AlisioConfig;
    target: ChannelOutboundTargetRef;
    payload: ReplyPayload;
    hint?: ChannelOutboundPayloadHint;
  }) => Promise<void> | void;
  resolveTarget?: (params: {
    cfg?: AlisioConfig;
    to?: string;
    allowFrom?: string[];
    accountId?: string | null;
    mode?: ChannelOutboundTargetMode;
  }) => { ok: true; to: string } | { ok: false; error: Error };
  sendPayload?: (ctx: ChannelOutboundPayloadContext) => Promise<OutboundDeliveryResult>;
  sendFormattedText?: (ctx: ChannelOutboundFormattedContext) => Promise<OutboundDeliveryResult[]>;
  sendFormattedMedia?: (
    ctx: ChannelOutboundFormattedContext & { mediaUrl: string },
  ) => Promise<OutboundDeliveryResult>;
  sendText?: (ctx: ChannelOutboundContext) => Promise<OutboundDeliveryResult>;
  sendMedia?: (ctx: ChannelOutboundContext) => Promise<OutboundDeliveryResult>;
  sendPoll?: (ctx: ChannelPollContext) => Promise<ChannelPollResult>;
};

export type ChannelStatusAdapter<ResolvedAccount, Probe = unknown, Audit = unknown> = {
  defaultRuntime?: ChannelAccountSnapshot;
  buildChannelSummary?: (params: {
    account: ResolvedAccount;
    cfg: AlisioConfig;
    defaultAccountId: string;
    snapshot: ChannelAccountSnapshot;
  }) => Record<string, unknown> | Promise<Record<string, unknown>>;
  probeAccount?: (params: {
    account: ResolvedAccount;
    timeoutMs: number;
    cfg: AlisioConfig;
  }) => Promise<Probe>;
  formatCapabilitiesProbe?: BivariantCallback<
    (params: { probe: Probe }) => ChannelCapabilitiesDisplayLine[]
  >;
  auditAccount?: (params: {
    account: ResolvedAccount;
    timeoutMs: number;
    cfg: AlisioConfig;
    probe?: Probe;
  }) => Promise<Audit>;
  buildCapabilitiesDiagnostics?: BivariantCallback<
    (params: {
      account: ResolvedAccount;
      timeoutMs: number;
      cfg: AlisioConfig;
      probe?: Probe;
      audit?: Audit;
      target?: string;
    }) => Promise<ChannelCapabilitiesDiagnostics | undefined>
  >;
  buildAccountSnapshot?: (params: {
    account: ResolvedAccount;
    cfg: AlisioConfig;
    runtime?: ChannelAccountSnapshot;
    probe?: Probe;
    audit?: Audit;
  }) => ChannelAccountSnapshot | Promise<ChannelAccountSnapshot>;
  logSelfId?: (params: {
    account: ResolvedAccount;
    cfg: AlisioConfig;
    runtime: RuntimeEnv;
    includeChannelPrefix?: boolean;
  }) => void;
  resolveAccountState?: (params: {
    account: ResolvedAccount;
    cfg: AlisioConfig;
    configured: boolean;
    enabled: boolean;
  }) => ChannelAccountState;
  collectStatusIssues?: (accounts: ChannelAccountSnapshot[]) => ChannelStatusIssue[];
};

export type ChannelGatewayContext<ResolvedAccount = unknown> = {
  cfg: AlisioConfig;
  accountId: string;
  account: ResolvedAccount;
  runtime: RuntimeEnv;
  abortSignal: AbortSignal;
  log?: ChannelLogSink;
  getStatus: () => ChannelAccountSnapshot;
  setStatus: (next: ChannelAccountSnapshot) => void;
  /**
   * Optional channel runtime helpers for external channel plugins.
   *
   * This field provides access to advanced Plugin SDK features that are
   * available to external plugins but not to built-in channels (which can
   * directly import internal modules).
   *
   * ## Available Features
   *
   * - **reply**: AI response dispatching, formatting, and delivery
   * - **routing**: Agent route resolution and matching
   * - **text**: Text chunking, markdown processing, and control command detection
   * - **session**: Session management and metadata tracking
   * - **media**: Remote media fetching and buffer saving
   * - **commands**: Command authorization and control command handling
   * - **groups**: Group policy resolution and mention requirements
   * - **pairing**: Channel pairing and allow-from management
   *
   * ## Use Cases
   *
   * External channel plugins (e.g., email, SMS, custom integrations) that need:
   * - AI-powered response generation and delivery
   * - Advanced text processing and formatting
   * - Session tracking and management
   * - Agent routing and policy resolution
   *
   * ## Example
   *
   * ```typescript
   * const emailGatewayAdapter: ChannelGatewayAdapter<EmailAccount> = {
   *   startAccount: async (ctx) => {
   *     // Check availability (for backward compatibility)
   *     if (!ctx.channelRuntime) {
   *       ctx.log?.warn?.("channelRuntime not available - skipping AI features");
   *       return;
   *     }
   *
   *     // Use AI dispatch
   *     await ctx.channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher({
   *       ctx: { ... },
   *       cfg: ctx.cfg,
   *       dispatcherOptions: {
   *         deliver: async (payload) => {
   *           // Send reply via email
   *         },
   *       },
   *     });
   *   },
   * };
   * ```
   *
   * ## Backward Compatibility
   *
   * - This field is **optional** - channels that don't need it can ignore it
   * - Built-in channels (slack, discord, etc.) typically don't use this field
   *   because they can directly import internal modules
   * - External plugins should check for undefined before using
   *
   * @since Plugin SDK 2026.2.19
   * @see {@link https://docs.openclaw.ai/plugins/developing-plugins | Plugin SDK documentation}
   */
  channelRuntime?: PluginRuntime["channel"];
};

export type ChannelLogoutResult = {
  cleared: boolean;
  loggedOut?: boolean;
  [key: string]: unknown;
};

export type ChannelLoginWithQrStartResult = {
  qrDataUrl?: string;
  message: string;
};

export type ChannelLoginWithQrWaitResult = {
  connected: boolean;
  message: string;
};

export type ChannelLogoutContext<ResolvedAccount = unknown> = {
  cfg: AlisioConfig;
  accountId: string;
  account: ResolvedAccount;
  runtime: RuntimeEnv;
  log?: ChannelLogSink;
};

export type ChannelPairingAdapter = {
  idLabel: string;
  normalizeAllowEntry?: (entry: string) => string;
  applyApprovalToConfig?: (params: {
    cfg: AlisioConfig;
    id: string;
    accountId?: string;
  }) => Promise<AlisioConfig> | AlisioConfig;
  notifyApproval?: (params: {
    cfg: AlisioConfig;
    id: string;
    accountId?: string;
    runtime?: RuntimeEnv;
  }) => Promise<void>;
};

export type ChannelGatewayAdapter<ResolvedAccount = unknown> = {
  startAccount?: (ctx: ChannelGatewayContext<ResolvedAccount>) => Promise<unknown>;
  stopAccount?: (ctx: ChannelGatewayContext<ResolvedAccount>) => Promise<void>;
  loginWithQrStart?: (params: {
    accountId?: string;
    force?: boolean;
    timeoutMs?: number;
    verbose?: boolean;
  }) => Promise<ChannelLoginWithQrStartResult>;
  loginWithQrWait?: (params: {
    accountId?: string;
    timeoutMs?: number;
  }) => Promise<ChannelLoginWithQrWaitResult>;
  logoutAccount?: (ctx: ChannelLogoutContext<ResolvedAccount>) => Promise<ChannelLogoutResult>;
};

export type ChannelAuthAdapter = {
  login?: (params: {
    cfg: AlisioConfig;
    accountId?: string | null;
    runtime: RuntimeEnv;
    verbose?: boolean;
    channelInput?: string | null;
  }) => Promise<void>;
  authorizeActorAction?: (params: {
    cfg: AlisioConfig;
    accountId?: string | null;
    senderId?: string | null;
    action: "approve";
    approvalKind: "exec" | "plugin";
  }) => {
    authorized: boolean;
    reason?: string;
  };
  getActionAvailabilityState?: (params: {
    cfg: AlisioConfig;
    accountId?: string | null;
    action: "approve";
  }) => ChannelActionAvailabilityState;
};

export type ChannelHeartbeatAdapter = {
  checkReady?: (params: {
    cfg: AlisioConfig;
    accountId?: string | null;
    deps?: ChannelHeartbeatDeps;
  }) => Promise<{ ok: boolean; reason: string }>;
  resolveRecipients?: (params: { cfg: AlisioConfig; opts?: { to?: string; all?: boolean } }) => {
    recipients: string[];
    source: string;
  };
};

type ChannelDirectorySelfParams = {
  cfg: AlisioConfig;
  accountId?: string | null;
  runtime: RuntimeEnv;
};

type ChannelDirectoryListParams = {
  cfg: AlisioConfig;
  accountId?: string | null;
  query?: string | null;
  limit?: number | null;
  runtime: RuntimeEnv;
};

type ChannelDirectoryListGroupMembersParams = {
  cfg: AlisioConfig;
  accountId?: string | null;
  groupId: string;
  limit?: number | null;
  runtime: RuntimeEnv;
};

export type ChannelDirectoryAdapter = {
  self?: (params: ChannelDirectorySelfParams) => Promise<ChannelDirectoryEntry | null>;
  listPeers?: (params: ChannelDirectoryListParams) => Promise<ChannelDirectoryEntry[]>;
  listPeersLive?: (params: ChannelDirectoryListParams) => Promise<ChannelDirectoryEntry[]>;
  listGroups?: (params: ChannelDirectoryListParams) => Promise<ChannelDirectoryEntry[]>;
  listGroupsLive?: (params: ChannelDirectoryListParams) => Promise<ChannelDirectoryEntry[]>;
  listGroupMembers?: (
    params: ChannelDirectoryListGroupMembersParams,
  ) => Promise<ChannelDirectoryEntry[]>;
};

export type ChannelResolveKind = "user" | "group";

export type ChannelResolveResult = {
  input: string;
  resolved: boolean;
  id?: string;
  name?: string;
  note?: string;
};

export type ChannelResolverAdapter = {
  resolveTargets: (params: {
    cfg: AlisioConfig;
    accountId?: string | null;
    inputs: string[];
    kind: ChannelResolveKind;
    runtime: RuntimeEnv;
  }) => Promise<ChannelResolveResult[]>;
};

export type ChannelElevatedAdapter = {
  allowFromFallback?: (params: {
    cfg: AlisioConfig;
    accountId?: string | null;
  }) => Array<string | number> | undefined;
};

export type ChannelCommandAdapter = {
  enforceOwnerForCommands?: boolean;
  skipWhenConfigEmpty?: boolean;
};

export type ChannelLifecycleAdapter = {
  onAccountConfigChanged?: (params: {
    prevCfg: AlisioConfig;
    nextCfg: AlisioConfig;
    accountId: string;
    runtime: RuntimeEnv;
  }) => Promise<void> | void;
  onAccountRemoved?: (params: {
    prevCfg: AlisioConfig;
    accountId: string;
    runtime: RuntimeEnv;
  }) => Promise<void> | void;
};

export type ChannelApprovalDeliveryAdapter = {
  hasConfiguredDmRoute?: (params: { cfg: AlisioConfig }) => boolean;
  shouldSuppressForwardingFallback?: (params: {
    cfg: AlisioConfig;
    target: ChannelApprovalForwardTarget;
    request: ExecApprovalRequest;
  }) => boolean;
};

export type ChannelApprovalRenderAdapter = {
  exec?: {
    buildPendingPayload?: (params: {
      cfg: AlisioConfig;
      request: ExecApprovalRequest;
      target: ChannelApprovalForwardTarget;
      nowMs: number;
    }) => ReplyPayload | null;
    buildResolvedPayload?: (params: {
      cfg: AlisioConfig;
      resolved: ExecApprovalResolved;
      target: ChannelApprovalForwardTarget;
    }) => ReplyPayload | null;
  };
  plugin?: {
    buildPendingPayload?: (params: {
      cfg: AlisioConfig;
      request: PluginApprovalRequest;
      target: ChannelApprovalForwardTarget;
      nowMs: number;
    }) => ReplyPayload | null;
    buildResolvedPayload?: (params: {
      cfg: AlisioConfig;
      resolved: PluginApprovalResolved;
      target: ChannelApprovalForwardTarget;
    }) => ReplyPayload | null;
  };
};

export type ChannelApprovalAdapter = {
  delivery?: ChannelApprovalDeliveryAdapter;
  render?: ChannelApprovalRenderAdapter;
};

export type ChannelAllowlistAdapter = {
  applyConfigEdit?: (params: {
    cfg: AlisioConfig;
    parsedConfig: Record<string, unknown>;
    accountId?: string | null;
    scope: "dm" | "group";
    action: "add" | "remove";
    entry: string;
  }) =>
    | {
        kind: "ok";
        changed: boolean;
        pathLabel: string;
        writeTarget: ConfigWriteTarget;
      }
    | {
        kind: "invalid-entry";
      }
    | Promise<
        | {
            kind: "ok";
            changed: boolean;
            pathLabel: string;
            writeTarget: ConfigWriteTarget;
          }
        | {
            kind: "invalid-entry";
          }
      >
    | null;
  readConfig?: (params: { cfg: AlisioConfig; accountId?: string | null }) =>
    | {
        dmAllowFrom?: Array<string | number>;
        groupAllowFrom?: Array<string | number>;
        dmPolicy?: string;
        groupPolicy?: string;
        groupOverrides?: Array<{ label: string; entries: Array<string | number> }>;
      }
    | Promise<{
        dmAllowFrom?: Array<string | number>;
        groupAllowFrom?: Array<string | number>;
        dmPolicy?: string;
        groupPolicy?: string;
        groupOverrides?: Array<{ label: string; entries: Array<string | number> }>;
      }>;
  resolveNames?: (params: {
    cfg: AlisioConfig;
    accountId?: string | null;
    scope: "dm" | "group";
    entries: string[];
  }) =>
    | Array<{ input: string; resolved: boolean; name?: string | null }>
    | Promise<Array<{ input: string; resolved: boolean; name?: string | null }>>;
  supportsScope?: (params: { scope: "dm" | "group" | "all" }) => boolean;
};

export type ChannelConfiguredBindingConversationRef = {
  conversationId: string;
  parentConversationId?: string;
};

export type ChannelConfiguredBindingMatch = ChannelConfiguredBindingConversationRef & {
  matchPriority?: number;
};

export type ChannelCommandConversationContext = {
  accountId: string;
  threadId?: string;
  threadParentId?: string;
  senderId?: string;
  sessionKey?: string;
  parentSessionKey?: string;
  originatingTo?: string;
  commandTo?: string;
  fallbackTo?: string;
};

export type ChannelConfiguredBindingProvider = {
  compileConfiguredBinding: (params: {
    binding: ConfiguredBindingRule;
    conversationId: string;
  }) => ChannelConfiguredBindingConversationRef | null;
  matchInboundConversation: (params: {
    binding: ConfiguredBindingRule;
    compiledBinding: ChannelConfiguredBindingConversationRef;
    conversationId: string;
    parentConversationId?: string;
  }) => ChannelConfiguredBindingMatch | null;
  resolveCommandConversation?: (
    params: ChannelCommandConversationContext,
  ) => ChannelConfiguredBindingConversationRef | null;
};

export type ChannelConversationBindingSupport = {
  supportsCurrentConversationBinding?: boolean;
  setIdleTimeoutBySessionKey?: (params: {
    targetSessionKey: string;
    accountId?: string | null;
    idleTimeoutMs: number;
  }) => Array<{
    boundAt: number;
    lastActivityAt: number;
    idleTimeoutMs?: number;
    maxAgeMs?: number;
  }>;
  setMaxAgeBySessionKey?: (params: {
    targetSessionKey: string;
    accountId?: string | null;
    maxAgeMs: number;
  }) => Array<{
    boundAt: number;
    lastActivityAt: number;
    idleTimeoutMs?: number;
    maxAgeMs?: number;
  }>;
  createManager?: (params: { cfg: AlisioConfig; accountId?: string | null }) =>
    | {
        stop: () => void | Promise<void>;
      }
    | Promise<{
        stop: () => void | Promise<void>;
      }>;
};

export type ChannelSecurityAdapter<ResolvedAccount = unknown> = {
  resolveDmPolicy?: (
    ctx: ChannelSecurityContext<ResolvedAccount>,
  ) => ChannelSecurityDmPolicy | null;
  collectWarnings?: (ctx: ChannelSecurityContext<ResolvedAccount>) => Promise<string[]> | string[];
};
