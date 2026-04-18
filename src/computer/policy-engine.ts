import { randomUUID } from "node:crypto";
import type {
  ComputerActionType,
  ComputerApprovalMode,
  ComputerObservationContext,
  ComputerPolicyDecision,
  ComputerPolicyReasonCode,
  ComputerSafetyEvent,
  ComputerSafetyEventType,
  ComputerSafetyLevel,
  ComputerSessionPolicy,
  ComputerSessionStatus,
  ComputerStructuredAction,
} from "./types.js";

const PASSIVE_ACTIONS = new Set<ComputerActionType>(["wait", "screenshot"]);

const DEFAULT_EXTERNAL_CONTENT_APPS = [
  "arc",
  "brave",
  "chrome",
  "discord",
  "edge",
  "firefox",
  "mail",
  "messages",
  "microsoft teams",
  "opera",
  "safari",
  "signal",
  "slack",
  "telegram",
] as const;

const DEFAULT_SENSITIVE_APP_PATTERNS = [
  "1password",
  "bitwarden",
  "keychain",
  "passwords",
  "system settings",
  "system preferences",
  "terminal",
  "iterm",
  "warp",
  "ghostty",
  "kitty",
  "alacritty",
  "hyper",
] as const;

const DEFAULT_SENSITIVE_PATH_PATTERNS = [
  "/.aws/",
  "/.gnupg/",
  "/.ssh/",
  "/keychains/",
  "/passwords",
  "/secrets",
] as const;

const DEFAULT_AUTH_PATTERNS = [
  "2fa",
  "authenticate",
  "credential",
  "login",
  "mfa",
  "otp",
  "passcode",
  "password",
  "sign in",
  "verification code",
] as const;

const DEFAULT_PAYMENT_PATTERNS = [
  "billing",
  "card number",
  "checkout",
  "credit card",
  "cvv",
  "cvc",
  "iban",
  "invoice",
  "payment",
  "wallet",
] as const;

const DEFAULT_PROD_TERMINAL_PATTERNS = [
  "aws",
  "cluster",
  "deploy",
  "gcloud",
  "kubectl",
  "prod",
  "production",
  "root@",
  "ssh",
  "terraform",
] as const;

const DEFAULT_PROMPT_INJECTION_PATTERNS = [
  "approve this",
  "bypass safety",
  "developer message",
  "disable safety",
  "ignore previous",
  "ignore the instructions",
  "reveal secrets",
  "system prompt",
] as const;

const DEFAULT_DENY_APP_PATTERNS = ["1password", "bitwarden", "keychain", "passwords"] as const;

const DEFAULT_COMMAND_LIKE_ACTIONS: ComputerActionType[] = [
  "focus_app",
  "keypress",
  "open_app",
  "open_path",
  "open_url",
  "reveal_path",
  "type",
];

type PolicyMatchContext = {
  action: ComputerStructuredAction;
  context?: ComputerObservationContext | null;
  appIdentity?: string;
  appName?: string;
  appBundleId?: string;
  windowTitle?: string;
  host?: string;
  path?: string;
  url?: string;
};

export type ComputerPolicyEvaluation = {
  decision: ComputerPolicyDecision;
  reasonCode: ComputerPolicyReasonCode;
  reason: string;
  appIdentity?: string;
  escalatedMode?: ComputerApprovalMode;
  safetyLevel: ComputerSafetyLevel;
  safetyEvents: ComputerSafetyEvent[];
};

type EvaluateComputerPolicyParams = {
  mode: ComputerApprovalMode;
  status: ComputerSessionStatus;
  pendingApproval: boolean;
  policy: ComputerSessionPolicy;
  approvedApps: string[];
  action: ComputerStructuredAction;
  context?: ComputerObservationContext | null;
  targetAppIdentity?: string | null;
};

function normalizeText(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function uniqStrings(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))];
}

function uniqActions(values: Iterable<ComputerActionType>): ComputerActionType[] {
  return [...new Set(values)];
}

function includesPattern(value: string, patterns: readonly string[]): boolean {
  if (!value) {
    return false;
  }
  return patterns.some((pattern) => value.includes(normalizeText(pattern)));
}

