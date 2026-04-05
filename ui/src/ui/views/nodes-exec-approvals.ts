import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import {
  type ExecApprovalsResolvedDefaults,
  type ExecAsk,
  type ExecSecurity,
  DEFAULT_EXEC_ASK_FALLBACK,
  DEFAULT_EXEC_AUTO_ALLOW_SKILLS,
  DEFAULT_GATEWAY_EXEC_ASK,
  DEFAULT_GATEWAY_EXEC_SECURITY,
  EXEC_APPROVALS_FULL_ACCESS_DEFAULTS,
  EXEC_APPROVALS_RECOMMENDED_DEFAULTS,
  normalizeExecApprovalsAsk,
  normalizeExecApprovalsSecurity,
  resolveExecApprovalAccessMode,
  resolveExecApprovalsDefaults,
} from "../controllers/exec-approvals-policy.ts";
import type {
  ExecApprovalsAllowlistEntry,
  ExecApprovalsFile,
  ExecApprovalsSnapshot,
} from "../controllers/exec-approvals.ts";
import { clampText, formatRelativeTimestamp } from "../format.ts";
import {
  resolveAgentDisplayLabel,
  resolvePrimaryAssistantAgentId,
  type AgentDisplayOptions,
} from "./agent-display.ts";
import {
  resolveConfigAgents as resolveSharedConfigAgents,
  resolveNodeTargets,
  type NodeTargetOption,
} from "./nodes-shared.ts";

type ExecApprovalsAgentOption = {
  id: string;
  name?: string;
  isDefault?: boolean;
};

type ExecApprovalsTargetNode = NodeTargetOption;

export type ExecApprovalsViewProps = {
  assistantName: string;
  assistantAgentId: string | null;
  nodes: Array<Record<string, unknown>>;
  configForm: Record<string, unknown> | null;
  execApprovalsLoading: boolean;
  execApprovalsSaving: boolean;
  execApprovalsDirty: boolean;
  execApprovalsSnapshot: ExecApprovalsSnapshot | null;
  execApprovalsForm: ExecApprovalsFile | null;
  execApprovalsSelectedAgent: string | null;
  execApprovalsTarget: "gateway" | "node";
  execApprovalsTargetNodeId: string | null;
  onExecApprovalsTargetChange: (kind: "gateway" | "node", nodeId: string | null) => void;
  onExecApprovalsSelectAgent: (agentId: string) => void;
  onExecApprovalsPatch: (path: Array<string | number>, value: unknown) => void;
  onExecApprovalsRemove: (path: Array<string | number>) => void;
  onLoadExecApprovals: () => void;
  onSaveExecApprovals: () => void;
};

type ExecApprovalsState = {
  assistantName: string;
  assistantAgentId: string | null;
  primaryAgentId: string;
  ready: boolean;
  disabled: boolean;
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  form: ExecApprovalsFile | null;
  defaults: ExecApprovalsResolvedDefaults;
  selectedScope: string;
  selectedAgent: Record<string, unknown> | null;
  agents: ExecApprovalsAgentOption[];
  allowlist: ExecApprovalsAllowlistEntry[];
  target: "gateway" | "node";
  targetNodeId: string | null;
  targetNodes: ExecApprovalsTargetNode[];
  onSelectScope: (agentId: string) => void;
  onSelectTarget: (kind: "gateway" | "node", nodeId: string | null) => void;
  onPatch: (path: Array<string | number>, value: unknown) => void;
  onRemove: (path: Array<string | number>) => void;
  onLoad: () => void;
  onSave: () => void;
};

const EXEC_APPROVALS_DEFAULT_SCOPE = "__defaults__";
export {
  DEFAULT_GATEWAY_EXEC_SECURITY,
  DEFAULT_GATEWAY_EXEC_ASK,
  DEFAULT_EXEC_ASK_FALLBACK,
  DEFAULT_EXEC_AUTO_ALLOW_SKILLS,
  EXEC_APPROVALS_RECOMMENDED_DEFAULTS,
  EXEC_APPROVALS_FULL_ACCESS_DEFAULTS,
  normalizeExecApprovalsSecurity,
  normalizeExecApprovalsAsk,
  resolveExecApprovalsDefaults,
  resolveExecApprovalAccessMode,
};

