import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { t } from "../../i18n/index.ts";
import {
  resolveConnectionsModel,
  type ConnectionsModel,
} from "../controllers/connections-model.ts";
import type { PendingNodePairing } from "../controllers/node-pairing.ts";
import { formatRelativeTimestamp } from "../format.ts";
import { icons } from "../icons.ts";
import { renderRuntimeNodeCard } from "./computer-cards.ts";
import type { NodesProps } from "./connections-types.ts";
import { renderSkeletonListItem, renderSkeletonPill } from "./loading-skeleton.ts";
import { renderExecApprovals, resolveExecApprovalsState } from "./nodes-exec-approvals.ts";
import { resolveConfigAgents, resolveNodeTargets, type NodeTargetOption } from "./nodes-shared.ts";

export function renderNodes(
  props: NodesProps,
  opts?: {
    includeExecApprovals?: boolean;
    collapseNodeInventoryByComputer?: boolean;
  },
  context?: {
    connectionsModel?: ConnectionsModel;
  },
) {
  const includeExecApprovals = opts?.includeExecApprovals ?? true;
  const collapseNodeInventoryByComputer = opts?.collapseNodeInventoryByComputer ?? false;
  const bindingState = resolveBindingsState(props);
  const approvalsState = includeExecApprovals ? resolveExecApprovalsState(props) : null;
  return html`
    ${approvalsState ? renderExecApprovals(approvalsState) : nothing}
    ${renderRuntime(
      props,
      bindingState,
      {
        includeExecApprovals,
        collapseNodeInventoryByComputer,
      },
      context,
    )}
  `;
}

function renderPanelCount(value: number | string) {
  return html`<span class="alisio-connections-subsection__count">${value}</span>`;
}

function renderRuntime(
  props: NodesProps,
  state: BindingState,
  opts: { includeExecApprovals: boolean; collapseNodeInventoryByComputer: boolean },
  context?: { connectionsModel?: ConnectionsModel },
) {
  const refreshing =
    props.computers.nodesLoading ||
    props.computers.nodePairingsLoading ||
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
      ${props.computers.nodesError
        ? html`<div class="callout danger">${props.computers.nodesError}</div>`
        : nothing}
      ${props.computers.nodePairingsError
        ? html`<div class="callout danger">${props.computers.nodePairingsError}</div>`
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
  const list = props.computers.nodePairingsList ?? { pending: [], paired: [] };
  const pending = Array.isArray(list.pending) ? list.pending : [];
  const refreshing = props.computers.nodePairingsLoading;
  const showLoading = !props.computers.nodePairingsList && !props.computers.nodePairingsError;
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
  const nodes = resolveExecNodes(props.computers.nodes);
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
  const allNodes = props.computers.nodes;
  if (opts?.collapseByComputer !== true) {
    return allNodes;
  }
  const model = connectionsModel ?? resolveConnectionsModel(props.computers);
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
    (props.computers.nodePairingsList?.paired ?? []).map((node) => [node.nodeId, node]),
  );
  const visibleNodes = resolveVisibleRuntimeNodes(props, opts, context?.connectionsModel);
  const showLoading = !props.computers.nodesLoaded && !props.computers.nodesError;
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
