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
): ExecApprovalsAgentOption[] {
  const configAgents = resolveConfigAgents(config);
  const approvalsAgents = Object.keys(form?.agents ?? {});
  const merged = new Map<string, ExecApprovalsAgentOption>();
  configAgents.forEach((agent) => merged.set(agent.id, agent));
  approvalsAgents.forEach((id) => {
    if (merged.has(id)) {
      return;
    }
    merged.set(id, { id });
  });
  const agents = Array.from(merged.values());
  if (agents.length === 0) {
    agents.push({ id: "main", isDefault: true });
  }
  agents.sort((a, b) => {
    if (a.isDefault && !b.isDefault) {
      return -1;
    }
    if (!a.isDefault && b.isDefault) {
      return 1;
    }
    const aLabel = a.name?.trim() ? a.name : a.id;
    const bLabel = b.name?.trim() ? b.name : b.id;
    return aLabel.localeCompare(bLabel);
  });
  return agents;
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
  const form = props.execApprovalsForm ?? props.execApprovalsSnapshot?.file ?? null;
  const ready = Boolean(form);
  const defaults = resolveExecApprovalsDefaults(form);
  const agents = resolveExecApprovalsAgents(props.configForm, form);
  const targetNodes = resolveExecApprovalsNodes(props.nodes);
  const target = props.execApprovalsTarget;
  let targetNodeId =
    target === "node" && props.execApprovalsTargetNodeId ? props.execApprovalsTargetNodeId : null;
  if (target === "node" && targetNodeId && !targetNodes.some((node) => node.id === targetNodeId)) {
    targetNodeId = null;
  }
  const selectedScope = resolveExecApprovalsScope(props.execApprovalsSelectedAgent, agents);
  const selectedAgent =
    selectedScope !== EXEC_APPROVALS_DEFAULT_SCOPE
      ? (((form?.agents ?? {})[selectedScope] as Record<string, unknown> | undefined) ?? null)
      : null;
  const allowlist = Array.isArray((selectedAgent as { allowlist?: unknown })?.allowlist)
    ? ((selectedAgent as { allowlist?: ExecApprovalsAllowlistEntry[] }).allowlist ?? [])
    : [];
  return {
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
      <div class="row" style="justify-content: space-between; align-items: center;">
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
        ? html`<div class="row" style="margin-top: 12px; gap: 12px;">
            <div class="muted">${text.loadMessage}</div>
            <button class="btn" ?disabled=${state.loading || !targetReady} @click=${state.onLoad}>
              ${state.loading ? text.loading : text.loadApprovals}
            </button>
          </div>`
        : html`
            ${renderExecApprovalsTabs(state)} ${renderExecApprovalsPolicy(state)}
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
  const text = {
    title: t("alisio.connections.execApprovals.targetTitle"),
    subtitle: t("alisio.connections.execApprovals.targetSubtitle"),
    host: t("alisio.connections.execApprovals.host"),
    gateway: t("alisio.connections.execApprovals.gateway"),
    node: t("alisio.connections.execApprovals.node"),
    selectNode: t("alisio.connections.execApprovals.selectNode"),
    noNodes: t("alisio.connections.execApprovals.noNodes"),
  };
  return html`
    <div class="list" style="margin-top: 12px;">
      <div class="list-item">
        <div class="list-main">
          <div class="list-title">${text.title}</div>
          <div class="list-sub">${text.subtitle}</div>
        </div>
        <div class="list-meta">
          <label class="field">
            <span>${text.host}</span>
            <select
              ?disabled=${state.disabled}
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
              <option value="gateway" ?selected=${state.target === "gateway"}>
                ${text.gateway}
              </option>
              <option value="node" ?selected=${state.target === "node"}>${text.node}</option>
            </select>
          </label>
          ${state.target === "node"
            ? html`
                <label class="field">
                  <span>${text.node}</span>
                  <select
                    ?disabled=${state.disabled || !hasNodes}
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
      </div>
      ${state.target === "node" && !hasNodes
        ? html` <div class="muted">${text.noNodes}</div> `
        : nothing}
    </div>
  `;
}

function renderExecApprovalsTabs(state: ExecApprovalsState) {
  return html`
    <div class="row" style="margin-top: 12px; gap: 8px; flex-wrap: wrap;">
      <span class="label">${t("alisio.connections.execApprovals.scope")}</span>
      <div class="row" style="gap: 8px; flex-wrap: wrap;">
        <button
          class="btn btn--sm ${state.selectedScope === EXEC_APPROVALS_DEFAULT_SCOPE
            ? "active"
            : ""}"
          @click=${() => state.onSelectScope(EXEC_APPROVALS_DEFAULT_SCOPE)}
        >
          ${t("alisio.connections.execApprovals.defaults")}
        </button>
        ${state.agents.map((agent) => {
          const label = agent.name?.trim() ? `${agent.name} (${agent.id})` : agent.id;
          return html`
            <button
              class="btn btn--sm ${state.selectedScope === agent.id ? "active" : ""}"
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
  const isDefaults = state.selectedScope === EXEC_APPROVALS_DEFAULT_SCOPE;
  const defaults = state.defaults;
  const agent = state.selectedAgent ?? {};
  const basePath = isDefaults ? ["defaults"] : ["agents", state.selectedScope];
  const agentSecurity = typeof agent.security === "string" ? agent.security : undefined;
  const agentAsk = typeof agent.ask === "string" ? agent.ask : undefined;
  const agentAskFallback = typeof agent.askFallback === "string" ? agent.askFallback : undefined;
  const securityValue = isDefaults ? defaults.security : (agentSecurity ?? "__default__");
  const askValue = isDefaults ? defaults.ask : (agentAsk ?? "__default__");
  const askFallbackValue = isDefaults ? defaults.askFallback : (agentAskFallback ?? "__default__");
  const autoOverride =
    typeof agent.autoAllowSkills === "boolean" ? agent.autoAllowSkills : undefined;
  const autoEffective = autoOverride ?? defaults.autoAllowSkills;
  const autoIsDefault = autoOverride == null;
  const securityChoices = securityOptions();
  const askChoices = askOptions();

  return html`
    <div class="list" style="margin-top: 16px;">
      <div class="list-item">
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
                ? html`<option value="__default__" ?selected=${securityValue === "__default__"}>
                    ${t("alisio.connections.execApprovals.useDefault", {
                      value:
                        securityChoices.find((option) => option.value === defaults.security)
                          ?.label ?? defaults.security,
                    })}
                  </option>`
                : nothing}
              ${securityChoices.map(
                (option) =>
                  html`<option value=${option.value} ?selected=${securityValue === option.value}>
                    ${option.label}
                  </option>`,
              )}
            </select>
          </label>
        </div>
      </div>

      <div class="list-item">
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
                ? html`<option value="__default__" ?selected=${askValue === "__default__"}>
                    ${t("alisio.connections.execApprovals.useDefault", {
                      value:
                        askChoices.find((option) => option.value === defaults.ask)?.label ??
                        defaults.ask,
                    })}
                  </option>`
                : nothing}
              ${askChoices.map(
                (option) =>
                  html`<option value=${option.value} ?selected=${askValue === option.value}>
                    ${option.label}
                  </option>`,
              )}
            </select>
          </label>
        </div>
      </div>

      <div class="list-item">
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
                ? html`<option value="__default__" ?selected=${askFallbackValue === "__default__"}>
                    ${t("alisio.connections.execApprovals.useDefault", {
                      value:
                        securityChoices.find((option) => option.value === defaults.askFallback)
                          ?.label ?? defaults.askFallback,
                    })}
                  </option>`
                : nothing}
              ${securityChoices.map(
                (option) =>
                  html`<option value=${option.value} ?selected=${askFallbackValue === option.value}>
                    ${option.label}
                  </option>`,
              )}
            </select>
          </label>
        </div>
      </div>

      <div class="list-item">
        <div class="list-main">
          <div class="list-title">${t("alisio.connections.execApprovals.autoAllowTitle")}</div>
          <div class="list-sub">
            ${isDefaults
              ? t("alisio.connections.execApprovals.autoAllowDefault")
              : autoIsDefault
                ? t("alisio.connections.execApprovals.usingDefault", {
                    value: defaults.autoAllowSkills
                      ? t("alisio.connections.execApprovals.toggle.on")
                      : t("alisio.connections.execApprovals.toggle.off"),
                  })
                : t("alisio.connections.execApprovals.overrideValue", {
                    value: autoEffective
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
              .checked=${autoEffective}
              @change=${(event: Event) => {
                const target = event.target as HTMLInputElement;
                state.onPatch([...basePath, "autoAllowSkills"], target.checked);
              }}
            />
          </label>
          ${!isDefaults && !autoIsDefault
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
    <div class="row" style="margin-top: 18px; justify-content: space-between;">
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
    <div class="list" style="margin-top: 12px;">
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
    <div class="list-item">
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
      <div class="list-meta">
        <label class="field">
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