function includesAnySurface(context: PolicyMatchContext): string {
  return uniqStrings(
    [
      context.appIdentity,
      context.appName,
      context.appBundleId,
      context.windowTitle,
      context.host,
      context.path,
      context.url,
    ].filter((value): value is string => Boolean(value)),
  )
    .map((value) => normalizeText(value))
    .join("\n");
}

function isPassiveAction(action: ComputerStructuredAction): boolean {
  return PASSIVE_ACTIONS.has(action.type);
}

export function isCommandLikeAction(
  action: ComputerStructuredAction,
  policy: Pick<ComputerSessionPolicy, "commandLikeActions">,
): boolean {
  return policy.commandLikeActions.includes(action.type);
}

export function isSensitiveComputerAction(
  action: ComputerStructuredAction,
  policy: Pick<ComputerSessionPolicy, "commandLikeActions">,
): boolean {
  switch (action.type) {
    case "drag":
    case "focus_app":
    case "open_app":
    case "open_path":
    case "open_url":
    case "reveal_path":
      return true;
    case "keypress":
      return (action.modifiers?.length ?? 0) > 0 || isCommandLikeAction(action, policy);
    case "type":
      return Boolean(action.text?.trim()) || isCommandLikeAction(action, policy);
    default:
      return isCommandLikeAction(action, policy);
  }
}

export function createDefaultComputerPolicy(): ComputerSessionPolicy {
  return {
    allow: {
      apps: [],
      paths: [],
      hosts: [],
      actions: [],
      surfaces: [],
    },
    deny: {
      apps: [...DEFAULT_DENY_APP_PATTERNS],
      paths: [],
      hosts: [],
      actions: [],
      surfaces: [],
    },
    sensitive: {
      apps: [...DEFAULT_SENSITIVE_APP_PATTERNS],
      paths: [...DEFAULT_SENSITIVE_PATH_PATTERNS],
      hosts: [],
      actions: [],
      surfaces: [
        ...DEFAULT_AUTH_PATTERNS,
        ...DEFAULT_PAYMENT_PATTERNS,
        ...DEFAULT_PROD_TERMINAL_PATTERNS,
      ],
    },
    commandLikeActions: [...DEFAULT_COMMAND_LIKE_ACTIONS],
    lastDecision: null,
  };
}

export function normalizeComputerApprovalMode(value: unknown): ComputerApprovalMode | null {
  switch (value) {
    case "observe_only":
    case "observe-only":
      return "observe_only";
    case "approved_apps_only":
    case "control-approved-apps":
      return "approved_apps_only";
    case "foreground_supervised":
      return "foreground_supervised";
    case "elevated_watch_mode":
    case "elevated-watch":
      return "elevated_watch_mode";
    default:
      return null;
  }
}

function mergeRuleScope(
  current: ComputerSessionPolicy["allow"],
  patch: Partial<ComputerSessionPolicy["allow"]> | null | undefined,
): ComputerSessionPolicy["allow"] {
  if (!patch) {
    return {
      apps: [...current.apps],
      paths: [...current.paths],
      hosts: [...current.hosts],
      actions: [...current.actions],
      surfaces: [...current.surfaces],
    };
  }
  return {
    apps: patch.apps ? uniqStrings(patch.apps) : [...current.apps],
    paths: patch.paths ? uniqStrings(patch.paths) : [...current.paths],
    hosts: patch.hosts ? uniqStrings(patch.hosts) : [...current.hosts],
    actions: patch.actions ? uniqActions(patch.actions) : [...current.actions],
    surfaces: patch.surfaces ? uniqStrings(patch.surfaces) : [...current.surfaces],
  };
}

export function mergeComputerPolicy(
  current: ComputerSessionPolicy,
  patch: Partial<ComputerSessionPolicy>,
): ComputerSessionPolicy {
  return {
    allow: mergeRuleScope(current.allow, patch.allow),
    deny: mergeRuleScope(current.deny, patch.deny),
    sensitive: mergeRuleScope(current.sensitive, patch.sensitive),
    commandLikeActions: patch.commandLikeActions
      ? uniqActions(patch.commandLikeActions)
      : [...current.commandLikeActions],
    lastDecision: patch.lastDecision === undefined ? current.lastDecision ?? null : patch.lastDecision,
  };
}

