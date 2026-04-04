import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type {
  DevicePairingList,
  DeviceTokenSummary,
  PairedDevice,
  PendingDevice,
} from "../controllers/devices.ts";
import type { ExecApprovalsFile, ExecApprovalsSnapshot } from "../controllers/exec-approvals.ts";
import { formatRelativeTimestamp, formatList } from "../format.ts";
import { renderExecApprovals, resolveExecApprovalsState } from "./nodes-exec-approvals.ts";
import { resolveConfigAgents, resolveNodeTargets, type NodeTargetOption } from "./nodes-shared.ts";
export type NodesProps = {
  loading: boolean;
  nodes: Array<Record<string, unknown>>;
  devicesLoading: boolean;
  devicesError: string | null;
  devicesList: DevicePairingList | null;
  configForm: Record<string, unknown> | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  configFormMode: "form" | "raw";
  execApprovalsLoading: boolean;
  execApprovalsSaving: boolean;
  execApprovalsDirty: boolean;
  execApprovalsSnapshot: ExecApprovalsSnapshot | null;
  execApprovalsForm: ExecApprovalsFile | null;
  execApprovalsSelectedAgent: string | null;
  execApprovalsTarget: "gateway" | "node";
  execApprovalsTargetNodeId: string | null;
  onRefresh: () => void;
  onDevicesRefresh: () => void;
  onDeviceApprove: (requestId: string) => void;
  onDeviceReject: (requestId: string) => void;
  onDeviceRotate: (deviceId: string, role: string, scopes?: string[]) => void;
  onDeviceRevoke: (deviceId: string, role: string) => void;
  onLoadConfig: () => void;
  onLoadExecApprovals: () => void;
  onBindDefault: (nodeId: string | null) => void;
  onBindAgent: (agentIndex: number, nodeId: string | null) => void;
  onSaveBindings: () => void;
  onExecApprovalsTargetChange: (kind: "gateway" | "node", nodeId: string | null) => void;
  onExecApprovalsSelectAgent: (agentId: string) => void;
  onExecApprovalsPatch: (path: Array<string | number>, value: unknown) => void;
  onExecApprovalsRemove: (path: Array<string | number>) => void;
  onSaveExecApprovals: () => void;
};

export function renderNodes(props: NodesProps, opts?: { includeExecApprovals?: boolean }) {
  const bindingState = resolveBindingsState(props);
  const approvalsState = resolveExecApprovalsState(props);
  const includeExecApprovals = opts?.includeExecApprovals ?? true;
  const text = {
    nodesTitle: t("alisio.connections.nodes.title"),
    nodesSubtitle: t("alisio.connections.nodes.subtitle"),
    loading: t("alisio.connections.loading"),
    refresh: t("common.refresh"),
    noNodes: t("alisio.connections.nodes.empty"),
  };
  return html`
    ${includeExecApprovals ? renderExecApprovals(approvalsState) : nothing}
    ${renderBindings(bindingState)} ${renderDevices(props)}
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">${text.nodesTitle}</div>
          <div class="card-sub">${text.nodesSubtitle}</div>
        </div>
        <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
          ${props.loading ? text.loading : text.refresh}
        </button>
      </div>
      <div class="list" style="margin-top: 16px;">
        ${props.nodes.length === 0
          ? html` <div class="muted">${text.noNodes}</div> `
          : props.nodes.map((n) => renderNode(n))}
      </div>
    </section>
  `;
}