function securityOptions(): Array<{ value: ExecSecurity; label: string }> {
  return [
    { value: "deny", label: t("alisio.connections.execApprovals.securityOptions.deny") },
    {
      value: "allowlist",
      label: t("alisio.connections.execApprovals.securityOptions.allowlist"),
    },
    { value: "full", label: t("alisio.connections.execApprovals.securityOptions.full") },
  ];
}

function askOptions(): Array<{ value: ExecAsk; label: string }> {
  return [
    { value: "off", label: t("alisio.connections.execApprovals.askOptions.off") },
    { value: "on-miss", label: t("alisio.connections.execApprovals.askOptions.onMiss") },
    { value: "always", label: t("alisio.connections.execApprovals.askOptions.always") },
  ];
}

function resolveConfigAgents(config: Record<string, unknown> | null): ExecApprovalsAgentOption[] {
  return resolveSharedConfigAgents(config).map((entry) => ({
    id: entry.id,
    name: entry.name,
    isDefault: entry.isDefault,
  }));
}

function resolveExecApprovalsAgents(
  config: Record<string, unknown> | null,
  form: ExecApprovalsFile | null,
  options: AgentDisplayOptions,
): { agents: ExecApprovalsAgentOption[]; primaryAgentId: string } {
  const configAgents = resolveConfigAgents(config);
  const approvalsAgents = Object.keys(form?.agents ?? {});
  const merged = new Map<string, ExecApprovalsAgentOption>();
  const configDefaultAgentId = configAgents.find((agent) => agent.isDefault)?.id ?? null;
  const primaryAgentId = resolvePrimaryAssistantAgentId({
    ...options,
    primaryAgentId: configDefaultAgentId,
  });
  const resolvedOptions = { ...options, primaryAgentId };
  configAgents.forEach((agent) =>
    merged.set(agent.id, { ...agent, isDefault: agent.isDefault || agent.id === primaryAgentId }),
  );
  approvalsAgents.forEach((id) => {
    if (merged.has(id)) {
      return;
    }
    merged.set(id, { id, isDefault: id === primaryAgentId });
  });
  const agents = Array.from(merged.values());
  if (agents.length === 0) {
    agents.push({ id: primaryAgentId, isDefault: true });
  }
  agents.sort((a, b) => {
    if (a.isDefault && !b.isDefault) {
      return -1;
    }
    if (!a.isDefault && b.isDefault) {
      return 1;
    }
    const aLabel = resolveAgentDisplayLabel(a, resolvedOptions);
    const bLabel = resolveAgentDisplayLabel(b, resolvedOptions);
    return aLabel.localeCompare(bLabel);
  });
  return { agents, primaryAgentId };
}

function resolveExecApprovalsScope(
  selected: string | null,
  agents: ExecApprovalsAgentOption[],
): string {
  if (selected === EXEC_APPROVALS_DEFAULT_SCOPE) {
    return EXEC_APPROVALS_DEFAULT_SCOPE;
  }
  if (selected && agents.some((agent) => agent.id === selected)) {
    return selected;
  }
  return EXEC_APPROVALS_DEFAULT_SCOPE;
}

