import { getActivePluginRegistry } from "../plugins/runtime.js";

export const ADMIN_SCOPE = "operator.admin" as const;
export const READ_SCOPE = "operator.read" as const;
export const WRITE_SCOPE = "operator.write" as const;
export const APPROVALS_SCOPE = "operator.approvals" as const;
export const PAIRING_SCOPE = "operator.pairing" as const;

export type OperatorScope =
  | typeof ADMIN_SCOPE
  | typeof READ_SCOPE
  | typeof WRITE_SCOPE
  | typeof APPROVALS_SCOPE
  | typeof PAIRING_SCOPE;

export const CLI_DEFAULT_OPERATOR_SCOPES: OperatorScope[] = [
  ADMIN_SCOPE,
  READ_SCOPE,
  WRITE_SCOPE,
  APPROVALS_SCOPE,
  PAIRING_SCOPE,
];

const NODE_ROLE_METHODS = new Set([
  "node.invoke.result",
  "node.task.event",
  "node.task.result",
  "node.event",
  "node.pending.drain",
  "node.canvas.capability.refresh",
  "node.pending.pull",
  "node.pending.ack",
  "skills.bins",
]);

const METHOD_SCOPE_GROUPS: Record<OperatorScope, readonly string[]> = {
  [APPROVALS_SCOPE]: [
    "approval.audit.get",
    "approval.pending.get",
    "exec.approval.request",
    "exec.approval.waitDecision",
    "exec.approval.resolve",
    "plugin.approval.request",
    "plugin.approval.waitDecision",
    "plugin.approval.resolve",
  ],
  [PAIRING_SCOPE]: [
    "channels.pairing.approve",
    "channels.pairing.reject",
    "node.pair.request",
    "node.pair.list",
    "node.pair.reject",
    "node.pair.verify",
    "device.pair.list",
    "device.pair.approve",
    "device.pair.reject",
    "device.pair.remove",
    "device.token.rotate",
    "device.token.revoke",
    "node.rename",
  ],
  [READ_SCOPE]: [
    "health",
    "alisio.account.get",
    "alisio.ai.get",
    "alisio.bootstrap.get",
    "alisio.models.get",
    "alisio.doctor.summary",
    "alisio.providers.get",
    "alisio.organization.get",
    "connectors.catalog",
    "connectors.list",
    "doctor.memory.status",
    "memory.status",
    "logs.tail",
    "channels.status",
    "status",
    "usage.status",
    "usage.cost",
    "tts.status",
    "tts.providers",
    "models.list",
    "tools.catalog",
    "tools.effective",
    "agents.list",
    "agent.identity.get",
    "skills.status",
    "voicewake.get",
    "sessions.list",
    "sessions.get",
    "sessions.preview",
    "sessions.resolve",
    "sessions.subscribe",
    "sessions.unsubscribe",
    "sessions.messages.subscribe",
    "sessions.messages.unsubscribe",
    "sessions.usage",
    "sessions.usage.timeseries",
    "sessions.usage.logs",
    "cron.list",
    "cron.status",
    "cron.runs",
    "tasks.overview",
    "tasks.detail",
    "gateway.identity.get",
    "system-presence",
    "last-heartbeat",
    "node.list",
    "node.describe",
    "devices.list",
    "chat.history",
    "computer.session.get",
    "config.get",
    "config.schema.lookup",
    "talk.config",
    "agents.files.list",
    "agents.files.get",
  ],
  [WRITE_SCOPE]: [
    "send",
    "poll",
    "agent",
    "agent.wait",
    "alisio.account.beginEmailAuth",
    "alisio.account.verifyEmailAuth",
    "alisio.account.beginGoogleAuth",
    "alisio.account.completeEmailLinkAuth",
    "alisio.account.changeEmail",
    "alisio.account.requestRecoveryEmail",
    "alisio.account.updatePassword",
    "alisio.account.signUp",
    "alisio.account.signIn",
    "alisio.account.signOut",
    "alisio.account.requestPasswordReset",
    "alisio.account.completeProfile",
    "alisio.account.update",
    "alisio.ai.beginConnect",
    "alisio.ai.completeConnect",
    "alisio.ai.disconnect",
    "alisio.ai.refreshLimits",
    "alisio.ai.renameProfile",
    "alisio.ai.selectProfile",
    "alisio.organization.set",
    "devices.share.request",
    "devices.share.approve",
    "devices.share.revoke",
    "devices.policy.set",
    "connectors.begin",
    "connectors.complete",
    "connectors.revoke",
    "alisio.models.install",
    "alisio.models.uninstall",
    "wake",
    "talk.mode",
    "talk.speak",
    "tts.enable",
    "tts.disable",
    "tts.convert",
    "tts.setProvider",
    "voicewake.set",
    "node.invoke",
    "node.task.start",
    "node.pair.approve",
    "chat.send",
    "chat.abort",
    "computer.session.update",
    "computer.session.approve",
    "tasks.create",
    "tasks.update",
    "tasks.claim",
    "tasks.release",
    "tasks.spawnChild",
    "tasks.execution.start",
    "tasks.execution.end",
    "tasks.execution.cancel",
    "tasks.approval.request",
    "tasks.approval.decide",
    "tasks.proposal.upsert",
    "tasks.proposal.resolve",
    "tasks.launchFromProposal",
    "tasks.proposal.attachLaunch",
    "tasks.cancel",
    "tasks.notify",
    "memory.e2ee.setup",
    "memory.e2ee.exportPairingCode",
    "memory.e2ee.importPairingCode",
    "sessions.create",
    "sessions.send",
    "sessions.steer",
    "sessions.abort",
    "push.test",
    "node.pending.enqueue",
  ],
  [ADMIN_SCOPE]: [
    "alisio.app.rebuild",
    "alisio.runtime.restart",
    "alisio.security.policy.get",
    "alisio.security.policy.applyProfile",
    "channels.logout",
    "agents.create",
    "agents.update",
    "agents.delete",
    "skills.install",
    "skills.marketplace.install",
    "skills.marketplace.remove",
    "skills.marketplace.execute",
    "skills.update",
    "secrets.reload",
    "secrets.resolve",
    "cron.add",
    "cron.update",
    "cron.remove",
    "cron.run",
    "sessions.patch",
    "sessions.reset",
    "sessions.runtime.reset",
    "sessions.delete",
    "sessions.compact",
    "connect",
    "chat.inject",
    "web.login.start",
    "web.login.wait",
    "set-heartbeats",
    "system-event",
    "memory.sync",
    "agents.files.set",
    "agents.files.delete",
  ],
};

