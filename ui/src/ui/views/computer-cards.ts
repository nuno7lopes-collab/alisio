import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { PairedComputer, PairedComputerToken, PendingDevice } from "../controllers/devices.ts";
import { resolveComputerLabel } from "../controllers/devices.ts";
import type { RuntimeNodePairingList } from "../controllers/node-pairing.ts";
import type {
  RemoteComputerRecord,
  RemoteComputerTaskRecord,
} from "../controllers/remote-computers.ts";
import { formatRelativeTimestamp, formatList } from "../format.ts";
import { icons } from "../icons.ts";
import type { NodesProps } from "./connections-types.ts";
import { isConnectedNode, nodeSupportsExec } from "./nodes-shared.ts";

function renderTaskOutput(label: string, value: string, kind: "stdout" | "stderr") {
  if (!value.trim()) {
    return nothing;
  }
  return html`
    <div class="alisio-remote-computers__output-block">
      <span class="alisio-remote-computers__output-label">${label}</span>
      <pre class="alisio-remote-computers__output" data-kind=${kind}>${value}</pre>
    </div>
  `;
}

function resolveTaskBadge(task: RemoteComputerTaskRecord) {
  switch (task.phase) {
    case "starting":
      return {
        className: "pill pill--in-review",
        label: t("alisio.connections.remote.task.starting"),
      };
    case "running":
      return {
        className: "pill pill--ready",
        label: t("alisio.connections.remote.task.running"),
      };
    case "succeeded":
      return {
        className: "pill pill--connected",
        label: t("alisio.connections.remote.task.succeeded"),
      };
    case "failed":
    default:
      return {
        className: "pill pill--unavailable",
        label: t("alisio.connections.remote.task.failed"),
      };
  }
}

function resolveComputerPhaseBadge(computer: RemoteComputerRecord) {
  switch (computer.phase) {
    case "ready":
      return {
        className: "pill pill--ready",
        label: t("alisio.connections.remote.phase.ready"),
      };
    case "request-pending":
      return {
        className: "pill pill--in-review",
        label: t("alisio.connections.remote.phase.requestPending"),
      };
    case "needs-approval":
      return {
        className: "pill pill--setup-required",
        label: t("alisio.connections.remote.phase.needsApproval"),
      };
    case "offline":
      return {
        className: "pill pill--unavailable",
        label: t("alisio.connections.remote.phase.offline"),
      };
    case "limited":
      return {
        className: "pill pill--unavailable",
        label: t("alisio.connections.remote.phase.limited"),
      };
    case "available":
    default:
      return {
        className: "pill pill--unavailable",
        label: t("alisio.connections.remote.phase.available"),
      };
  }
}

function resolveComputerHint(computer: RemoteComputerRecord) {
  switch (computer.phase) {
    case "ready":
      return t("alisio.connections.remote.phaseHint.ready");
    case "request-pending":
      return t("alisio.connections.remote.phaseHint.requestPending");
    case "needs-approval":
      return t("alisio.connections.remote.phaseHint.needsApproval");
    case "offline":
      return t("alisio.connections.remote.phaseHint.offline");
    case "limited":
      return t("alisio.connections.remote.phaseHint.limited");
    case "available":
    default:
      return t("alisio.connections.remote.phaseHint.available");
  }
}

function resolveAccessLabel(access: RemoteComputerRecord["deviceAccess"]) {
  switch (access) {
    case "owner":
    case "shared":
    case "requestable":
    case "blocked":
      return t(`alisio.connections.sharing.access.${access}`);
    default:
      return access;
  }
}

function resolveRemoteComputerSummary(computer: RemoteComputerRecord) {
  return [
    `${t("alisio.connections.sharing.models")}: ${resolveAccessLabel(computer.modelAccess)}`,
    `${t("alisio.connections.sharing.exec")}: ${resolveAccessLabel(computer.execAccess)}`,
    computer.trusted ? t("alisio.connections.remote.trusted") : null,
    computer.pairingPending ? t("alisio.connections.remote.pairingPending") : null,
  ].filter((value): value is string => Boolean(value));
}

