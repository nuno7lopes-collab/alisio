import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type {
  DevicePairingList,
  DeviceTokenSummary,
  PairedDevice,
  PendingDevice,
} from "../controllers/devices.ts";
import type { ExecApprovalsFile, ExecApprovalsSnapshot } from "../controllers/exec-approvals.ts";
import type { PendingNodePairing, RuntimeNodePairingList } from "../controllers/node-pairing.ts";
import { formatRelativeTimestamp, formatList } from "../format.ts";
import { icons } from "../icons.ts";
import type { AlisioSharingState } from "../types.ts";
import {
  renderSkeletonButton,
  renderSkeletonListItem,
  renderSkeletonPill,
} from "./loading-skeleton.ts";
import { renderExecApprovals, resolveExecApprovalsState } from "./nodes-exec-approvals.ts";
import {
  isConnectedNode,
  nodeSupportsExec,
  resolveConfigAgents,
  resolveNodeTargets,
  type NodeTargetOption,
} from "./nodes-shared.ts";

type SharingResourcePolicyMap = NonNullable<
  NonNullable<AlisioSharingState["policy"]["resourcePolicies"]>
>;
export type NodesProps = {
  assistantName: string;
  assistantAgentId: string | null;
  loading: boolean;
  nodes: Array<Record<string, unknown>>;
  nodesError: string | null;
  devicesLoading: boolean;
  devicesError: string | null;
  devicesList: DevicePairingList | null;
  sharingLoading?: boolean;
  sharingError?: string | null;
  sharing?: AlisioSharingState | null;
  nodePairingsLoading: boolean;
  nodePairingsError: string | null;
  nodePairingsList: RuntimeNodePairingList | null;
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
  onSharingRefresh?: () => void;
  onNodePairingsRefresh: () => void;
  onDeviceApprove: (requestId: string) => void;
  onDeviceReject: (requestId: string) => void;
  onDeviceRemove: (deviceId: string) => void;
  onSharingRequest?: (targetId: string, scopes?: readonly string[]) => void;
  onSharingApprove?: (requestId: string, scopes?: readonly string[]) => void;
  onSharingReject?: (requestId: string) => void;
  onSharingRevoke?: (grantId: string) => void;
  onSharingSetPolicy?: (allowExternalUse: boolean) => void;
  onSharingSetResourcePolicy?: (
    resource: keyof SharingResourcePolicyMap,
    mode: SharingResourcePolicyMap[keyof SharingResourcePolicyMap],
  ) => void;
  onNodeApprove: (requestId: string) => void;
  onNodeReject: (requestId: string) => void;
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
  return html`
    ${includeExecApprovals ? renderExecApprovals(approvalsState) : nothing}
    <div class="alisio-connections-layout">
      ${renderDevices(props)} ${renderRuntime(props, bindingState)}
    </div>
  `;
}

function renderPanelCount(value: number | string) {
  return html`<span class="alisio-connections-subsection__count">${value}</span>`;
}