function resolveTargetMetadata(
  action: ComputerStructuredAction,
  context?: ComputerObservationContext | null,
  targetAppIdentity?: string | null,
): PolicyMatchContext {
  const appName = context?.activeApp?.name?.trim() || undefined;
  const appBundleId = context?.activeApp?.bundleId?.trim() || undefined;
  const appIdentity = targetAppIdentity?.trim() || appBundleId || appName;
  const url = action.url?.trim() || undefined;
  const host = (() => {
    if (!url) {
      return undefined;
    }
    try {
      return new URL(url).host || undefined;
    } catch {
      return undefined;
    }
  })();
  return {
    action,
    context,
    appIdentity,
    appName,
    appBundleId,
    windowTitle: context?.activeWindow?.title?.trim() || undefined,
    host,
    path: action.path?.trim() || undefined,
    url,
  };
}

function matchesAppRule(value: PolicyMatchContext, patterns: readonly string[]): boolean {
  const haystack = uniqStrings(
    [value.appIdentity, value.appBundleId, value.appName].filter((entry): entry is string => Boolean(entry)),
  ).map((entry) => normalizeText(entry));
  return haystack.some((entry) => includesPattern(entry, patterns));
}

function matchesSurfaceRule(value: PolicyMatchContext, patterns: readonly string[]): boolean {
  return includesPattern(includesAnySurface(value), patterns);
}

function matchesPathRule(value: PolicyMatchContext, patterns: readonly string[]): boolean {
  const path = normalizeText(value.path);
  if (!path) {
    return false;
  }
  return patterns.some((pattern) => {
    const normalized = normalizeText(pattern);
    return normalized ? path.includes(normalized) || path.startsWith(normalized) : false;
  });
}

function matchesHostRule(value: PolicyMatchContext, patterns: readonly string[]): boolean {
  const host = normalizeText(value.host);
  if (!host) {
    return false;
  }
  return patterns.some((pattern) => {
    const normalized = normalizeText(pattern);
    if (!normalized) {
      return false;
    }
    if (normalized.startsWith("*.")) {
      const suffix = normalized.slice(1);
      return host.endsWith(suffix);
    }
    return host === normalized || host.endsWith(`.${normalized}`);
  });
}

function buildSafetyEvent(
  type: ComputerSafetyEventType,
  reasonCode: ComputerPolicyReasonCode,
  summary: string,
  match: PolicyMatchContext,
  actionType: ComputerActionType,
  heuristic = true,
): ComputerSafetyEvent {
  return {
    id: randomUUID(),
    at: Date.now(),
    type,
    reasonCode,
    summary,
    heuristic,
    actionType,
    ...(match.appName ? { appName: match.appName } : {}),
    ...(match.appBundleId ? { appBundleId: match.appBundleId } : {}),
    ...(match.windowTitle ? { windowTitle: match.windowTitle } : {}),
    ...(match.host ? { host: match.host } : {}),
    ...(match.path ? { path: match.path } : {}),
  };
}