export function resolveExecApprovalsState(props: ExecApprovalsViewProps): ExecApprovalsState {
  const target = props.execApprovalsTarget;
  let targetNodeId =
    target === "node" && props.execApprovalsTargetNodeId ? props.execApprovalsTargetNodeId : null;
  const targetNodes = resolveExecApprovalsNodes(props.nodes);
  if (target === "node" && targetNodeId && !targetNodes.some((node) => node.id === targetNodeId)) {
    const hasLoadedTargetState = Boolean(
      props.execApprovalsForm ?? props.execApprovalsSnapshot?.file,
    );
    if (!hasLoadedTargetState) {
      targetNodeId = null;
    }
  }
  const targetReady = target !== "node" || Boolean(targetNodeId);
  const form = targetReady
    ? (props.execApprovalsForm ?? props.execApprovalsSnapshot?.file ?? null)
    : null;
  const ready = Boolean(form);
  const defaults = resolveExecApprovalsDefaults(form);
  const { agents, primaryAgentId } = resolveExecApprovalsAgents(props.configForm, form, {
    assistantName: props.assistantName,
    assistantAgentId: props.assistantAgentId,
  });
  const selectedScope = resolveExecApprovalsScope(props.execApprovalsSelectedAgent, agents);
  const selectedAgent =
    selectedScope !== EXEC_APPROVALS_DEFAULT_SCOPE
      ? (((form?.agents ?? {})[selectedScope] as Record<string, unknown> | undefined) ?? null)
      : null;
  const allowlist = Array.isArray((selectedAgent as { allowlist?: unknown })?.allowlist)
    ? ((selectedAgent as { allowlist?: ExecApprovalsAllowlistEntry[] }).allowlist ?? [])
    : [];
  return {
    assistantName: props.assistantName,
    assistantAgentId: props.assistantAgentId,
    primaryAgentId,
    ready,
    disabled: props.execApprovalsSaving || props.execApprovalsLoading,
    dirty: props.execApprovalsDirty,
    loading: props.execApprovalsLoading,
    saving: props.execApprovalsSaving,
    form,
    defaults,
    selectedScope,
    selectedAgent,
    agents,
    allowlist,
    target,
    targetNodeId,
    targetNodes,
    onSelectScope: props.onExecApprovalsSelectAgent,
    onSelectTarget: props.onExecApprovalsTargetChange,
    onPatch: props.onExecApprovalsPatch,
    onRemove: props.onExecApprovalsRemove,
    onLoad: props.onLoadExecApprovals,
    onSave: props.onSaveExecApprovals,
  };
}

type ResolvedExecApprovalsSelection = {
  isDefaults: boolean;
  basePath: Array<string | number>;
  securityValue: ExecSecurity | "__default__";
  askValue: ExecAsk | "__default__";
  askFallbackValue: ExecSecurity | "__default__";
  effectiveSecurity: ExecSecurity;
  effectiveAsk: ExecAsk;
  effectiveAskFallback: ExecSecurity;
  autoEffective: boolean;
  autoIsDefault: boolean;
};

function resolveExecApprovalsSelection(state: ExecApprovalsState): ResolvedExecApprovalsSelection {
  const isDefaults = state.selectedScope === EXEC_APPROVALS_DEFAULT_SCOPE;
  const defaults = state.defaults;
  const agent = state.selectedAgent ?? {};
  const basePath = isDefaults ? ["defaults"] : ["agents", state.selectedScope];
  const agentSecurity =
    typeof agent.security === "string" ? normalizeExecApprovalsSecurity(agent.security) : undefined;
  const agentAsk = typeof agent.ask === "string" ? normalizeExecApprovalsAsk(agent.ask) : undefined;
  const agentAskFallback =
    typeof agent.askFallback === "string"
      ? normalizeExecApprovalsSecurity(agent.askFallback)
      : undefined;
  const autoOverride =
    typeof agent.autoAllowSkills === "boolean" ? agent.autoAllowSkills : undefined;

  return {
    isDefaults,
    basePath,
    securityValue: isDefaults ? defaults.security : (agentSecurity ?? "__default__"),
    askValue: isDefaults ? defaults.ask : (agentAsk ?? "__default__"),
    askFallbackValue: isDefaults ? defaults.askFallback : (agentAskFallback ?? "__default__"),
    effectiveSecurity: agentSecurity ?? defaults.security,
    effectiveAsk: agentAsk ?? defaults.ask,
    effectiveAskFallback: agentAskFallback ?? defaults.askFallback,
    autoEffective: autoOverride ?? defaults.autoAllowSkills,
    autoIsDefault: autoOverride == null,
  };
}