function renderDevices(props: NodesProps) {
  const list = props.devicesList ?? { pending: [], paired: [] };
  const pending = Array.isArray(list.pending) ? list.pending : [];
  const paired = Array.isArray(list.paired) ? list.paired : [];
  const showLoading = props.devicesLoading && !props.devicesList && !props.devicesError;
  const text = {
    title: t("alisio.connections.devices.title"),
    subtitle: t("alisio.connections.devices.subtitle"),
    loading: t("alisio.connections.loading"),
    refresh: t("common.refresh"),
    pending: t("alisio.connections.devices.pending"),
    paired: t("alisio.connections.devices.paired"),
    pendingEmpty: t("alisio.connections.devices.pendingEmpty"),
    empty: t("alisio.connections.devices.empty"),
  };
  return html`
    <section class="card alisio-connections-panel">
      <div class="alisio-connections-panel__head">
        <div class="alisio-connections-panel__identity">
          <span class="alisio-connections-panel__icon" aria-hidden="true">${icons.smartphone}</span>
          <div>
            <div class="card-title">${text.title}</div>
            <div class="card-sub">${text.subtitle}</div>
          </div>
        </div>
        <button
          class="btn btn--ghost"
          ?disabled=${props.devicesLoading}
          @click=${props.onDevicesRefresh}
        >
          ${props.devicesLoading ? text.loading : text.refresh}
        </button>
      </div>
      ${props.devicesError
        ? html`<div class="callout danger" style="margin-top: 12px;">${props.devicesError}</div>`
        : nothing}
      ${showLoading
        ? html`
            <div class="alisio-connections-sections" role="status" aria-label=${text.loading}>
              <section class="alisio-connections-subsection">
                <div class="alisio-connections-subsection__head">
                  <span class="alisio-connections-subsection__title">${text.pending}</span>
                  ${renderSkeletonPill({ small: true })}
                </div>
                <div class="loading-state__list">
                  ${renderSkeletonListItem({ lines: ["medium", "long", "short"], aside: "button" })}
                  ${renderSkeletonListItem({ lines: ["short", "medium"], aside: "button" })}
                </div>
              </section>
              <section class="alisio-connections-subsection">
                <div class="alisio-connections-subsection__head">
                  <span class="alisio-connections-subsection__title">${text.paired}</span>
                  ${renderSkeletonPill({ small: true })}
                </div>
                <div class="loading-state__list">
                  ${renderSkeletonListItem({ lines: ["medium", "long", "short"] })}
                  ${renderSkeletonListItem({ lines: ["short", "medium", "long"] })}
                </div>
              </section>
            </div>
          `
        : html`
            <div class="alisio-connections-sections">
              <section class="alisio-connections-subsection">
                <div class="alisio-connections-subsection__head">
                  <span class="alisio-connections-subsection__title">${text.pending}</span>
                  <span class="alisio-connections-subsection__count">${pending.length}</span>
                </div>
                <div class="list">
                  ${pending.length === 0
                    ? html`<div class="alisio-connections-empty">${text.pendingEmpty}</div>`
                    : pending.map((req) => renderPendingDevice(req, props))}
                </div>
              </section>
              <section class="alisio-connections-subsection">
                <div class="alisio-connections-subsection__head">
                  <span class="alisio-connections-subsection__title">${text.paired}</span>
                  <span class="alisio-connections-subsection__count">${paired.length}</span>
                </div>
                <div class="list">
                  ${paired.length === 0
                    ? html`<div class="alisio-connections-empty">${text.empty}</div>`
                    : paired.map((device) => renderPairedDevice(device, props))}
                </div>
              </section>
            </div>
          `}
    </section>
  `;
}

function renderRuntime(props: NodesProps, state: BindingState) {
  const refreshing =
    props.loading || props.nodePairingsLoading || props.configLoading || props.execApprovalsLoading;
  const showLoading =
    refreshing && props.nodes.length === 0 && !props.configForm && !props.nodePairingsList;
  const text = {
    title: t("alisio.connections.runtimeTitle"),
    subtitle: t("alisio.connections.runtimeSubtitle"),
    loading: t("alisio.connections.loading"),
    refresh: t("common.refresh"),
  };
  return html`
    <section class="card alisio-connections-panel">
      <div class="alisio-connections-panel__head">
        <div class="alisio-connections-panel__identity">
          <span class="alisio-connections-panel__icon" aria-hidden="true">${icons.monitor}</span>
          <div>
            <div class="card-title">${text.title}</div>
            <div class="card-sub">${text.subtitle}</div>
          </div>
        </div>
        <button class="btn btn--ghost" ?disabled=${refreshing} @click=${props.onRefresh}>
          ${refreshing ? text.loading : text.refresh}
        </button>
      </div>
      ${props.nodesError ? html`<div class="callout danger">${props.nodesError}</div>` : nothing}
      ${props.nodePairingsError
        ? html`<div class="callout danger">${props.nodePairingsError}</div>`
        : nothing}
      ${showLoading
        ? html`
            <div class="alisio-connections-runtime-stack" role="status" aria-label=${text.loading}>
              <section class="alisio-connections-subpanel">
                <div class="alisio-connections-subpanel__head">
                  <div>
                    <div class="alisio-connections-subpanel__title">
                      ${t("alisio.connections.nodes.pendingTitle")}
                    </div>
                    <div class="alisio-connections-subpanel__subtitle">
                      ${t("alisio.connections.nodes.pendingSubtitle")}
                    </div>
                  </div>
                  ${renderSkeletonPill({ small: true })}
                </div>
                <div class="loading-state__list">
                  ${renderSkeletonListItem({ lines: ["medium", "long", "short"], aside: "button" })}
                </div>
              </section>
              <section class="alisio-connections-subpanel">
                <div class="alisio-connections-subpanel__head">
                  <div>
                    <div class="alisio-connections-subpanel__title">
                      ${t("alisio.connections.bindings.title")}
                    </div>
                    <div class="alisio-connections-subpanel__subtitle">
                      ${t("alisio.connections.bindings.subtitle")}
                    </div>
                  </div>
                  ${renderSkeletonButton({ small: true })}
                </div>
                <div class="loading-state__list">
                  ${renderSkeletonListItem({ lines: ["medium", "long", "short"], aside: "pill" })}
                  ${renderSkeletonListItem({ lines: ["short", "medium", "long"], aside: "pill" })}
                </div>
              </section>
              <section class="alisio-connections-subpanel">
                <div class="alisio-connections-subpanel__head">
                  <div>
                    <div class="alisio-connections-subpanel__title">
                      ${t("alisio.connections.nodes.title")}
                    </div>
                    <div class="alisio-connections-subpanel__subtitle">
                      ${t("alisio.connections.nodes.subtitle")}
                    </div>
                  </div>
                </div>
                <div class="loading-state__list">
                  ${renderSkeletonListItem({ lines: ["medium", "long", "short"] })}
                  ${renderSkeletonListItem({ lines: ["long", "medium", "short"] })}
                </div>
              </section>
            </div>
          `
        : html`
            <div class="alisio-connections-runtime-stack">
              ${renderPendingNodeRequests(props)} ${renderBindings(state)} ${renderNodeList(props)}
            </div>
          `}
    </section>
  `;
}