function renderTask(task: RemoteComputerTaskRecord) {
  const badge = resolveTaskBadge(task);
  const updatedLabel = formatRelativeTimestamp(task.updatedAtMs);
  const exitLabel =
    typeof task.exitCode === "number"
      ? t("alisio.connections.remote.exitCode", { code: String(task.exitCode) })
      : null;
  const hasOutput = task.stdout.trim() || task.stderr.trim();
  return html`
    <article class="alisio-remote-computers__task">
      <div class="alisio-connections-entry__head">
        <div class="alisio-connections-entry__stack">
          <div class="list-title mono">${task.commandText}</div>
          <div class="alisio-connections-entry__note">
            ${task.cwd
              ? html`${t("alisio.connections.remote.cwdShort", { value: task.cwd })} · `
              : nothing}
            ${t("alisio.connections.remote.updated", { value: updatedLabel })}
          </div>
        </div>
        <div class="alisio-connections-entry__pills">
          <span class=${badge.className}>${badge.label}</span>
          ${task.timedOut
            ? html`<span class="pill pill--unavailable"
                >${t("alisio.connections.remote.timedOut")}</span
              >`
            : nothing}
          ${exitLabel ? html`<span class="pill pill--in-review">${exitLabel}</span>` : nothing}
        </div>
      </div>
      ${renderTaskOutput(t("alisio.connections.remote.stdout"), task.stdout, "stdout")}
      ${renderTaskOutput(t("alisio.connections.remote.stderr"), task.stderr, "stderr")}
      ${!hasOutput && task.phase !== "running" && task.phase !== "starting"
        ? html`
            <div class="alisio-connections-empty alisio-connections-empty--compact">
              ${task.error?.trim() || t("alisio.connections.remote.noOutput")}
            </div>
          `
        : nothing}
      ${task.error?.trim() && task.stderr.trim()
        ? html`<div class="alisio-remote-computers__task-error">${task.error}</div>`
        : nothing}
    </article>
  `;
}

function renderRequestAction(computer: RemoteComputerRecord, props: NodesProps) {
  if (!props.onSharingRequest || computer.execAccess !== "requestable") {
    return nothing;
  }
  return html`
    <button
      class="btn btn--sm"
      ?disabled=${computer.requestStatus === "pending" || Boolean(props.computers.sharingLoading)}
      @click=${() => props.onSharingRequest?.(computer.targetId, ["exec"])}
    >
      ${computer.requestStatus === "pending"
        ? t("alisio.connections.remote.requestPendingCta")
        : t("alisio.connections.remote.requestControl")}
    </button>
  `;
}

function renderRevokeAction(computer: RemoteComputerRecord, props: NodesProps) {
  const grantId = computer.grantId;
  if (!props.onSharingRevoke || !grantId || computer.execAccess !== "shared") {
    return nothing;
  }
  return html`
    <button
      class="btn btn--sm btn--ghost"
      ?disabled=${Boolean(props.computers.sharingLoading)}
      @click=${() => props.onSharingRevoke?.(grantId)}
    >
      ${t("alisio.connections.remote.revokeControl")}
    </button>
  `;
}

function renderRemoteComputerActions(computer: RemoteComputerRecord, props: NodesProps) {
  const requestAction = renderRequestAction(computer, props);
  const revokeAction = renderRevokeAction(computer, props);
  if (requestAction === nothing && revokeAction === nothing) {
    return nothing;
  }
  return html`
    <div class="row alisio-connections-action-row">${requestAction} ${revokeAction}</div>
  `;
}