const ADMIN_METHOD_PREFIXES = ["exec.approvals.", "config.", "wizard.", "update."] as const;

const METHOD_SCOPE_BY_NAME = new Map<string, OperatorScope>(
  Object.entries(METHOD_SCOPE_GROUPS).flatMap(([scope, methods]) =>
    methods.map((method) => [method, scope as OperatorScope]),
  ),
);

function resolveScopedMethod(method: string): OperatorScope | undefined {
  const explicitScope = METHOD_SCOPE_BY_NAME.get(method);
  if (explicitScope) {
    return explicitScope;
  }
  const pluginScope = getActivePluginRegistry()?.gatewayMethodScopes?.[method];
  if (pluginScope) {
    return pluginScope;
  }
  if (ADMIN_METHOD_PREFIXES.some((prefix) => method.startsWith(prefix))) {
    return ADMIN_SCOPE;
  }
  return undefined;
}

export function isApprovalMethod(method: string): boolean {
  return resolveScopedMethod(method) === APPROVALS_SCOPE;
}

export function isPairingMethod(method: string): boolean {
  return resolveScopedMethod(method) === PAIRING_SCOPE;
}

export function isReadMethod(method: string): boolean {
  return resolveScopedMethod(method) === READ_SCOPE;
}

export function isWriteMethod(method: string): boolean {
  return resolveScopedMethod(method) === WRITE_SCOPE;
}

export function isNodeRoleMethod(method: string): boolean {
  return NODE_ROLE_METHODS.has(method);
}

export function isAdminOnlyMethod(method: string): boolean {
  return resolveScopedMethod(method) === ADMIN_SCOPE;
}

export function resolveRequiredOperatorScopeForMethod(method: string): OperatorScope | undefined {
  return resolveScopedMethod(method);
}

export function resolveLeastPrivilegeOperatorScopesForMethod(method: string): OperatorScope[] {
  const requiredScope = resolveRequiredOperatorScopeForMethod(method);
  if (requiredScope) {
    return [requiredScope];
  }
  // Default-deny for unclassified methods.
  return [];
}

export function authorizeOperatorScopesForMethod(
  method: string,
  scopes: readonly string[],
): { allowed: true } | { allowed: false; missingScope: OperatorScope } {
  if (scopes.includes(ADMIN_SCOPE)) {
    return { allowed: true };
  }
  const requiredScope = resolveRequiredOperatorScopeForMethod(method) ?? ADMIN_SCOPE;
  if (requiredScope === READ_SCOPE) {
    if (scopes.includes(READ_SCOPE) || scopes.includes(WRITE_SCOPE)) {
      return { allowed: true };
    }
    return { allowed: false, missingScope: READ_SCOPE };
  }
  if (scopes.includes(requiredScope)) {
    return { allowed: true };
  }
  return { allowed: false, missingScope: requiredScope };
}

export function isGatewayMethodClassified(method: string): boolean {
  if (isNodeRoleMethod(method)) {
    return true;
  }
  return resolveRequiredOperatorScopeForMethod(method) !== undefined;
}