function resolveExecApprovalsTargetLabel(state: ExecApprovalsState): string {
  if (state.target !== "node") {
    return t("alisio.connections.execApprovals.gateway");
  }
  return (
    state.targetNodes.find((node) => node.id === state.targetNodeId)?.label ??
    state.targetNodeId ??
    t("alisio.connections.execApprovals.selectNode")
  );
}

function resolveExecApprovalsScopeLabel(state: ExecApprovalsState): string {
  if (state.selectedScope === EXEC_APPROVALS_DEFAULT_SCOPE) {
    return t("alisio.connections.execApprovals.defaults");
  }
  const agent = state.agents.find((entry) => entry.id === state.selectedScope) ?? {
    id: state.selectedScope,
  };
  return resolveAgentDisplayLabel(agent, {
    assistantName: state.assistantName,
    assistantAgentId: state.assistantAgentId,
    primaryAgentId: state.primaryAgentId,
  });
}

function resolveSecurityLabel(value: ExecSecurity): string {
  return securityOptions().find((option) => option.value === value)?.label ?? value;
}

function resolveAskLabel(value: ExecAsk): string {
  return askOptions().find((option) => option.value === value)?.label ?? value;
}

function renderExecApprovalsSummaryCard(label: string, value: string, note?: string) {
  return html`
    <article class="alisio-exec-approvals-summary-card">
      <span class="alisio-exec-approvals-summary-card__label">${label}</span>
      <strong class="alisio-exec-approvals-summary-card__value">${value}</strong>
      ${note
        ? html`<span class="alisio-exec-approvals-summary-card__note">${note}</span>`
        : nothing}
    </article>
  `;
}

function renderExecApprovalsOverview(state: ExecApprovalsState) {
  const selection = resolveExecApprovalsSelection(state);
  const defaults = state.defaults;
  const securityNote = selection.isDefaults
    ? t("alisio.connections.execApprovals.securityDefault")
    : selection.securityValue === "__default__"
      ? t("alisio.connections.execApprovals.useDefault", {
          value: resolveSecurityLabel(defaults.security),
        })
      : t("alisio.connections.execApprovals.defaultValue", {
          value: resolveSecurityLabel(defaults.security),
        });
  const askNote = selection.isDefaults
    ? t("alisio.connections.execApprovals.askDefault")
    : selection.askValue === "__default__"
      ? t("alisio.connections.execApprovals.useDefault", {
          value: resolveAskLabel(defaults.ask),
        })
      : t("alisio.connections.execApprovals.defaultValue", {
          value: resolveAskLabel(defaults.ask),
        });
  const fallbackNote = selection.isDefaults
    ? t("alisio.connections.execApprovals.askFallbackDefault")
    : selection.askFallbackValue === "__default__"
      ? t("alisio.connections.execApprovals.useDefault", {
          value: resolveSecurityLabel(defaults.askFallback),
        })
      : t("alisio.connections.execApprovals.defaultValue", {
          value: resolveSecurityLabel(defaults.askFallback),
        });

  return html`
    <div class="alisio-exec-approvals-summary">
      ${renderExecApprovalsSummaryCard(
        t("alisio.connections.execApprovals.targetTitle"),
        resolveExecApprovalsTargetLabel(state),
      )}
      ${renderExecApprovalsSummaryCard(
        t("alisio.connections.execApprovals.scope"),
        resolveExecApprovalsScopeLabel(state),
      )}
      ${renderExecApprovalsSummaryCard(
        t("alisio.connections.execApprovals.security"),
        resolveSecurityLabel(selection.effectiveSecurity),
        securityNote,
      )}
      ${renderExecApprovalsSummaryCard(
        t("alisio.connections.execApprovals.ask"),
        resolveAskLabel(selection.effectiveAsk),
        askNote,
      )}
      ${renderExecApprovalsSummaryCard(
        t("alisio.connections.execApprovals.askFallback"),
        resolveSecurityLabel(selection.effectiveAskFallback),
        fallbackNote,
      )}
    </div>
  `;
}