function renderDevices(props: NodesProps) {
  const list = props.devicesList ?? { pending: [], paired: [] };
  const pending = Array.isArray(list.pending) ? list.pending : [];
  const paired = Array.isArray(list.paired) ? list.paired : [];
  const text = {
    title: t("alisio.connections.devices.title"),
    subtitle: t("alisio.connections.devices.subtitle"),
    loading: t("alisio.connections.loading"),
    refresh: t("common.refresh"),
    pending: t("alisio.connections.devices.pending"),
    paired: t("alisio.connections.devices.paired"),
    empty: t("alisio.connections.devices.empty"),
  };
  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">${text.title}</div>
          <div class="card-sub">${text.subtitle}</div>
        </div>
        <button class="btn" ?disabled=${props.devicesLoading} @click=${props.onDevicesRefresh}>
          ${props.devicesLoading ? text.loading : text.refresh}
        </button>
      </div>
      ${props.devicesError
        ? html`<div class="callout danger" style="margin-top: 12px;">${props.devicesError}</div>`
        : nothing}
      <div class="list" style="margin-top: 16px;">
        ${pending.length > 0
          ? html`
              <div class="muted" style="margin-bottom: 8px;">${text.pending}</div>
              ${pending.map((req) => renderPendingDevice(req, props))}
            `
          : nothing}
        ${paired.length > 0
          ? html`
              <div class="muted" style="margin-top: 12px; margin-bottom: 8px;">${text.paired}</div>
              ${paired.map((device) => renderPairedDevice(device, props))}
            `
          : nothing}
        ${pending.length === 0 && paired.length === 0
          ? html` <div class="muted">${text.empty}</div> `
          : nothing}
      </div>
    </section>
  `;
}

function renderPendingDevice(req: PendingDevice, props: NodesProps) {
  const name = req.displayName?.trim() || req.deviceId;
  const age = typeof req.ts === "number" ? formatRelativeTimestamp(req.ts) : t("common.na");
  const roleValue = req.role?.trim() || formatList(req.roles);
  const scopesValue = formatList(req.scopes);
  const repair = req.isRepair ? ` · ${t("alisio.connections.devices.repair")}` : "";
  const ip = req.remoteIp ? ` · ${req.remoteIp}` : "";
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">${name}</div>
        <div class="list-sub">${req.deviceId}${ip}</div>
        <div class="muted" style="margin-top: 6px;">
          ${t("alisio.connections.devices.requestMeta", {
            role: roleValue,
            scopes: scopesValue,
            age,
          })}${repair}
        </div>
      </div>
      <div class="list-meta">
        <div class="row" style="justify-content: flex-end; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn--sm primary" @click=${() => props.onDeviceApprove(req.requestId)}>
            ${t("alisio.connections.devices.approve")}
          </button>
          <button class="btn btn--sm" @click=${() => props.onDeviceReject(req.requestId)}>
            ${t("alisio.connections.devices.reject")}
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderPairedDevice(device: PairedDevice, props: NodesProps) {
  const name = device.displayName?.trim() || device.deviceId;
  const ip = device.remoteIp ? ` · ${device.remoteIp}` : "";
  const roles = t("alisio.connections.devices.roles", { values: formatList(device.roles) });
  const scopes = t("alisio.connections.devices.scopes", { values: formatList(device.scopes) });
  const tokens = Array.isArray(device.tokens) ? device.tokens : [];
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">${name}</div>
        <div class="list-sub">${device.deviceId}${ip}</div>
        <div class="muted" style="margin-top: 6px;">${roles} · ${scopes}</div>
        ${tokens.length === 0
          ? html`
              <div class="muted" style="margin-top: 6px">
                ${t("alisio.connections.devices.tokensNone")}
              </div>
            `
          : html`
              <div class="muted" style="margin-top: 10px;">
                ${t("alisio.connections.devices.tokens")}
              </div>
              <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 6px;">
                ${tokens.map((token) => renderTokenRow(device.deviceId, token, props))}
              </div>
            `}
      </div>
    </div>
  `;
}

function renderTokenRow(deviceId: string, token: DeviceTokenSummary, props: NodesProps) {
  const status = token.revokedAtMs
    ? t("alisio.connections.devices.tokenStatus.revoked")
    : t("alisio.connections.devices.tokenStatus.active");
  const scopes = t("alisio.connections.devices.scopes", { values: formatList(token.scopes) });
  const when = formatRelativeTimestamp(
    token.rotatedAtMs ?? token.createdAtMs ?? token.lastUsedAtMs ?? null,
  );
  return html`
    <div class="row" style="justify-content: space-between; gap: 8px;">
      <div class="list-sub">${token.role} · ${status} · ${scopes} · ${when}</div>
      <div class="row" style="justify-content: flex-end; gap: 6px; flex-wrap: wrap;">
        <button
          class="btn btn--sm"
          @click=${() => props.onDeviceRotate(deviceId, token.role, token.scopes)}
        >
          ${t("alisio.connections.devices.rotate")}
        </button>
        ${token.revokedAtMs
          ? nothing
          : html`
              <button
                class="btn btn--sm danger"
                @click=${() => props.onDeviceRevoke(deviceId, token.role)}
              >
                ${t("alisio.connections.devices.revoke")}
              </button>
            `}
      </div>
    </div>
  `;
}

type BindingAgent = {
  id: string;
  name: string | undefined;
  index: number;
  isDefault: boolean;
  binding: string | null;
};

type BindingNode = NodeTargetOption;

type BindingState = {
  ready: boolean;
  disabled: boolean;
  configDirty: boolean;
  configLoading: boolean;
  configSaving: boolean;
  defaultBinding?: string | null;
  agents: BindingAgent[];
  nodes: BindingNode[];
  onBindDefault: (nodeId: string | null) => void;
  onBindAgent: (agentIndex: number, nodeId: string | null) => void;
  onSave: () => void;
  onLoadConfig: () => void;
  formMode: "form" | "raw";
};

