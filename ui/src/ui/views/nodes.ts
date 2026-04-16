import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type { NodeListNode } from "../../../../src/shared/node-list-types.js";
import { t } from "../../i18n/index.ts";
import {
  resolveConnectionsModel,
  type ConnectionsModel,
} from "../controllers/connections-model.ts";
import { groupPairedDevicesByComputer, resolveComputerLabel } from "../controllers/devices.ts";
import type {
  DevicePairingList,
  PairedComputer,
  PairedComputerToken,
  PendingDevice,
} from "../controllers/devices.ts";
import type { ExecApprovalsFile, ExecApprovalsSnapshot } from "../controllers/exec-approvals.ts";
import type { PendingNodePairing, RuntimeNodePairingList } from "../controllers/node-pairing.ts";
import type {
  RemoteComputerDraft,
  RemoteComputerTaskRecord,
} from "../controllers/remote-computers.ts";
import { formatRelativeTimestamp, formatList } from "../format.ts";
import { icons } from "../icons.ts";
import type { AlisioAccountState } from "../types.ts";
import type { AlisioSharingState } from "../types.ts";
import { renderSkeletonListItem, renderSkeletonPill } from "./loading-skeleton.ts";
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
  account?: AlisioAccountState | null;
  nodesLoading: boolean;
  nodesLoaded: boolean;
  nodes: Array<Record<string, unknown>>;
  nodesError: string | null;
  devicesLoading: boolean;
  devicesError: string | null;
  devicesList: DevicePairingList | null;
  currentDeviceId: string | null;
  sessionKey?: string;
  sharingLoading?: boolean;
  sharingError?: string | null;
  sharing?: AlisioSharingState | null;
  nodePairingsLoading: boolean;
  nodePairingsError: string | null;
  nodePairingsList: RuntimeNodePairingList | null;
  remoteComputerDrafts?: Record<string, RemoteComputerDraft>;
  remoteComputerBusy?: Record<string, boolean>;
  remoteComputerErrors?: Record<string, string | null>;
  remoteComputerTasks?: Record<string, RemoteComputerTaskRecord[]>;
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
  onDeviceRemoveComputer: (label: string, deviceIds: readonly string[]) => void;
  onDeviceCleanupComputer: (label: string, staleDeviceIds: readonly string[]) => void;
  onSharingRequest?: (targetId: string, scopes?: readonly string[]) => void;
  onSharingApprove?: (requestId: string, scopes?: readonly string[]) => void;
  onSharingReject?: (requestId: string) => void;
  onSharingRevoke?: (grantId: string) => void;
  onSharingSetPolicy?: (allowExternalUse: boolean) => void;
  onSharingSetResourcePolicy?: (
    resource: keyof SharingResourcePolicyMap,
    mode: SharingResourcePolicyMap[keyof SharingResourcePolicyMap],
  ) => void;
  onRemoteComputerCommandChange?: (computerId: string, value: string) => void;
  onRemoteComputerCwdChange?: (computerId: string, value: string) => void;
  onRemoteComputerRun?: (computerId: string, nodeId: string) => void;
  onNodeApprove: (requestId: string) => void;
  onNodeReject: (requestId: string) => void;
  onDeviceRotate: (deviceId: string, role: string, scopes?: string[], label?: string) => void;
  onDeviceRevoke: (deviceId: string, role: string, label?: string) => void;
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

export function renderNodes(
  props: NodesProps,
  opts?: {
    includeExecApprovals?: boolean;
    showDevices?: boolean;
    collapseNodeInventoryByComputer?: boolean;
  },
  context?: {
    connectionsModel?: ConnectionsModel;
  },
) {
  const includeExecApprovals = opts?.includeExecApprovals ?? true;
  const showDevices = opts?.showDevices ?? true;
  const collapseNodeInventoryByComputer = opts?.collapseNodeInventoryByComputer ?? false;
  const bindingState = resolveBindingsState(props);
  const approvalsState = includeExecApprovals ? resolveExecApprovalsState(props) : null;
  return html`
    ${approvalsState ? renderExecApprovals(approvalsState) : nothing}
    ${showDevices
      ? html`
          <div class="alisio-connections-layout">
            ${renderDevices(props)}
            ${renderRuntime(props, bindingState, {
              includeExecApprovals,
              collapseNodeInventoryByComputer,
            }, context)}
          </div>
        `
      : renderRuntime(props, bindingState, {
          includeExecApprovals,
          collapseNodeInventoryByComputer,
        }, context)}
  `;
}

function renderPanelCount(value: number | string) {
  return html`<span class="alisio-connections-subsection__count">${value}</span>`;
}