export function renderExecApprovals(state: ExecApprovalsState) {
  const ready = state.ready;
  const targetReady = state.target !== "node" || Boolean(state.targetNodeId);
  const text = {
    title: t("alisio.connections.execApprovals.title"),
    subtitle: t("alisio.connections.execApprovals.subtitle"),
    saving: t("alisio.connections.saving"),
    save: t("alisio.connections.save"),
    loadMessage: t("alisio.connections.execApprovals.loadMessage"),
    loading: t("alisio.connections.loading"),
    loadApprovals: t("alisio.connections.execApprovals.loadApprovals"),
  };
  return html`
    <section class="card">
      <div class="alisio-exec-approvals-head">
        <div>
          <div class="card-title">${text.title}</div>
          <div class="card-sub">${text.subtitle}</div>
        </div>
        <button
          class="btn"
          ?disabled=${state.disabled || !state.dirty || !targetReady}
          @click=${state.onSave}
        >
          ${state.saving ? text.saving : text.save}
        </button>
      </div>

      ${renderExecApprovalsTarget(state)}
      ${!ready
        ? html`<div class="alisio-exec-approvals-load">
            <div class="muted">${text.loadMessage}</div>
            <button class="btn" ?disabled=${state.loading || !targetReady} @click=${state.onLoad}>
              ${state.loading ? text.loading : text.loadApprovals}
            </button>
          </div>`
        : html`
            ${renderExecApprovalsOverview(state)} ${renderExecApprovalsTabs(state)}
            ${renderExecApprovalsPolicy(state)}
            ${state.selectedScope === EXEC_APPROVALS_DEFAULT_SCOPE
              ? nothing
              : renderExecApprovalsAllowlist(state)}
          `}
    </section>
  `;
}

function renderExecApprovalsTarget(state: ExecApprovalsState) {
  const hasNodes = state.targetNodes.length > 0;
  const nodeValue = state.targetNodeId ?? "";
  const targetLocked = state.dirty;
  const text = {
    title: t("alisio.connections.execApprovals.targetTitle"),
    subtitle: t("alisio.connections.execApprovals.targetSubtitle"),
    host: t("alisio.connections.execApprovals.host"),
    gateway: t("alisio.connections.execApprovals.gateway"),
    node: t("alisio.connections.execApprovals.node"),
    selectNode: t("alisio.connections.execApprovals.selectNode"),
    noNodes: t("alisio.connections.execApprovals.noNodes"),
    switchTargetHint: t("alisio.connections.execApprovals.switchTargetHint"),
  };
  return html`
    <div class="alisio-exec-approvals-target">
      <div class="alisio-exec-approvals-target__head">
        <div class="list-title">${text.title}</div>
        <div class="list-sub">${text.subtitle}</div>
      </div>
      <div class="alisio-exec-approvals-target__controls">
        <label class="field alisio-exec-approvals-target__field">
          <span>${text.host}</span>
          <select
            ?disabled=${state.disabled || targetLocked}
            @change=${(event: Event) => {
              const target = event.target as HTMLSelectElement;
              const value = target.value;
              if (value === "node") {
                const first = state.targetNodes[0]?.id ?? null;
                state.onSelectTarget("node", nodeValue || first);
              } else {
                state.onSelectTarget("gateway", null);
              }
            }}
          >
            <option value="gateway" ?selected=${state.target === "gateway"}>${text.gateway}</option>
            <option value="node" ?selected=${state.target === "node"}>${text.node}</option>
          </select>
        </label>
        ${state.target === "node"
          ? html`
              <label class="field alisio-exec-approvals-target__field">
                <span>${text.node}</span>
                <select
                  ?disabled=${state.disabled || targetLocked || !hasNodes}
                  @change=${(event: Event) => {
                    const target = event.target as HTMLSelectElement;
                    const value = target.value.trim();
                    state.onSelectTarget("node", value ? value : null);
                  }}
                >
                  <option value="" ?selected=${nodeValue === ""}>${text.selectNode}</option>
                  ${state.targetNodes.map(
                    (node) =>
                      html`<option value=${node.id} ?selected=${nodeValue === node.id}>
                        ${node.label}
                      </option>`,
                  )}
                </select>
              </label>
            `
          : nothing}
      </div>
      ${state.target === "node" && !hasNodes
        ? html`<div class="muted alisio-exec-approvals-target__note">${text.noNodes}</div>`
        : nothing}
      ${targetLocked
        ? html`
            <div class="muted alisio-exec-approvals-target__note">${text.switchTargetHint}</div>
          `
        : nothing}
    </div>
  `;
}