function renderRunner(computer: RemoteComputerRecord, props: NodesProps) {
  const tasks = props.computers.remote.tasks[computer.id] ?? [];
  const nodeId = computer.nodeId;
  if (computer.phase !== "ready" || !nodeId) {
    return html`
      <div class="alisio-connections-entry__note">${resolveComputerHint(computer)}</div>
      ${tasks.length > 0
        ? html`
            <div class="alisio-remote-computers__tasks">
              <div class="muted alisio-connections-entry__section-label">
                ${t("alisio.connections.remote.recentRuns")}
              </div>
              ${tasks.map((task) => renderTask(task))}
            </div>
          `
        : nothing}
    `;
  }
  const draft = props.computers.remote.drafts[computer.id] ?? { command: "", cwd: "" };
  const busy = props.computers.remote.busy[computer.id] ?? false;
  const error = props.computers.remote.errors[computer.id] ?? null;
  return html`
    <div class="alisio-remote-computers__runner">
      <div class="alisio-remote-computers__inputs">
        <label class="field full">
          <span>${t("alisio.connections.remote.command")}</span>
          <input
            .value=${draft.command}
            placeholder=${t("alisio.connections.remote.commandPlaceholder")}
            @input=${(event: Event) =>
              props.onRemoteComputerCommandChange?.(
                computer.id,
                (event.currentTarget as HTMLInputElement).value,
              )}
            @keydown=${(event: KeyboardEvent) => {
              if (event.key === "Enter" && !event.shiftKey && !busy) {
                event.preventDefault();
                props.onRemoteComputerRun?.(computer.id, nodeId);
              }
            }}
          />
        </label>
        <label class="field">
          <span>${t("alisio.connections.remote.cwd")}</span>
          <input
            .value=${draft.cwd}
            placeholder=${t("alisio.connections.remote.cwdPlaceholder")}
            @input=${(event: Event) =>
              props.onRemoteComputerCwdChange?.(
                computer.id,
                (event.currentTarget as HTMLInputElement).value,
              )}
          />
        </label>
      </div>
      ${error ? html`<div class="callout danger">${error}</div>` : nothing}
      <div class="alisio-remote-computers__runner-footer">
        <div class="alisio-connections-entry__note">${resolveComputerHint(computer)}</div>
        <button
          class="btn btn--sm primary"
          ?disabled=${busy}
          @click=${() => props.onRemoteComputerRun?.(computer.id, nodeId)}
        >
          ${busy
            ? t("alisio.connections.remote.runningAction")
            : t("alisio.connections.remote.run")}
        </button>
      </div>
      ${tasks.length > 0
        ? html`
            <div class="alisio-remote-computers__tasks">
              <div class="muted alisio-connections-entry__section-label">
                ${t("alisio.connections.remote.recentRuns")}
              </div>
              ${tasks.map((task) => renderTask(task))}
            </div>
          `
        : nothing}
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

export function renderRemoteComputerDetails(
  computer: RemoteComputerRecord,
  props: NodesProps,
  opts?: { showActions?: boolean },
) {
  const summaryParts = resolveRemoteComputerSummary(computer);
  const showActions = opts?.showActions !== false;
  return html`
    ${summaryParts.length > 0
      ? html`<div class="alisio-remote-computers__summary">${summaryParts.join(" · ")}</div>`
      : nothing}
    ${renderRunner(computer, props)}
    ${showActions ? renderRemoteComputerActions(computer, props) : nothing}
  `;
}

export function renderRemoteComputerCard(
  computer: RemoteComputerRecord,
  props: NodesProps,
  opts?: { compact?: boolean },
) {
  const badge = resolveComputerPhaseBadge(computer);
  const compact = opts?.compact === true;

  if (compact) {
    return html`
      <details
        class="list-item alisio-connections-entry alisio-remote-computers__card alisio-connections-entry--collapsible"
      >
        <summary class="alisio-connections-entry__summary">
          <div class="list-main">
            <div class="alisio-connections-entry__head">
              <div class="alisio-connections-entry__stack">
                <div class="list-title">${computer.label}</div>
                <div class="alisio-connections-entry__note">
                  ${[
                    computer.platform,
                    computer.sameAccount
                      ? t("alisio.connections.sharing.sameAccount")
                      : computer.ownerLabel,
                    computer.connected
                      ? t("alisio.connections.remote.connected")
                      : t("alisio.connections.remote.disconnected"),
                  ]
                    .filter((value): value is string => Boolean(value?.trim?.() ?? value))
                    .join(" · ")}
                </div>
              </div>
              <div class="alisio-connections-entry__pills">
                <span
                  class=${computer.connected ? "pill pill--connected" : "pill pill--unavailable"}
                >
                  ${computer.connected
                    ? t("alisio.connections.remote.connected")
                    : t("alisio.connections.remote.disconnected")}
                </span>
                <span class=${badge.className}>${badge.label}</span>
                <span class="pill">${t("alisio.connections.computers.details")}</span>
                <span class="alisio-connections-disclosure-icon" aria-hidden="true"
                  >${icons.chevronDown}</span
                >
              </div>
            </div>
          </div>
        </summary>
        <div class="alisio-connections-entry__details">
          ${renderRemoteComputerDetails(computer, props)}
        </div>
      </details>
    `;
  }

  return html`
    <article class="list-item alisio-connections-entry alisio-remote-computers__card">
      <div class="list-main">
        <div class="alisio-connections-entry__head">
          <div class="alisio-connections-entry__stack">
            <div class="list-title">${computer.label}</div>
            <div class="alisio-connections-entry__note">
              ${[
                computer.platform,
                computer.sameAccount
                  ? t("alisio.connections.sharing.sameAccount")
                  : computer.ownerLabel,
                computer.connected
                  ? t("alisio.connections.remote.connected")
                  : t("alisio.connections.remote.disconnected"),
              ]
                .filter((value): value is string => Boolean(value?.trim?.() ?? value))
                .join(" · ")}
            </div>
          </div>
          <div class="alisio-connections-entry__pills">
            <span class=${computer.connected ? "pill pill--connected" : "pill pill--unavailable"}>
              ${computer.connected
                ? t("alisio.connections.remote.connected")
                : t("alisio.connections.remote.disconnected")}
            </span>
            <span class=${badge.className}>${badge.label}</span>
          </div>
        </div>
        ${renderRemoteComputerDetails(computer, props, { showActions: false })}
      </div>
      <div class="list-meta alisio-connections-entry__actions">
        ${renderRemoteComputerActions(computer, props)}
      </div>
    </article>
  `;
}