function renderPendingNodeRequests(props: NodesProps) {
  const list = props.nodePairingsList ?? { pending: [], paired: [] };
  const pending = Array.isArray(list.pending) ? list.pending : [];
  const refreshing = props.loading || props.nodePairingsLoading;
  const showLoading = refreshing && !props.nodePairingsList && !props.nodePairingsError;
  const text = {
    title: t("alisio.connections.nodes.pendingTitle"),
    subtitle: t("alisio.connections.nodes.pendingSubtitle"),
    pendingEmpty: t("alisio.connections.nodes.pendingEmpty"),
    loading: t("alisio.connections.loading"),
    refresh: t("common.refresh"),
  };
  return html`
    <section class="alisio-connections-subpanel">
      <div class="alisio-connections-subpanel__head">
        <div>
          <div class="alisio-connections-subpanel__title">${text.title}</div>
          <div class="alisio-connections-subpanel__subtitle">${text.subtitle}</div>
        </div>
        <div class="alisio-connections-subpanel__meta">
          ${renderPanelCount(pending.length)}
          <button
            class="btn btn--ghost btn--sm"
            ?disabled=${refreshing}
            @click=${props.onNodePairingsRefresh}
          >
            ${refreshing ? text.loading : text.refresh}
          </button>
        </div>
      </div>
      ${showLoading
        ? html`
            <div class="loading-state__list" role="status" aria-label=${text.loading}>
              ${renderSkeletonListItem({ lines: ["medium", "long", "short"], aside: "button" })}
              ${renderSkeletonListItem({ lines: ["short", "medium"], aside: "button" })}
            </div>
          `
        : html`
            <div class="list">
              ${pending.length === 0
                ? html`<div class="alisio-connections-empty">${text.pendingEmpty}</div>`
                : pending.map((request) => renderPendingNodeRequest(request, props))}
            </div>
          `}
    </section>
  `;
}