function renderExecApprovalsTabs(state: ExecApprovalsState) {
  return html`
    <div class="alisio-exec-approvals-scopes">
      <span class="label">${t("alisio.connections.execApprovals.scope")}</span>
      <div class="alisio-exec-approvals-scopes__buttons">
        <button
          class="btn btn--sm ${state.selectedScope === EXEC_APPROVALS_DEFAULT_SCOPE
            ? "active"
            : ""}"
          ?disabled=${state.disabled}
          @click=${() => state.onSelectScope(EXEC_APPROVALS_DEFAULT_SCOPE)}
        >
          ${t("alisio.connections.execApprovals.defaults")}
        </button>
        ${state.agents.map((agent) => {
          const label = resolveAgentDisplayLabel(agent, {
            assistantName: state.assistantName,
            assistantAgentId: state.assistantAgentId,
            primaryAgentId: state.primaryAgentId,
          });
          return html`
            <button
              class="btn btn--sm ${state.selectedScope === agent.id ? "active" : ""}"
              ?disabled=${state.disabled}
              @click=${() => state.onSelectScope(agent.id)}
            >
              ${label}
            </button>
          `;
        })}
      </div>
    </div>
  `;
}

function renderExecApprovalsPolicy(state: ExecApprovalsState) {
  const selection = resolveExecApprovalsSelection(state);
  const { isDefaults, basePath } = selection;
  const defaults = state.defaults;
  const securityChoices = securityOptions();
  const askChoices = askOptions();

  return html`
    <div class="list alisio-exec-approvals-policy">
      <div class="list-item alisio-exec-approvals-policy__item">
        <div class="list-main">
          <div class="list-title">${t("alisio.connections.execApprovals.security")}</div>
          <div class="list-sub">
            ${isDefaults
              ? t("alisio.connections.execApprovals.securityDefault")
              : t("alisio.connections.execApprovals.defaultValue", {
                  value:
                    securityChoices.find((option) => option.value === defaults.security)?.label ??
                    defaults.security,
                })}
          </div>
        </div>
        <div class="list-meta">
          <label class="field">
            <span>${t("alisio.connections.execApprovals.mode")}</span>
            <select
              ?disabled=${state.disabled}
              @change=${(event: Event) => {
                const target = event.target as HTMLSelectElement;
                const value = target.value;
                if (!isDefaults && value === "__default__") {
                  state.onRemove([...basePath, "security"]);
                } else {
                  state.onPatch([...basePath, "security"], value);
                }
              }}
            >
              ${!isDefaults
                ? html`<option
                    value="__default__"
                    ?selected=${selection.securityValue === "__default__"}
                  >
                    ${t("alisio.connections.execApprovals.useDefault", {
                      value:
                        securityChoices.find((option) => option.value === defaults.security)
                          ?.label ?? defaults.security,
                    })}
                  </option>`
                : nothing}
              ${securityChoices.map(
                (option) => html`
                  <option
                    value=${option.value}
                    ?selected=${selection.securityValue === option.value}
                  >
                    ${option.label}
                  </option>
                `,
              )}
            </select>
          </label>
        </div>
      </div>

      <div class="list-item alisio-exec-approvals-policy__item">
        <div class="list-main">
          <div class="list-title">${t("alisio.connections.execApprovals.ask")}</div>
          <div class="list-sub">
            ${isDefaults
              ? t("alisio.connections.execApprovals.askDefault")
              : t("alisio.connections.execApprovals.defaultValue", {
                  value:
                    askChoices.find((option) => option.value === defaults.ask)?.label ??
                    defaults.ask,
                })}
          </div>
        </div>
        <div class="list-meta">
          <label class="field">
            <span>${t("alisio.connections.execApprovals.mode")}</span>
            <select
              ?disabled=${state.disabled}
              @change=${(event: Event) => {
                const target = event.target as HTMLSelectElement;
                const value = target.value;
                if (!isDefaults && value === "__default__") {
                  state.onRemove([...basePath, "ask"]);
                } else {
                  state.onPatch([...basePath, "ask"], value);
                }
              }}
            >
              ${!isDefaults
                ? html`<option
                    value="__default__"
                    ?selected=${selection.askValue === "__default__"}
                  >
                    ${t("alisio.connections.execApprovals.useDefault", {
                      value:
                        askChoices.find((option) => option.value === defaults.ask)?.label ??
                        defaults.ask,
                    })}
                  </option>`
                : nothing}
              ${askChoices.map(
                (option) => html`
                  <option value=${option.value} ?selected=${selection.askValue === option.value}>
                    ${option.label}
                  </option>
                `,
              )}
            </select>
          </label>
        </div>
      </div>

      <div class="list-item alisio-exec-approvals-policy__item">
        <div class="list-main">
          <div class="list-title">${t("alisio.connections.execApprovals.askFallback")}</div>
          <div class="list-sub">
            ${isDefaults
              ? t("alisio.connections.execApprovals.askFallbackDefault")
              : t("alisio.connections.execApprovals.defaultValue", {
                  value:
                    securityChoices.find((option) => option.value === defaults.askFallback)
                      ?.label ?? defaults.askFallback,
                })}
          </div>
        </div>
        <div class="list-meta">
          <label class="field">
            <span>${t("alisio.connections.execApprovals.fallback")}</span>
            <select
              ?disabled=${state.disabled}
              @change=${(event: Event) => {
                const target = event.target as HTMLSelectElement;
                const value = target.value;
                if (!isDefaults && value === "__default__") {
                  state.onRemove([...basePath, "askFallback"]);
                } else {
                  state.onPatch([...basePath, "askFallback"], value);
                }
              }}
            >
              ${!isDefaults
                ? html`<option
                    value="__default__"
                    ?selected=${selection.askFallbackValue === "__default__"}
                  >
                    ${t("alisio.connections.execApprovals.useDefault", {
                      value:
                        securityChoices.find((option) => option.value === defaults.askFallback)
                          ?.label ?? defaults.askFallback,
                    })}
                  </option>`
                : nothing}
              ${securityChoices.map(
                (option) => html`
                  <option
                    value=${option.value}
                    ?selected=${selection.askFallbackValue === option.value}
                  >
                    ${option.label}
                  </option>
                `,
              )}
            </select>
          </label>
        </div>
      </div>

      <div class="list-item alisio-exec-approvals-policy__item">
        <div class="list-main">
          <div class="list-title">${t("alisio.connections.execApprovals.autoAllowTitle")}</div>
          <div class="list-sub">
            ${isDefaults
              ? t("alisio.connections.execApprovals.autoAllowDefault")
              : selection.autoIsDefault
                ? t("alisio.connections.execApprovals.usingDefault", {
                    value: defaults.autoAllowSkills
                      ? t("alisio.connections.execApprovals.toggle.on")
                      : t("alisio.connections.execApprovals.toggle.off"),
                  })
                : t("alisio.connections.execApprovals.overrideValue", {
                    value: selection.autoEffective
                      ? t("alisio.connections.execApprovals.toggle.on")
                      : t("alisio.connections.execApprovals.toggle.off"),
                  })}
          </div>
        </div>
        <div class="list-meta">
          <label class="field">
            <span>${t("common.enabled")}</span>
            <input
              type="checkbox"
              ?disabled=${state.disabled}
              .checked=${selection.autoEffective}
              @change=${(event: Event) => {
                const target = event.target as HTMLInputElement;
                state.onPatch([...basePath, "autoAllowSkills"], target.checked);
              }}
            />
          </label>
          ${!isDefaults && !selection.autoIsDefault
            ? html`<button
                class="btn btn--sm"
                ?disabled=${state.disabled}
                @click=${() => state.onRemove([...basePath, "autoAllowSkills"])}
              >
                ${t("alisio.connections.execApprovals.resetToDefault")}
              </button>`
            : nothing}
        </div>
      </div>
    </div>
  `;
}