function renderDevices(props: NodesProps) {
  const list = props.devicesList ?? { pending: [], paired: [] };
  const pending = Array.isArray(list.pending) ? list.pending : [];
  const paired = Array.isArray(list.paired) ? list.paired : [];
  const groupedPaired = groupPairedDevicesByComputer(paired, props.currentDeviceId);
  const showLoading = !props.devicesList && !props.devicesError;
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
    <section
      class="card alisio-connections-panel"
      aria-busy=${props.devicesLoading ? "true" : "false"}
    >
      <div class="alisio-connections-panel__head">
        <div class="alisio-connections-panel__identity">
          <span class="alisio-connections-panel__icon" aria-hidden="true">${icons.smartphone}</span>
          <div>
            <div class="card-title">${text.title}</div>
            <div class="card-sub">${text.subtitle}</div>
          </div>
        </div>
        <button
          class="btn btn--ghost btn--sm"
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
            <div
              class="alisio-connections-sections alisio-connections-sections--paired"
              role="status"
              aria-label=${text.loading}
            >
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
            <div class="alisio-connections-sections alisio-connections-sections--paired">
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
                  <span class="alisio-connections-subsection__count">${groupedPaired.length}</span>
                </div>
                <div class="list">
                  ${groupedPaired.length === 0
                    ? html`<div class="alisio-connections-empty">${text.empty}</div>`
                    : groupedPaired.map((computer) => renderPairedComputer(computer, props))}
                </div>
              </section>
            </div>
          `}
    </section>
  `;
}

function renderRuntime(
  props: NodesProps,
  state: BindingState,
  opts: { includeExecApprovals: boolean; collapseNodeInventoryByComputer: boolean },
  context?: { connectionsModel?: ConnectionsModel },
) {
  const refreshing =
    props.nodesLoading ||
    props.nodePairingsLoading ||
    (opts.includeExecApprovals && props.execApprovalsLoading);
  const text = {
    title: t("alisio.connections.runtimeTitle"),
    loading: t("alisio.connections.loading"),
    refresh: t("common.refresh"),
  };
  return html`
    <section class="card alisio-connections-panel" aria-busy=${refreshing ? "true" : "false"}>
      <div class="alisio-connections-panel__head">
        <div class="alisio-connections-panel__identity">
          <span class="alisio-connections-panel__icon" aria-hidden="true">${icons.monitor}</span>
          <div>
            <div class="card-title">${text.title}</div>
          </div>
        </div>
        <button class="btn btn--ghost btn--sm" ?disabled=${refreshing} @click=${props.onRefresh}>
          ${refreshing ? text.loading : text.refresh}
        </button>
      </div>
      ${props.nodesError ? html`<div class="callout danger">${props.nodesError}</div>` : nothing}
      ${props.nodePairingsError
        ? html`<div class="callout danger">${props.nodePairingsError}</div>`
        : nothing}
      <div class="alisio-connections-runtime-stack">
        ${renderPendingNodeRequests(props)} ${renderBindings(state)}
        ${renderNodeList(props, {
          collapseByComputer: opts.collapseNodeInventoryByComputer,
        }, context)}
      </div>
    </section>
  `;
}

