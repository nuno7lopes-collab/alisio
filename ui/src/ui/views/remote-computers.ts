import { html, nothing } from "lit";
import type { NodeListNode } from "../../../../src/shared/node-list-types.js";
import { t } from "../../i18n/index.ts";
import {
  resolveRemoteComputerRecords,
  type RemoteComputerRecord,
  type RemoteComputerTaskRecord,
} from "../controllers/remote-computers.ts";
import { formatRelativeTimestamp } from "../format.ts";
import { icons } from "../icons.ts";
import { renderSkeletonListItem, renderSkeletonPill } from "./loading-skeleton.ts";
import type { NodesProps } from "./nodes.ts";

function resolveAccessLabel(
  access: RemoteComputerRecord["deviceAccess"]  ,
) {
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
            ? html`<span class="pill pill--unavailable">${t(
                "alisio.connections.remote.timedOut",
              )}</span>`
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
      ?disabled=${computer.requestStatus === "pending" || Boolean(props.sharingLoading)}
      @click=${() => props.onSharingRequest?.(computer.id, ["exec"])}
    >
      ${computer.requestStatus === "pending"
        ? t("alisio.connections.remote.requestPendingCta")
        : t("alisio.connections.remote.requestControl")}
    </button>
  `;
}

function renderRevokeAction(computer: RemoteComputerRecord, props: NodesProps) {
  if (!props.onSharingRevoke || !computer.grantId || computer.execAccess !== "shared") {
    return nothing;
  }
  return html`
    <button
      class="btn btn--sm btn--ghost"
      ?disabled=${Boolean(props.sharingLoading)}
      @click=${() => props.onSharingRevoke?.(computer.grantId!)}
    >
      ${t("alisio.connections.remote.revokeControl")}
    </button>
  `;
}

function renderRunner(computer: RemoteComputerRecord, props: NodesProps) {
  const tasks = props.remoteComputerTasks?.[computer.id] ?? [];
  if (computer.phase !== "ready" || !computer.nodeId) {
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
  const draft = props.remoteComputerDrafts?.[computer.id] ?? { command: "", cwd: "" };
  const busy = props.remoteComputerBusy?.[computer.id] === true;
  const error = props.remoteComputerErrors?.[computer.id] ?? null;
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
                props.onRemoteComputerRun?.(computer.id, computer.nodeId!);
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
          @click=${() => props.onRemoteComputerRun?.(computer.id, computer.nodeId!)}
        >
          ${busy ? t("alisio.connections.remote.runningAction") : t("alisio.connections.remote.run")}
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

function renderComputer(computer: RemoteComputerRecord, props: NodesProps) {
  const badge = resolveComputerPhaseBadge(computer);
  const summaryParts = [
    `${t("alisio.connections.sharing.models")}: ${resolveAccessLabel(computer.modelAccess)}`,
    `${t("alisio.connections.sharing.exec")}: ${resolveAccessLabel(computer.execAccess)}`,
    computer.trusted ? t("alisio.connections.remote.trusted") : null,
    computer.pairingPending ? t("alisio.connections.remote.pairingPending") : null,
  ].filter((value): value is string => Boolean(value));

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
        ${summaryParts.length > 0
          ? html`<div class="alisio-remote-computers__summary">${summaryParts.join(" · ")}</div>`
          : nothing}
        ${renderRunner(computer, props)}
      </div>
      <div class="list-meta alisio-connections-entry__actions">
        <div class="row alisio-connections-action-row">
          ${renderRequestAction(computer, props)} ${renderRevokeAction(computer, props)}
        </div>
      </div>
    </article>
  `;
}

export function renderRemoteComputers(props: NodesProps) {
  const computers = resolveRemoteComputerRecords({
    sharing: props.sharing ?? null,
    nodes: props.nodes as NodeListNode[],
    devicesList: props.devicesList,
  });
  const initialLoading =
    !props.sharing && !props.sharingError && props.sharingLoading && props.nodes.length === 0;
  const readyCount = computers.filter((computer) => computer.phase === "ready").length;
  const totalCount = computers.length;
  const text = {
    title: t("alisio.connections.remote.title"),
    subtitle: t("alisio.connections.remote.subtitle"),
    empty: t("alisio.connections.remote.empty"),
    refresh: t("common.refresh"),
    loading: t("alisio.connections.loading"),
  };

  return html`
    <section
      class="card alisio-connections-panel alisio-remote-computers"
      aria-busy=${props.sharingLoading ? "true" : "false"}
    >
      <div class="alisio-connections-panel__head">
        <div class="alisio-connections-panel__identity">
          <span class="alisio-connections-panel__icon" aria-hidden="true">${icons.monitor}</span>
          <div>
            <div class="card-title">${text.title}</div>
            <div class="card-sub">${text.subtitle}</div>
          </div>
        </div>
        <div class="alisio-connections-subpanel__meta">
          ${initialLoading
            ? renderSkeletonPill({ small: true })
            : html`${totalCount === 0 ? "0" : `${readyCount}/${totalCount}`}`}
          <button
            class="btn btn--ghost btn--sm"
            ?disabled=${Boolean(props.sharingLoading)}
            @click=${props.onSharingRefresh}
          >
            ${props.sharingLoading ? text.loading : text.refresh}
          </button>
        </div>
      </div>
      ${props.sharingError ? html`<div class="callout danger">${props.sharingError}</div>` : nothing}
      ${initialLoading
        ? html`
            <div class="loading-state__list" role="status" aria-label=${text.loading}>
              ${renderSkeletonListItem({ lines: ["medium", "long", "medium"], aside: "button" })}
              ${renderSkeletonListItem({ lines: ["long", "medium", "short"], aside: "button" })}
            </div>
          `
        : computers.length === 0
          ? html`<div class="alisio-connections-empty">${text.empty}</div>`
          : html`<div class="list">${computers.map((computer) => renderComputer(computer, props))}</div>`}
    </section>
  `;
}