function renderPendingNodeRequest(req: PendingNodePairing, props: NodesProps) {
  const title = req.displayName?.trim() || req.nodeId;
  const age = typeof req.ts === "number" ? formatRelativeTimestamp(req.ts) : t("common.na");
  const capabilityCount = Array.isArray(req.caps) ? req.caps.length : 0;
  const commandCount = Array.isArray(req.commands) ? req.commands.length : 0;
  const details = [
    typeof req.platform === "string" && req.platform.trim() ? req.platform.trim() : null,
    typeof req.version === "string" && req.version.trim() ? req.version.trim() : null,
    typeof req.remoteIp === "string" && req.remoteIp.trim() ? req.remoteIp.trim() : null,
    commandCount > 0
      ? t("alisio.connections.nodes.commandsCount", { count: String(commandCount) })
      : null,
    capabilityCount > 0
      ? t("alisio.connections.nodes.capabilitiesCount", { count: String(capabilityCount) })
      : null,
    t("alisio.connections.nodes.requestedAge", { age }),
    req.isRepair ? t("alisio.connections.nodes.repair") : null,
  ].filter((value): value is string => Boolean(value));
  return html`
    <div
      class="list-item alisio-connections-entry alisio-connections-entry--pending alisio-connections-entry--split"
    >
      <div class="list-main">
        <div class="alisio-connections-entry__head">
          <div class="list-title">${title}</div>
          <div class="alisio-connections-entry__pills">
            <span class="pill pill--in-review">${t("alisio.connections.pendingNodes")}</span>
          </div>
        </div>
        <div class="list-sub mono alisio-connections-entry__identifier">${req.nodeId}</div>
        ${details.length > 0
          ? html`<div class="alisio-connections-entry__note">${details.join(" · ")}</div>`
          : nothing}
      </div>
      <div class="list-meta alisio-connections-entry__actions">
        <div class="row alisio-connections-action-row">
          <button class="btn btn--sm primary" @click=${() => props.onNodeApprove(req.requestId)}>
            ${t("alisio.connections.nodes.approve")}
          </button>
          <button class="btn btn--sm" @click=${() => props.onNodeReject(req.requestId)}>
            ${t("alisio.connections.nodes.reject")}
          </button>
        </div>
      </div>
    </div>
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
    <div
      class="list-item alisio-connections-entry alisio-connections-entry--pending alisio-connections-entry--split"
    >
      <div class="list-main">
        <div class="alisio-connections-entry__head">
          <div class="list-title">${name}</div>
          <div class="alisio-connections-entry__pills">
            <span class="pill pill--in-review">${t("alisio.connections.devices.pending")}</span>
          </div>
        </div>
        <div class="list-sub mono alisio-connections-entry__identifier">${req.deviceId}${ip}</div>
        <div class="alisio-connections-entry__note">
          ${t("alisio.connections.devices.requestMeta", {
            role: roleValue,
            scopes: scopesValue,
            age,
          })}${repair}
        </div>
      </div>
      <div class="list-meta alisio-connections-entry__actions">
        <div class="row alisio-connections-action-row">
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
    <div class="list-item alisio-connections-entry alisio-connections-entry--single">
      <div class="list-main">
        <div class="alisio-connections-entry__head">
          <div class="list-title">${name}</div>
          <div class="alisio-connections-entry__pills">
            <span class="pill pill--connected"
              >${tokens.length} ${t("alisio.connections.devices.tokens")}</span
            >
          </div>
        </div>
        <div class="list-sub mono alisio-connections-entry__identifier">
          ${device.deviceId}${ip}
        </div>
        <div class="alisio-connections-entry__note">${roles} · ${scopes}</div>
        ${tokens.length === 0
          ? html`
              <div class="alisio-connections-empty alisio-connections-empty--compact">
                ${t("alisio.connections.devices.tokensNone")}
              </div>
            `
          : html`
              <div class="muted alisio-connections-entry__section-label">
                ${t("alisio.connections.devices.tokens")}
              </div>
              <div class="alisio-token-list">
                ${tokens.map((token) => renderTokenRow(device.deviceId, token, props))}
              </div>
            `}
        <div class="alisio-connections-entry__footer">
          <button class="btn btn--sm danger" @click=${() => props.onDeviceRemove(device.deviceId)}>
            ${t("alisio.connections.devices.remove")}
          </button>
        </div>
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
  const statusClass = token.revokedAtMs ? "" : "pill--connected";
  return html`
    <div class="alisio-token-row">
      <div class="alisio-token-row__main">
        <div class="alisio-token-row__title">
          <strong>${token.role}</strong>
          <span class="pill ${statusClass}">${status}</span>
        </div>
        <div class="alisio-token-row__subtitle">${scopes} · ${when}</div>
      </div>
      <div class="row alisio-connections-action-row">
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
    synced: t("alisio.connections.synced"),
    unsaved: t("alisio.connections.unsaved"),
  };
  const defaultLabel = resolveNodeLabel(state.nodes, state.defaultBinding, text.anyNode);
  const syncLabel = state.configDirty ? text.unsaved : text.synced;
  return html`
    <section class="alisio-connections-subpanel">
      <div class="alisio-connections-subpanel__head">
        <div>
          <div class="alisio-connections-subpanel__title">${text.title}</div>
          <div class="alisio-connections-subpanel__subtitle">${text.subtitle}</div>
        </div>
        <div class="alisio-connections-subpanel__actions">
          ${state.ready
            ? html`
                <span class="pill ${state.configDirty ? "pill--in-review" : "pill--connected"}">
                  ${syncLabel}
                </span>
              `
            : nothing}
          <button
            class="btn btn--sm"
            ?disabled=${state.disabled || !state.configDirty}
            @click=${state.onSave}
          >
            ${state.configSaving ? text.saving : text.save}
          </button>
        </div>
      </div>

      ${state.formMode === "raw"
        ? html` <div class="callout warn" style="margin-top: 12px">${text.rawMode}</div> `
        : nothing}
      ${!state.ready
        ? state.configLoading
          ? html`
              <div class="loading-state__list" role="status" aria-label=${text.loading}>
                ${renderSkeletonListItem({ lines: ["medium", "long", "short"], aside: "button" })}
                ${renderSkeletonListItem({ lines: ["short", "medium"], aside: "button" })}
              </div>
            `
          : html`<div class="alisio-connections-empty">
              <div>${text.loadConfig}</div>
              <button class="btn" ?disabled=${state.configLoading} @click=${state.onLoadConfig}>
                ${state.configLoading ? text.loading : text.loadConfig}
              </button>
            </div>`
        : html`
            <div class="alisio-binding-list">
              <div class="list-item alisio-binding-row alisio-binding-row--split">
                <div class="list-main">
                  <div class="alisio-connections-entry__head">
                    <div class="list-title">${text.defaultBinding}</div>
                    <div class="alisio-connections-entry__pills">
                      <span class="pill">${defaultLabel}</span>
                    </div>
                  </div>
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
  const activeBindingLabel =
    bindingValue === "__default__"
      ? t("alisio.connections.bindings.useDefault")
      : resolveNodeLabel(state.nodes, agent.binding, agent.binding ?? "");
  const inheritedLabel = resolveNodeLabel(
    state.nodes,
    state.defaultBinding,
    t("alisio.connections.bindings.anyNode"),
  );
  const overrideLabel = resolveNodeLabel(state.nodes, agent.binding, agent.binding ?? "");
  return html`
    <div class="list-item alisio-binding-row alisio-binding-row--split">
      <div class="list-main">
        <div class="alisio-connections-entry__head">
          <div class="list-title">${label}</div>
          <div class="alisio-connections-entry__pills">
            <span class="pill">${activeBindingLabel}</span>
          </div>
        </div>
        <div class="list-sub">
          ${isDefault
            ? t("alisio.connections.bindings.defaultAgent")
            : t("alisio.connections.bindings.agent")}
          ·
          ${bindingValue === "__default__"
            ? t("alisio.connections.bindings.usesDefault", {
                value: inheritedLabel,
              })
            : t("alisio.connections.bindings.override", { value: overrideLabel })}
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

function renderNodeList(props: NodesProps) {
  const pairedRuntimeNodes = new Map(
    (props.nodePairingsList?.paired ?? []).map((node) => [node.nodeId, node]),
  );
  const text = {
    nodesTitle: t("alisio.connections.nodes.title"),
    nodesSubtitle: t("alisio.connections.nodes.subtitle"),
    noNodes: t("alisio.connections.nodes.empty"),
  };
  return html`
    <section class="alisio-connections-subpanel">
      <div class="alisio-connections-subpanel__head">
        <div>
          <div class="alisio-connections-subpanel__title">${text.nodesTitle}</div>
          <div class="alisio-connections-subpanel__subtitle">${text.nodesSubtitle}</div>
        </div>
        ${renderPanelCount(props.nodes.length)}
      </div>
      <div class="alisio-node-list">
        ${props.nodes.length === 0
          ? html`<div class="alisio-connections-empty">${text.noNodes}</div>`
          : props.nodes.map((node) => renderNode(node, pairedRuntimeNodes))}
      </div>
    </section>
  `;
}

function resolveExecNodes(nodes: Array<Record<string, unknown>>): BindingNode[] {
  return resolveNodeTargets(nodes, ["system.run"]);
}

function resolveNodeLabel(
  nodes: BindingNode[],
  nodeId: string | null | undefined,
  fallback: string,
): string {
  if (!nodeId) {
    return fallback;
  }
  return nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
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

function resolveNodeCapabilityCount(node: Record<string, unknown>) {
  const capabilities = Array.isArray(node.capabilities) ? node.capabilities : [];
  if (capabilities.length > 0) {
    return capabilities.length;
  }
  return Array.isArray(node.caps) ? node.caps.length : 0;
}

function resolveNodeCommandCount(node: Record<string, unknown>) {
  return Array.isArray(node.commands) ? node.commands.length : 0;
}

function renderNode(
  node: Record<string, unknown>,
  pairedRuntimeNodes: Map<string, RuntimeNodePairingList["paired"][number]>,
) {
  const connected = isConnectedNode(node);
  const paired = Boolean(node.paired);
  const nodeId = typeof node.nodeId === "string" ? node.nodeId : "";
  const title =
    (typeof node.displayName === "string" && node.displayName.trim()) || nodeId || "unknown";
  const pairedInfo = nodeId ? pairedRuntimeNodes.get(nodeId) : undefined;
  const capabilityCount = resolveNodeCapabilityCount(node);
  const commandCount = resolveNodeCommandCount(node);
  const execReady = nodeSupportsExec(node);
  const connectedAtMs = typeof node.connectedAtMs === "number" ? node.connectedAtMs : null;
  const lastConnectedAtMs =
    typeof pairedInfo?.lastConnectedAtMs === "number" ? pairedInfo.lastConnectedAtMs : null;
  const approvedAtMs =
    typeof pairedInfo?.approvedAtMs === "number"
      ? pairedInfo.approvedAtMs
      : typeof node.approvedAtMs === "number"
        ? node.approvedAtMs
        : null;
  const timingDetail =
    connected && connectedAtMs != null
      ? t("alisio.connections.nodes.connectedAge", {
          age: formatRelativeTimestamp(connectedAtMs, { dateFallback: true }),
        })
      : !connected && lastConnectedAtMs != null
        ? t("alisio.connections.nodes.lastSeen", {
            age: formatRelativeTimestamp(lastConnectedAtMs, { dateFallback: true }),
          })
        : approvedAtMs != null
          ? t("alisio.connections.nodes.approvedAge", {
              age: formatRelativeTimestamp(approvedAtMs, { dateFallback: true }),
            })
          : null;
  const details = [
    timingDetail,
    typeof node.remoteIp === "string" && node.remoteIp.trim() ? node.remoteIp.trim() : null,
    typeof node.version === "string" && node.version.trim() ? node.version.trim() : null,
    execReady ? t("alisio.connections.nodes.execReady") : null,
    capabilityCount > 0
      ? t("alisio.connections.nodes.capabilitiesCount", { count: String(capabilityCount) })
      : null,
    commandCount > 0
      ? t("alisio.connections.nodes.commandsCount", { count: String(commandCount) })
      : null,
  ].filter((detail): detail is string => Boolean(detail));
  return html`
    <article class="alisio-node-card">
      <div class="alisio-node-card__head">
        <div class="list-main">
          <div class="list-title">${title}</div>
          <div class="list-sub mono alisio-connections-entry__identifier">${nodeId}</div>
        </div>
        <div class="alisio-node-card__status">
          <span class="pill ${connected ? "pill--connected" : "pill--needs-reconnect"}">
            ${connected
              ? t("alisio.connections.nodes.connected")
              : t("alisio.connections.nodes.offline")}
          </span>
          <span class="chip">
            ${paired
              ? t("alisio.connections.nodes.paired")
              : t("alisio.connections.nodes.unpaired")}
          </span>
        </div>
      </div>
      ${details.length > 0
        ? html`
            <div class="alisio-node-card__details">
              ${details.map((detail) => html`<span>${detail}</span>`)}
            </div>
          `
        : nothing}
    </article>
  `;
}