function collectSafetyEvents(
  match: PolicyMatchContext,
  policy: ComputerSessionPolicy,
): ComputerSafetyEvent[] {
  const events: ComputerSafetyEvent[] = [];
  const pushUnique = (event: ComputerSafetyEvent) => {
    if (events.some((entry) => entry.type === event.type && entry.reasonCode === event.reasonCode)) {
      return;
    }
    events.push(event);
  };

  const surface = includesAnySurface(match);
  const appName = match.appName ?? match.appIdentity ?? "foreground app";
  const actionType = match.action.type;

  if (
    matchesAppRule(match, DEFAULT_EXTERNAL_CONTENT_APPS) &&
    !isPassiveAction(match.action)
  ) {
    pushUnique(
      buildSafetyEvent(
        "untrusted_external_content",
        "untrusted_external_content",
        `${appName} is treated as untrusted external visual content`,
        match,
        actionType,
      ),
    );
  }

  if (
    matchesAppRule(match, policy.sensitive.apps) ||
    matchesPathRule(match, policy.sensitive.paths) ||
    matchesHostRule(match, policy.sensitive.hosts) ||
    matchesSurfaceRule(match, policy.sensitive.surfaces)
  ) {
    pushUnique(
      buildSafetyEvent(
        "sensitive_surface",
        "sensitive_surface",
        `Sensitive surface detected in ${appName}`,
        match,
        actionType,
      ),
    );
  }

  if (includesPattern(surface, DEFAULT_AUTH_PATTERNS)) {
    pushUnique(
      buildSafetyEvent(
        "auth_context_detected",
        "auth_context",
        `Authentication context detected in ${appName}`,
        match,
        actionType,
      ),
    );
  }

  if (includesPattern(surface, DEFAULT_PAYMENT_PATTERNS)) {
    pushUnique(
      buildSafetyEvent(
        "payment_or_credentials_surface",
        "payment_or_credentials_surface",
        `Payment or credentials surface detected in ${appName}`,
        match,
        actionType,
      ),
    );
  }

  if (
    matchesAppRule(match, ["terminal", "iterm", "warp", "ghostty", "kitty", "alacritty", "hyper"]) &&
    (includesPattern(surface, DEFAULT_PROD_TERMINAL_PATTERNS) ||
      isCommandLikeAction(match.action, policy))
  ) {
    pushUnique(
      buildSafetyEvent(
        "prod_terminal_detected",
        "prod_terminal",
        `Production-like terminal context detected in ${appName}`,
        match,
        actionType,
      ),
    );
  }

  if (includesPattern(surface, DEFAULT_PROMPT_INJECTION_PATTERNS)) {
    pushUnique(
      buildSafetyEvent(
        "malicious_instruction_suspected",
        "malicious_instruction_suspected",
        `Possible visual prompt injection detected in ${appName}`,
        match,
        actionType,
      ),
    );
  }

  return events;
}

function resolveSafetyLevel(
  mode: ComputerApprovalMode,
  safetyEvents: readonly ComputerSafetyEvent[],
): ComputerSafetyLevel {
  if (mode === "elevated_watch_mode") {
    return "watch";
  }
  if (
    safetyEvents.some((event) =>
      event.type === "malicious_instruction_suspected" ||
      event.type === "untrusted_external_content" ||
      event.type === "sensitive_surface" ||
      event.type === "prod_terminal_detected" ||
      event.type === "payment_or_credentials_surface" ||
      event.type === "auth_context_detected",
    )
  ) {
    return "watch";
  }
  if (safetyEvents.length > 0) {
    return "elevated";
  }
  return "normal";
}

function firstReasonEvent(
  safetyEvents: readonly ComputerSafetyEvent[],
): ComputerSafetyEvent | undefined {
  return safetyEvents[0];
}

function buildDeniedScopeEvent(
  type: ComputerSafetyEventType,
  reasonCode: ComputerPolicyReasonCode,
  summary: string,
  match: PolicyMatchContext,
): ComputerSafetyEvent {
  return buildSafetyEvent(type, reasonCode, summary, match, match.action.type, false);
}

function actionIsExplicitlyAllowed(
  action: ComputerStructuredAction,
  policy: ComputerSessionPolicy,
): boolean {
  return policy.allow.actions.length === 0 || policy.allow.actions.includes(action.type);
}