function renderExecApprovalsAllowlist(state: ExecApprovalsState) {
  const allowlistPath = ["agents", state.selectedScope, "allowlist"];
  const entries = state.allowlist;
  return html`
    <div class="alisio-exec-approvals-allowlist__head">
      <div>
        <div class="card-title">${t("alisio.connections.execApprovals.allowlistTitle")}</div>
        <div class="card-sub">${t("alisio.connections.execApprovals.allowlistSubtitle")}</div>
      </div>
      <button
        class="btn btn--sm"
        ?disabled=${state.disabled}
        @click=${() => {
          const next = [...entries, { pattern: "" }];
          state.onPatch(allowlistPath, next);
        }}
      >
        ${t("alisio.connections.execApprovals.addPattern")}
      </button>
    </div>
    <div class="list alisio-exec-approvals-allowlist">
      ${entries.length === 0
        ? html`
            <div class="muted">${t("alisio.connections.execApprovals.noAllowlistEntries")}</div>
          `
        : entries.map((entry, index) => renderAllowlistEntry(state, entry, index))}
    </div>
  `;
}

function renderAllowlistEntry(
  state: ExecApprovalsState,
  entry: ExecApprovalsAllowlistEntry,
  index: number,
) {
  const lastUsed = entry.lastUsedAt
    ? formatRelativeTimestamp(entry.lastUsedAt)
    : t("alisio.connections.execApprovals.never");
  const lastCommand = entry.lastUsedCommand ? clampText(entry.lastUsedCommand, 120) : null;
  const lastPath = entry.lastResolvedPath ? clampText(entry.lastResolvedPath, 120) : null;
  return html`
    <div class="list-item alisio-exec-approvals-allowlist__item">
      <div class="list-main">
        <div class="list-title">
          ${entry.pattern?.trim()
            ? entry.pattern
            : t("alisio.connections.execApprovals.newPattern")}
        </div>
        <div class="list-sub">
          ${t("alisio.connections.execApprovals.lastUsed", { value: lastUsed })}
        </div>
        ${lastCommand ? html`<div class="list-sub mono">${lastCommand}</div>` : nothing}
        ${lastPath ? html`<div class="list-sub mono">${lastPath}</div>` : nothing}
      </div>
      <div class="list-meta alisio-exec-approvals-allowlist__controls">
        <label class="field alisio-exec-approvals-allowlist__field">
          <span>${t("alisio.connections.execApprovals.pattern")}</span>
          <input
            type="text"
            .value=${entry.pattern ?? ""}
            ?disabled=${state.disabled}
            @input=${(event: Event) => {
              const target = event.target as HTMLInputElement;
              state.onPatch(
                ["agents", state.selectedScope, "allowlist", index, "pattern"],
                target.value,
              );
            }}
          />
        </label>
        <button
          class="btn btn--sm danger"
          ?disabled=${state.disabled}
          @click=${() => {
            if (state.allowlist.length <= 1) {
              state.onRemove(["agents", state.selectedScope, "allowlist"]);
              return;
            }
            state.onRemove(["agents", state.selectedScope, "allowlist", index]);
          }}
        >
          ${t("alisio.connections.execApprovals.removePattern")}
        </button>
      </div>
    </div>
  `;
}

function resolveExecApprovalsNodes(
  nodes: Array<Record<string, unknown>>,
): ExecApprovalsTargetNode[] {
  return resolveNodeTargets(nodes, ["system.execApprovals.get", "system.execApprovals.set"]);
}