function resolveBindingsState(props: NodesProps): BindingState {
  const config = props.configForm;
  const nodes = resolveExecNodes(props.nodes);
  const { defaultBinding, agents } = resolveAgentBindings(config);
  const ready = Boolean(config);
  const disabled = props.configSaving || props.configFormMode === "raw";
  return {
    ready,
    disabled,
    configDirty: props.configDirty,
    configLoading: props.configLoading,
    configSaving: props.configSaving,
    defaultBinding,
    agents,
    nodes,
    onBindDefault: props.onBindDefault,
    onBindAgent: props.onBindAgent,
    onSave: props.onSaveBindings,
    onLoadConfig: props.onLoadConfig,
    formMode: props.configFormMode,
  };
}

function renderBindings(state: BindingState) {
  const supportsBinding = state.nodes.length > 0;
  const defaultValue = state.defaultBinding ?? "";
  const text = {
    title: t("alisio.connections.bindings.title"),
    subtitle: t("alisio.connections.bindings.subtitle"),
    saving: t("alisio.connections.saving"),
    save: t("alisio.connections.save"),
    rawMode: t("alisio.connections.bindings.rawMode"),
    loadConfig: t("alisio.connections.bindings.loadConfig"),
    loading: t("alisio.connections.loading"),
    defaultBinding: t("alisio.connections.bindings.defaultBinding"),
    defaultSubtitle: t("alisio.connections.bindings.defaultSubtitle"),
    node: t("alisio.connections.bindings.node"),
    anyNode: t("alisio.connections.bindings.anyNode"),
    noExecNodes: t("alisio.connections.bindings.noExecNodes"),
    noAgents: t("alisio.connections.bindings.noAgents"),
    binding: t("alisio.connections.bindings.binding"),
    useDefault: t("alisio.connections.bindings.useDefault"),
    defaultAgent: t("alisio.connections.bindings.defaultAgent"),
    agent: t("alisio.connections.bindings.agent"),
    usesDefault: t("alisio.connections.bindings.usesDefault"),
    override: t("alisio.connections.bindings.override"),
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
          ?disabled=${state.disabled || !state.configDirty}
          @click=${state.onSave}
        >
          ${state.configSaving ? text.saving : text.save}
        </button>
      </div>

      ${state.formMode === "raw"
        ? html` <div class="callout warn" style="margin-top: 12px">${text.rawMode}</div> `
        : nothing}
      ${!state.ready
        ? html`<div class="row" style="margin-top: 12px; gap: 12px;">
            <div class="muted">${text.loadConfig}</div>
            <button class="btn" ?disabled=${state.configLoading} @click=${state.onLoadConfig}>
              ${state.configLoading ? text.loading : text.loadConfig}
            </button>
          </div>`
        : html`
            <div class="list" style="margin-top: 16px;">
              <div class="list-item">
                <div class="list-main">
                  <div class="list-title">${text.defaultBinding}</div>
                  <div class="list-sub">${text.defaultSubtitle}</div>
                </div>
                <div class="list-meta">
                  <label class="field">
                    <span>${text.node}</span>
                    <select
                      ?disabled=${state.disabled || !supportsBinding}
                      @change=${(event: Event) => {
                        const target = event.target as HTMLSelectElement;
                        const value = target.value.trim();
                        state.onBindDefault(value ? value : null);
                      }}
                    >
                      <option value="" ?selected=${defaultValue === ""}>${text.anyNode}</option>
                      ${state.nodes.map(
                        (node) =>
                          html`<option value=${node.id} ?selected=${defaultValue === node.id}>
                            ${node.label}
                          </option>`,
                      )}
                    </select>
                  </label>
                  ${!supportsBinding
                    ? html` <div class="muted">${text.noExecNodes}</div> `
                    : nothing}
                </div>
              </div>

              ${state.agents.length === 0
                ? html` <div class="muted">${text.noAgents}</div> `
                : state.agents.map((agent) => renderAgentBinding(agent, state))}
            </div>
          `}
    </section>
  `;
}

function renderAgentBinding(agent: BindingAgent, state: BindingState) {
  const bindingValue = agent.binding ?? "__default__";
  const label = agent.name?.trim() ? `${agent.name} (${agent.id})` : agent.id;
  const supportsBinding = state.nodes.length > 0;
  const isDefault = agent.isDefault;
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">${label}</div>
        <div class="list-sub">
          ${isDefault
            ? t("alisio.connections.bindings.defaultAgent")
            : t("alisio.connections.bindings.agent")}
          ·
          ${bindingValue === "__default__"
            ? t("alisio.connections.bindings.usesDefault", {
                value: state.defaultBinding ?? t("alisio.connections.bindings.anyNode"),
              })
            : t("alisio.connections.bindings.override", { value: agent.binding ?? "" })}
        </div>
      </div>
      <div class="list-meta">
        <label class="field">
          <span>${t("alisio.connections.bindings.binding")}</span>
          <select
            ?disabled=${state.disabled || !supportsBinding}
            @change=${(event: Event) => {
              const target = event.target as HTMLSelectElement;
              const value = target.value.trim();
              state.onBindAgent(agent.index, value === "__default__" ? null : value);
            }}
          >
            <option value="__default__" ?selected=${bindingValue === "__default__"}>
              ${t("alisio.connections.bindings.useDefault")}
            </option>
            ${state.nodes.map(
              (node) =>
                html`<option value=${node.id} ?selected=${bindingValue === node.id}>
                  ${node.label}
                </option>`,
            )}
          </select>
        </label>
      </div>
    </div>
  `;
}

function resolveExecNodes(nodes: Array<Record<string, unknown>>): BindingNode[] {
  return resolveNodeTargets(nodes, ["system.run"]);
}

function resolveAgentBindings(config: Record<string, unknown> | null): {
  defaultBinding?: string | null;
  agents: BindingAgent[];
} {
  const fallbackAgent: BindingAgent = {
    id: "main",
    name: undefined,
    index: 0,
    isDefault: true,
    binding: null,
  };
  if (!config || typeof config !== "object") {
    return { defaultBinding: null, agents: [fallbackAgent] };
  }
  const tools = (config.tools ?? {}) as Record<string, unknown>;
  const exec = (tools.exec ?? {}) as Record<string, unknown>;
  const defaultBinding =
    typeof exec.node === "string" && exec.node.trim() ? exec.node.trim() : null;

  const agentsNode = (config.agents ?? {}) as Record<string, unknown>;
  if (!Array.isArray(agentsNode.list) || agentsNode.list.length === 0) {
    return { defaultBinding, agents: [fallbackAgent] };
  }

  const agents = resolveConfigAgents(config).map((entry) => {
    const toolsEntry = (entry.record.tools ?? {}) as Record<string, unknown>;
    const execEntry = (toolsEntry.exec ?? {}) as Record<string, unknown>;
    const binding =
      typeof execEntry.node === "string" && execEntry.node.trim() ? execEntry.node.trim() : null;
    return {
      id: entry.id,
      name: entry.name,
      index: entry.index,
      isDefault: entry.isDefault,
      binding,
    };
  });

  if (agents.length === 0) {
    agents.push(fallbackAgent);
  }

  return { defaultBinding, agents };
}

function renderNode(node: Record<string, unknown>) {
  const connected = Boolean(node.connected);
  const paired = Boolean(node.paired);
  const title =
    (typeof node.displayName === "string" && node.displayName.trim()) ||
    (typeof node.nodeId === "string" ? node.nodeId : "unknown");
  const caps = Array.isArray(node.caps) ? (node.caps as unknown[]) : [];
  const capabilities = Array.isArray(node.capabilities) ? (node.capabilities as unknown[]) : [];
  const commands = Array.isArray(node.commands) ? (node.commands as unknown[]) : [];
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">${title}</div>
        <div class="list-sub">
          ${typeof node.nodeId === "string" ? node.nodeId : ""}
          ${typeof node.remoteIp === "string" ? ` · ${node.remoteIp}` : ""}
          ${typeof node.version === "string" ? ` · ${node.version}` : ""}
        </div>
        <div class="chip-row" style="margin-top: 6px;">
          <span class="chip">
            ${paired
              ? t("alisio.connections.nodes.paired")
              : t("alisio.connections.nodes.unpaired")}
          </span>
          <span class="chip ${connected ? "chip-ok" : "chip-warn"}">
            ${connected
              ? t("alisio.connections.nodes.connected")
              : t("alisio.connections.nodes.offline")}
          </span>
          ${caps.slice(0, 12).map((c) => html`<span class="chip">${String(c)}</span>`)}
          ${capabilities
            .slice(0, 6)
            .map(
              (capability) =>
                html`<span class="chip"
                  >${renderCapabilityChip(capability as Record<string, unknown>)}</span
                >`,
            )}
          ${commands.slice(0, 8).map((c) => html`<span class="chip">${String(c)}</span>`)}
        </div>
      </div>
    </div>
  `;
}

function renderCapabilityChip(capability: Record<string, unknown>) {
  const title =
    (typeof capability.title === "string" && capability.title.trim()) ||
    (typeof capability.id === "string" && capability.id.trim()) ||
    "capability";
  const risk =
    typeof capability.risk === "string" && capability.risk.trim() ? capability.risk.trim() : "";
  return risk ? `${title} · ${risk}` : title;
}