export function evaluateComputerActionPolicy(
  params: EvaluateComputerPolicyParams,
): ComputerPolicyEvaluation {
  const match = resolveTargetMetadata(params.action, params.context, params.targetAppIdentity);
  const passive = isPassiveAction(params.action);

  if (params.status === "stopped") {
    return {
      decision: "deny",
      reasonCode: "session_stopped",
      reason: "session stopped",
      appIdentity: match.appIdentity,
      safetyLevel: resolveSafetyLevel(params.mode, []),
      safetyEvents: [],
    };
  }

  if (params.status === "paused") {
    return {
      decision: "deny",
      reasonCode: "session_paused",
      reason: "session paused",
      appIdentity: match.appIdentity,
      safetyLevel: resolveSafetyLevel(params.mode, []),
      safetyEvents: [],
    };
  }

  if (params.pendingApproval) {
    return {
      decision: "deny",
      reasonCode: "approval_pending",
      reason: "computer session is awaiting approval",
      appIdentity: match.appIdentity,
      safetyLevel: resolveSafetyLevel(params.mode, []),
      safetyEvents: [],
    };
  }

  if (!actionIsExplicitlyAllowed(params.action, params.policy)) {
    const event = buildDeniedScopeEvent(
      "scope_escape_attempt",
      "scope_escape_attempt",
      `Action ${params.action.type} is outside the allowed computer policy scope`,
      match,
    );
    return {
      decision: "deny",
      reasonCode: "blocked_action",
      reason: `action ${params.action.type} blocked by computer policy`,
      appIdentity: match.appIdentity,
      safetyLevel: "watch",
      safetyEvents: [event],
    };
  }

  if (params.policy.deny.actions.includes(params.action.type)) {
    const event = buildDeniedScopeEvent(
      "scope_escape_attempt",
      "scope_escape_attempt",
      `Action ${params.action.type} is blocked by local computer policy`,
      match,
    );
    return {
      decision: "deny",
      reasonCode: "blocked_action",
      reason: `action ${params.action.type} blocked by computer policy`,
      appIdentity: match.appIdentity,
      safetyLevel: "watch",
      safetyEvents: [event],
    };
  }

  if (matchesAppRule(match, params.policy.deny.apps)) {
    const event = buildDeniedScopeEvent(
      "scope_escape_attempt",
      "scope_escape_attempt",
      `Target app ${match.appIdentity ?? match.appName ?? "unknown"} is blocked by local computer policy`,
      match,
    );
    return {
      decision: "deny",
      reasonCode: "blocked_app",
      reason: `action targets blocked app ${match.appIdentity ?? match.appName ?? "unknown"}`,
      appIdentity: match.appIdentity,
      safetyLevel: "watch",
      safetyEvents: [event],
    };
  }

  if (matchesPathRule(match, params.policy.deny.paths)) {
    const event = buildDeniedScopeEvent(
      "scope_escape_attempt",
      "scope_escape_attempt",
      `Target path ${match.path ?? "unknown"} is blocked by local computer policy`,
      match,
    );
    return {
      decision: "deny",
      reasonCode: "blocked_path",
      reason: `action targets blocked path ${match.path ?? "unknown"}`,
      appIdentity: match.appIdentity,
      safetyLevel: "watch",
      safetyEvents: [event],
    };
  }

  if (matchesHostRule(match, params.policy.deny.hosts)) {
    const event = buildDeniedScopeEvent(
      "scope_escape_attempt",
      "scope_escape_attempt",
      `Target host ${match.host ?? "unknown"} is blocked by local computer policy`,
      match,
    );
    return {
      decision: "deny",
      reasonCode: "blocked_host",
      reason: `action targets blocked host ${match.host ?? "unknown"}`,
      appIdentity: match.appIdentity,
      safetyLevel: "watch",
      safetyEvents: [event],
    };
  }

  if (
    params.policy.allow.apps.length > 0 &&
    !matchesAppRule(match, params.policy.allow.apps)
  ) {
    const event = buildDeniedScopeEvent(
      "scope_escape_attempt",
      "scope_escape_attempt",
      `Target app ${match.appIdentity ?? match.appName ?? "unknown"} is outside the allowed app scope`,
      match,
    );
    return {
      decision: "deny",
      reasonCode: "scope_escape_attempt",
      reason: `action targets app outside allowed scope ${match.appIdentity ?? match.appName ?? "unknown"}`,
      appIdentity: match.appIdentity,
      safetyLevel: "watch",
      safetyEvents: [event],
    };
  }

  if (
    params.policy.allow.paths.length > 0 &&
    match.path &&
    !matchesPathRule(match, params.policy.allow.paths)
  ) {
    const event = buildDeniedScopeEvent(
      "scope_escape_attempt",
      "scope_escape_attempt",
      `Target path ${match.path} is outside the allowed path scope`,
      match,
    );
    return {
      decision: "deny",
      reasonCode: "scope_escape_attempt",
      reason: `action targets path outside allowed scope ${match.path}`,
      appIdentity: match.appIdentity,
      safetyLevel: "watch",
      safetyEvents: [event],
    };
  }

  if (
    params.policy.allow.hosts.length > 0 &&
    match.host &&
    !matchesHostRule(match, params.policy.allow.hosts)
  ) {
    const event = buildDeniedScopeEvent(
      "scope_escape_attempt",
      "scope_escape_attempt",
      `Target host ${match.host} is outside the allowed host scope`,
      match,
    );
    return {
      decision: "deny",
      reasonCode: "scope_escape_attempt",
      reason: `action targets host outside allowed scope ${match.host}`,
      appIdentity: match.appIdentity,
      safetyLevel: "watch",
      safetyEvents: [event],
    };
  }

  if (params.mode === "observe_only" && !passive) {
    return {
      decision: "deny",
      reasonCode: "observe_only_block",
      reason: "observe_only mode blocks control actions",
      appIdentity: match.appIdentity,
      safetyLevel: resolveSafetyLevel(params.mode, []),
      safetyEvents: [],
    };
  }

  const safetyEvents = collectSafetyEvents(match, params.policy);
  const safetyLevel = resolveSafetyLevel(params.mode, safetyEvents);
  const approvedBySession =
    !!match.appIdentity &&
    params.approvedApps.some((entry) => normalizeText(entry) === normalizeText(match.appIdentity));
  const approvedByPolicy =
    params.policy.allow.apps.length > 0 && matchesAppRule(match, params.policy.allow.apps);
  const appApproved = approvedBySession || approvedByPolicy;
  const sensitiveAction = isSensitiveComputerAction(params.action, params.policy);
  const reasonEvent = firstReasonEvent(safetyEvents);

  if (params.mode === "approved_apps_only") {
    if (!passive && !appApproved) {
      return {
        decision: "require_session",
        reasonCode: "unapproved_app",
        reason: match.appIdentity
          ? `action targets unapproved app ${match.appIdentity}`
          : "action targets an unapproved app",
        appIdentity: match.appIdentity,
        safetyLevel,
        safetyEvents,
      };
    }
    if (reasonEvent || sensitiveAction) {
      return {
        decision: "require_once",
        reasonCode: reasonEvent?.reasonCode ?? "sensitive_surface",
        reason:
          reasonEvent?.summary ??
          "approved_apps_only mode requires one-time approval for sensitive actions",
        appIdentity: match.appIdentity,
        safetyLevel,
        safetyEvents,
      };
    }
    return {
      decision: "allow",
      reasonCode: "foreground_supervision",
      reason: "action allowed in approved_apps_only mode",
      appIdentity: match.appIdentity,
      safetyLevel,
      safetyEvents,
    };
  }

  const escalatedMode =
    params.mode === "foreground_supervised" && safetyLevel === "watch"
      ? "elevated_watch_mode"
      : undefined;

  if (params.mode === "foreground_supervised") {
    if (reasonEvent || sensitiveAction) {
      return {
        decision: "require_once",
        reasonCode: reasonEvent?.reasonCode ?? "foreground_supervision",
        reason:
          reasonEvent?.summary ??
          "foreground_supervised mode requires one-time approval for this action",
        appIdentity: match.appIdentity,
        escalatedMode,
        safetyLevel,
        safetyEvents,
      };
    }
    return {
      decision: "allow",
      reasonCode: "foreground_supervision",
      reason: "action allowed in foreground_supervised mode",
      appIdentity: match.appIdentity,
      safetyLevel,
      safetyEvents,
    };
  }

  if (params.mode === "elevated_watch_mode") {
    if (!passive || reasonEvent || sensitiveAction) {
      return {
        decision: "require_once",
        reasonCode: reasonEvent?.reasonCode ?? "elevated_watch_mode",
        reason:
          reasonEvent?.summary ??
          "elevated_watch_mode requires one-time approval for control actions",
        appIdentity: match.appIdentity,
        safetyLevel,
        safetyEvents,
      };
    }
    return {
      decision: "allow",
      reasonCode: "elevated_watch_mode",
      reason: "passive action allowed in elevated_watch_mode",
      appIdentity: match.appIdentity,
      safetyLevel,
      safetyEvents,
    };
  }

  return {
    decision: reasonEvent || sensitiveAction ? "require_once" : "allow",
    reasonCode: reasonEvent?.reasonCode ?? "foreground_supervision",
    reason:
      reasonEvent?.summary ??
      (sensitiveAction
        ? "one-time approval required for sensitive action"
        : "action allowed"),
    appIdentity: match.appIdentity,
    safetyLevel,
    safetyEvents,
  };
}