function renderPendingNodeRequests(props: NodesProps) {
  const list = props.nodePairingsList ?? { pending: [], paired: [] };
  const pending = Array.isArray(list.pending) ? list.pending : [];
  const refreshing = props.nodePairingsLoading;
  const showLoading = !props.nodePairingsList && !props.nodePairingsError;
  const text = {
    title: t("alisio.connections.nodes.pendingTitle"),
    pendingEmpty: t("alisio.connections.nodes.pendingEmpty"),
    loading: t("alisio.connections.loading"),
    refresh: t("common.refresh"),
  };
  return html`
    <section class="alisio-connections-subpanel">
      <div class="alisio-connections-subpanel__head">
        <div>
          <div class="alisio-connections-subpanel__title">${text.title}</div>
        </div>
        <div class="alisio-connections-subpanel__meta">
          ${showLoading ? renderSkeletonPill({ small: true }) : renderPanelCount(pending.length)}
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

export function renderPendingDevice(req: PendingDevice, props: NodesProps) {
  const name = resolveComputerLabel(req);
  const age = typeof req.ts === "number" ? formatRelativeTimestamp(req.ts) : t("common.na");
  const roleValue = req.role?.trim() || formatList(req.roles);
  const scopesValue = formatList(req.scopes);
  const repair = req.isRepair ? ` · ${t("alisio.connections.devices.repair")}` : "";
  const meta = [req.platform, req.clientId, req.clientMode, req.remoteIp].filter(
    (value): value is string => Boolean(value?.trim()),
  );
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
        ${meta.length > 0 ? html`<div class="list-sub">${meta.join(" · ")}</div>` : nothing}
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

function renderPairedComputerDetails(
  computer: PairedComputer,
  props: NodesProps,
  opts?: { showMeta?: boolean },
) {
  const meta = [computer.platform, computer.clientId, computer.clientMode].filter(
    (value): value is string => Boolean(value?.trim()),
  );
  const showMeta = opts?.showMeta ?? true;
  return html`
    ${showMeta && meta.length > 0 ? html`<div class="list-sub">${meta.join(" · ")}</div>` : nothing}
    ${computer.staleRecordCount > 0
      ? html`
          <div class="alisio-connections-entry__note">
            ${t("alisio.connections.devices.legacyRecords", {
              count: String(computer.staleRecordCount),
            })}
          </div>
        `
      : nothing}
    ${computer.tokens.length === 0
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
            ${computer.tokens.map((token) => renderTokenRow(token, computer.label, props))}
          </div>
        `}
    <div class="alisio-connections-entry__footer">
      ${computer.isCurrentComputer && computer.staleRecordCount > 0
        ? html`
            <button
              class="btn btn--sm"
              @click=${() => props.onDeviceCleanupComputer(computer.label, computer.staleDeviceIds)}
            >
              ${t("alisio.connections.devices.cleanup")}
            </button>
          `
        : nothing}
      <button
        class="btn btn--sm danger"
        @click=${() => props.onDeviceRemoveComputer(computer.label, computer.allDeviceIds)}
      >
        ${t("alisio.connections.devices.remove")}
      </button>
    </div>
  `;
}

export function renderPairedComputer(
  computer: PairedComputer,
  props: NodesProps,
  opts?: { compact?: boolean; runtimeContent?: unknown },
) {
  const meta = [computer.platform, computer.clientId, computer.clientMode].filter(
    (value): value is string => Boolean(value?.trim()),
  );
  const compact = opts?.compact === true;
  if (compact) {
    return html`
      <details
        class="list-item alisio-connections-entry alisio-connections-entry--single alisio-connections-entry--collapsible"
      >
        <summary class="alisio-connections-entry__summary">
          <div class="list-main">
            <div class="alisio-connections-entry__head">
              <div class="list-title">${computer.label}</div>
              <div class="alisio-connections-entry__pills">
                ${computer.isCurrentComputer
                  ? html`
                      <span class="pill pill--connected">
                        ${t("alisio.connections.devices.current")}
                      </span>
                    `
                  : nothing}
                <span class="pill pill--connected"
                  >${computer.tokens.length} ${t("alisio.connections.devices.tokens")}</span
                >
                <span class="pill">${t("alisio.connections.computers.details")}</span>
                <span class="alisio-connections-disclosure-icon" aria-hidden="true"
                  >${icons.chevronDown}</span
                >
              </div>
            </div>
            ${meta.length > 0 ? html`<div class="list-sub">${meta.join(" · ")}</div>` : nothing}
          </div>
        </summary>
        <div class="alisio-connections-entry__details">
          ${renderPairedComputerDetails(computer, props, { showMeta: false })}
          ${opts?.runtimeContent ?? nothing}
        </div>
      </details>
    `;
  }

  return html`
    <div class="list-item alisio-connections-entry alisio-connections-entry--single">
      <div class="list-main">
        <div class="alisio-connections-entry__head">
          <div class="list-title">${computer.label}</div>
          <div class="alisio-connections-entry__pills">
            ${computer.isCurrentComputer
              ? html`
                  <span class="pill pill--connected">
                    ${t("alisio.connections.devices.current")}
                  </span>
                `
              : nothing}
            <span class="pill pill--connected"
              >${computer.tokens.length} ${t("alisio.connections.devices.tokens")}</span
            >
          </div>
        </div>
        ${renderPairedComputerDetails(computer, props)} ${opts?.runtimeContent ?? nothing}
      </div>
    </div>
  `;
}

function renderTokenRow(token: PairedComputerToken, computerLabel: string, props: NodesProps) {
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
          @click=${() =>
            props.onDeviceRotate(token.deviceId, token.role, token.scopes, computerLabel)}
        >
          ${t("alisio.connections.devices.rotate")}
        </button>
        ${token.revokedAtMs
          ? nothing
          : html`
              <button
                class="btn btn--sm danger"
                @click=${() => props.onDeviceRevoke(token.deviceId, token.role, computerLabel)}
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
    <details
      class="alisio-connections-subpanel alisio-connections-subpanel--collapsible"
      @toggle=${(event: Event) => {
        const target = event.currentTarget as HTMLDetailsElement;
        if (target.open && !state.ready && !state.configLoading) {
          state.onLoadConfig();
        }
      }}
    >
      <summary class="alisio-connections-subpanel__summary">
        <div>
          <div class="alisio-connections-subpanel__title">${text.title}</div>
        </div>
        <div class="alisio-connections-subpanel__actions">
          ${state.ready
            ? html`
                <span class="pill ${state.configDirty ? "pill--in-review" : "pill--connected"}">
                  ${syncLabel}
                </span>
              `
            : html`<span class="pill">${state.configLoading ? text.loading : text.loadConfig}</span>`}
          <span class="alisio-connections-disclosure-icon" aria-hidden="true"
            >${icons.chevronDown}</span
          >
        </div>
      </summary>
      <div class="alisio-connections-subpanel__body">
        ${state.formMode === "raw"
          ? html` <div class="callout warn">${text.rawMode}</div> `
          : nothing}
        ${!state.ready
          ? state.configLoading
            ? html`
                <div class="loading-state__list" role="status" aria-label=${text.loading}>
                  ${renderSkeletonListItem({
                    lines: ["medium", "long", "short"],
                    aside: "button",
                  })}
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
              <div class="alisio-connections-subpanel__head">
                <div class="muted">${text.defaultSubtitle}</div>
                <div class="alisio-connections-subpanel__actions">
                  <button
                    class="btn btn--sm"
                    ?disabled=${state.disabled || !state.configDirty}
                    @click=${state.onSave}
                  >
                    ${state.configSaving ? text.saving : text.save}
                  </button>
                </div>
              </div>
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
                    ${!supportsBinding ? html` <div class="muted">${text.noExecNodes}</div> ` : nothing}
                  </div>
                </div>

                ${state.agents.length === 0
                  ? html` <div class="muted">${text.noAgents}</div> `
                  : state.agents.map((agent) => renderAgentBinding(agent, state))}
              </div>
            `}
      </div>
    </details>
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

function resolveVisibleRuntimeNodes(
  props: NodesProps,
  opts?: { collapseByComputer?: boolean },
  connectionsModel?: ConnectionsModel,
): Array<Record<string, unknown>> {
  const allNodes = props.nodes;
  if (opts?.collapseByComputer !== true) {
    return allNodes;
  }
  const model =
    connectionsModel ??
    resolveConnectionsModel({
      account: props.account ?? null,
      sharing: props.sharing ?? null,
      devicesList: props.devicesList,
      currentDeviceId: props.currentDeviceId ?? null,
      nodes: props.nodes as NodeListNode[],
      nodePairingsList: props.nodePairingsList,
    });
  const coveredNodeIds = new Set(
    [
      ...(model.currentComputer?.runtimeNodes ?? []),
      ...model.sameAccountComputers.flatMap((computer) => computer.runtimeNodes),
      ...model.externalComputers.flatMap((computer) => computer.runtimeNodes),
    ]
      .map((node) => (typeof node.nodeId === "string" ? node.nodeId.trim() : ""))
      .filter(Boolean),
  );
  return allNodes.filter((node) => {
    const nodeId = typeof node.nodeId === "string" ? node.nodeId.trim() : "";
    return !nodeId || !coveredNodeIds.has(nodeId);
  });
}

function renderNodeList(
  props: NodesProps,
  opts?: { collapseByComputer?: boolean },
  context?: { connectionsModel?: ConnectionsModel },
) {
  const pairedRuntimeNodes = new Map(
    (props.nodePairingsList?.paired ?? []).map((node) => [node.nodeId, node]),
  );
  const visibleNodes = resolveVisibleRuntimeNodes(props, opts, context?.connectionsModel);
  const showLoading = !props.nodesLoaded && !props.nodesError;
  const text = {
    nodesTitle: t("alisio.connections.nodes.title"),
    noNodes: t("alisio.connections.nodes.empty"),
    loading: t("alisio.connections.loading"),
  };
  if (!showLoading && visibleNodes.length === 0 && opts?.collapseByComputer === true) {
    return nothing;
  }
  return html`
    <section class="alisio-connections-subpanel">
      <div class="alisio-connections-subpanel__head">
        <div>
          <div class="alisio-connections-subpanel__title">${text.nodesTitle}</div>
        </div>
        ${showLoading ? renderSkeletonPill({ small: true }) : renderPanelCount(visibleNodes.length)}
      </div>
      <div class="alisio-node-list">
        ${showLoading
          ? html`
              <div class="loading-state__list" role="status" aria-label=${text.loading}>
                ${renderSkeletonListItem({ lines: ["medium", "long", "short"] })}
                ${renderSkeletonListItem({ lines: ["long", "medium", "short"] })}
              </div>
            `
          : visibleNodes.length === 0
            ? html`<div class="alisio-connections-empty">${text.noNodes}</div>`
            : repeat(
                visibleNodes,
                (node) =>
                  (typeof node.nodeId === "string" && node.nodeId.trim()) || JSON.stringify(node),
                (node) => renderRuntimeNodeCard(node, pairedRuntimeNodes),
              )}
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

export function renderRuntimeNodeCard(
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
