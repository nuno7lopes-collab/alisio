import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { renderSkeletonStatCards } from "./loading-skeleton.ts";
import { countConnectedNodes, countReadyExecNodes } from "./nodes-shared.ts";
import { renderNodes, type NodesProps } from "./nodes.ts";
import {
  expandSharingScopeSelection,
  resolveSharingApprovalOptions,
  resolveSharingRequestOptions,
  resolveSharingRequestScopes,
} from "./sharing-shared.ts";

function countPendingDevices(props: NodesProps) {
  return props.devicesList?.pending?.length ?? 0;
}

function countPairedDevices(props: NodesProps) {
  return props.devicesList?.paired?.length ?? 0;
}

function countPendingNodeRequests(props: NodesProps) {
  return props.nodePairingsList?.pending?.length ?? 0;
}

function renderOverviewCard(params: {
  label: string;
  value: number | string;
  headline: string;
  detail: string;
}) {
  return html`
    <article class="alisio-connections-overview-card">
      <span class="alisio-connections-overview-card__label">${params.label}</span>
      <strong>${params.value}</strong>
      <p>${params.headline}</p>
      <div class="alisio-connections-overview-card__detail">${params.detail}</div>
    </article>
  `;
}

function renderPanelCount(value: number) {
  return html`<span class="alisio-connections-subsection__count">${value}</span>`;
}

function resolveSharingScopeLabel(scope: string) {
  switch (scope) {
    case "model-use":
    case "model.use":
      return t("alisio.connections.sharing.models");
    case "exec":
      return t("alisio.connections.sharing.exec");
    case "read-only":
    case "device.use":
      return t("alisio.connections.sharing.readOnly");
    default:
      return null;
  }
}

function formatSharingScopes(scopes: readonly string[] | null | undefined) {
  const labels = (scopes ?? [])
    .map(resolveSharingScopeLabel)
    .filter((value): value is string => value !== null);
  return labels.length > 0 ? labels.join(" · ") : null;
}

function resolveSharingAccessLabel(access: string) {
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

function resolveSharingStatusLabel(status: string | null | undefined) {
  const normalized = status === "denied" ? "rejected" : status;
  return normalized ? t(`alisio.organization.sharing.requestStatus.${normalized}`) : "";
}

function resolveSharingRequestLabel(scopes: readonly string[]) {
  if (scopes.includes("model-use") && scopes.includes("exec")) {
    return t("alisio.connections.sharing.requestModelsAndExec");
  }
  if (scopes.includes("exec")) {
    return t("alisio.connections.sharing.requestExec");
  }
  if (scopes.includes("model-use")) {
    return t("alisio.connections.sharing.requestModels");
  }
  return t("alisio.connections.sharing.requestReadOnly");
}

function describeSharingTargetAccess(
  target: NonNullable<NodesProps["sharing"]>["devices"]["available"][number],
) {
  return [
    `${t("alisio.connections.sharing.models")}: ${resolveSharingAccessLabel(target.modelAccess)}`,
    `${t("alisio.connections.sharing.exec")}: ${resolveSharingAccessLabel(target.execAccess)}`,
  ].join(" · ");
}

function resolveSharingOwnerBadge(params: {
  viewer: NonNullable<NodesProps["sharing"]>["viewer"];
  target: NonNullable<NodesProps["sharing"]>["devices"]["available"][number];
}) {
  if (params.target.ownerKey === params.viewer.ownerKey) {
    return t("alisio.connections.sharing.sameAccount");
  }
  return params.target.ownerLabel?.trim() || null;
}

function renderSharing(props: NodesProps) {
  const loading = props.sharingLoading === true;
  const showPanel = loading || props.sharingError != null || props.sharing != null;
  if (!showPanel) {
    return nothing;
  }

  const sharing = props.sharing;
  const available = sharing?.devices.available ?? [];
  const sharedWithMe = sharing?.devices.sharedWithMe ?? [];
  const incomingRequests = sharing?.incomingRequests ?? [];
  const text = {
    title: t("alisio.connections.sharing.title"),
    subtitle: t("alisio.connections.sharing.subtitle"),
    note: t("alisio.connections.sharing.note"),
    loading: t("alisio.connections.loading"),
    refresh: t("common.refresh"),
    availableTitle: t("alisio.organization.sharing.availableTitle"),
    availableEmpty: t("alisio.organization.sharing.availableEmpty"),
    sharedTitle: t("alisio.organization.sharing.sharedTitle"),
    sharedEmpty: t("alisio.organization.sharing.sharedEmpty"),
    incomingTitle: t("alisio.organization.sharing.incomingTitle"),
    incomingEmpty: t("alisio.organization.sharing.incomingEmpty"),
    currentScopes: t("alisio.connections.sharing.currentScopes"),
    approve: t("alisio.organization.sharing.approve"),
    reject: t("alisio.organization.sharing.reject"),
    revoke: t("alisio.organization.sharing.revoke"),
    allowExternalUse: t("alisio.organization.sharing.allowExternalUse"),
    externalOn: t("alisio.connections.sharing.externalOn"),
    externalOff: t("alisio.connections.sharing.externalOff"),
  };
  const showPolicyToggle =
    sharing != null &&
    (sharing.policy.editable ||
      Boolean(sharing.policy.ownerKey) ||
      typeof props.onSharingSetPolicy === "function");

  return html`
    <section class="card alisio-connections-panel">
      <div class="alisio-connections-panel__head">
        <div class="alisio-connections-panel__identity">
          <span class="alisio-connections-panel__icon" aria-hidden="true">+</span>
          <div>
            <div class="card-title">${text.title}</div>
            <div class="card-sub">${text.subtitle}</div>
          </div>
        </div>
        <button
          class="btn btn--ghost"
          ?disabled=${loading}
          @click=${() => props.onSharingRefresh?.()}
        >
          ${loading ? text.loading : text.refresh}
        </button>
      </div>
      ${props.sharingError
        ? html`<div class="callout danger" style="margin-top: 12px;">${props.sharingError}</div>`
        : nothing}
      <div class="callout info" style="margin-top: 12px;">${text.note}</div>
      ${showPolicyToggle && sharing
        ? html`
            <label class="field" style="margin-top: 12px;">
              <span>${text.allowExternalUse}</span>
              <input
                type="checkbox"
                .checked=${sharing.policy.allowExternalUse}
                ?disabled=${loading || !sharing.policy.editable || !props.onSharingSetPolicy}
                @change=${(event: Event) =>
                  props.onSharingSetPolicy?.((event.target as HTMLInputElement).checked)}
              />
            </label>
            <div class="alisio-connections-entry__note">
              ${sharing.policy.allowExternalUse ? text.externalOn : text.externalOff}
            </div>
          `
        : nothing}
      ${loading && !sharing
        ? html`
            <div class="alisio-connections-sections" role="status" aria-label=${text.loading}>
              <section class="alisio-connections-subsection">
                <div class="alisio-connections-subsection__head">
                  <span class="alisio-connections-subsection__title">${text.availableTitle}</span>
                </div>
              </section>
            </div>
          `
        : html`
            <div class="alisio-connections-sections">
              <section class="alisio-connections-subsection">
                <div class="alisio-connections-subsection__head">
                  <span class="alisio-connections-subsection__title">${text.availableTitle}</span>
                  ${renderPanelCount(available.length)}
                </div>
                <div class="list">
                  ${available.length === 0
                    ? html`<div class="alisio-connections-empty">${text.availableEmpty}</div>`
                    : available.map((target) => {
                        const scopes = resolveSharingRequestScopes(target);
                        const requestStatus = resolveSharingStatusLabel(target.requestStatus);
                        const ownerBadge =
                          sharing != null
                            ? resolveSharingOwnerBadge({
                                viewer: sharing.viewer,
                                target,
                              })
                            : null;
                        return html`
                          <div class="list-item alisio-connections-entry">
                            <div class="alisio-connections-entry__head">
                              <div class="list-title">${target.label}</div>
                              <div class="alisio-connections-entry__pills">
                                ${ownerBadge
                                  ? html`<span class="pill">${ownerBadge}</span>`
                                  : nothing}
                                ${requestStatus
                                  ? html`<span class="pill">${requestStatus}</span>`
                                  : nothing}
                              </div>
                            </div>
                            <div class="alisio-connections-entry__note">
                              ${describeSharingTargetAccess(target)}
                            </div>
                            <div class="alisio-connections-entry__actions">
                              ${resolveSharingRequestOptions(target).map(
                                (scope) => html`
                                  <button
                                    class="btn"
                                    ?disabled=${loading ||
                                    !props.onSharingRequest ||
                                    scopes.length === 0 ||
                                    target.requestStatus === "pending"}
                                    @click=${() =>
                                      props.onSharingRequest?.(
                                        target.targetId,
                                        expandSharingScopeSelection(scope),
                                      )}
                                  >
                                    ${target.requestStatus === "pending"
                                      ? requestStatus
                                      : resolveSharingRequestLabel(
                                          expandSharingScopeSelection(scope),
                                        )}
                                  </button>
                                `,
                              )}
                            </div>
                          </div>
                        `;
                      })}
                </div>
              </section>
              <section class="alisio-connections-subsection">
                <div class="alisio-connections-subsection__head">
                  <span class="alisio-connections-subsection__title">${text.sharedTitle}</span>
                  ${renderPanelCount(sharedWithMe.length)}
                </div>
                <div class="list">
                  ${sharedWithMe.length === 0
                    ? html`<div class="alisio-connections-empty">${text.sharedEmpty}</div>`
                    : sharedWithMe.map((target) => {
                        const scopes = formatSharingScopes(
                          target.approvalScopes ?? target.grantScopes,
                        );
                        const grantId = target.approvalId ?? target.grantId;
                        const ownerBadge =
                          sharing != null
                            ? resolveSharingOwnerBadge({
                                viewer: sharing.viewer,
                                target,
                              })
                            : null;
                        return html`
                          <div class="list-item alisio-connections-entry">
                            <div class="alisio-connections-entry__head">
                              <div class="list-title">${target.label}</div>
                              <div class="alisio-connections-entry__pills">
                                ${ownerBadge
                                  ? html`<span class="pill">${ownerBadge}</span>`
                                  : nothing}
                              </div>
                            </div>
                            <div class="alisio-connections-entry__note">
                              ${describeSharingTargetAccess(target)}
                            </div>
                            ${scopes
                              ? html`
                                  <div class="alisio-connections-entry__note">
                                    ${text.currentScopes}: ${scopes}
                                  </div>
                                `
                              : nothing}
                            <div class="alisio-connections-entry__actions">
                              <button
                                class="btn"
                                ?disabled=${loading || !props.onSharingRevoke || !grantId}
                                @click=${() => grantId && props.onSharingRevoke?.(grantId)}
                              >
                                ${text.revoke}
                              </button>
                            </div>
                          </div>
                        `;
                      })}
                </div>
              </section>
              <section class="alisio-connections-subsection">
                <div class="alisio-connections-subsection__head">
                  <span class="alisio-connections-subsection__title">${text.incomingTitle}</span>
                  ${renderPanelCount(incomingRequests.length)}
                </div>
                <div class="list">
                  ${incomingRequests.length === 0
                    ? html`<div class="alisio-connections-empty">${text.incomingEmpty}</div>`
                    : incomingRequests.map((request) => {
                        const scopes = formatSharingScopes(request.scopes);
                        return html`
                          <div class="list-item alisio-connections-entry">
                            <div class="alisio-connections-entry__head">
                              <div class="list-title">${request.targetLabel}</div>
                              <div class="alisio-connections-entry__pills">
                                <span class="pill">${request.requester.label}</span>
                              </div>
                            </div>
                            ${scopes
                              ? html`
                                  <div class="alisio-connections-entry__note">
                                    ${text.currentScopes}: ${scopes}
                                  </div>
                                `
                              : nothing}
                            <div class="alisio-connections-entry__actions">
                              ${resolveSharingApprovalOptions(request.scopes).map(
                                (scope) => html`
                                  <button
                                    class="btn primary"
                                    ?disabled=${loading ||
                                    !props.onSharingApprove ||
                                    request.status !== "pending"}
                                    @click=${() =>
                                      props.onSharingApprove?.(
                                        request.requestId,
                                        expandSharingScopeSelection(scope),
                                      )}
                                  >
                                    ${text.approve} ${resolveSharingScopeLabel(scope) ?? scope}
                                  </button>
                                `,
                              )}
                              <button
                                class="btn"
                                ?disabled=${loading ||
                                !props.onSharingReject ||
                                request.status !== "pending"}
                                @click=${() => props.onSharingReject?.(request.requestId)}
                              >
                                ${text.reject}
                              </button>
                            </div>
                          </div>
                        `;
                      })}
                </div>
              </section>
            </div>
          `}
    </section>
  `;
}

export function renderConnections(props: NodesProps) {
  const pendingDevices = countPendingDevices(props);
  const pairedDevices = countPairedDevices(props);
  const connectedNodes = countConnectedNodes(props.nodes);
  const execReadyNodes = countReadyExecNodes(props.nodes);
  const pendingNodes = countPendingNodeRequests(props);
  const refreshing =
    props.loading ||
    props.devicesLoading ||
    props.nodePairingsLoading ||
    props.configLoading ||
    props.execApprovalsLoading;
  const showOverviewLoading =
    refreshing && props.nodes.length === 0 && !props.devicesList && !props.nodePairingsList;
  const text = {
    eyebrow: t("alisio.connections.eyebrow"),
    title: t("alisio.connections.title"),
    subtitle: t("alisio.connections.subtitle"),
    refreshing: t("alisio.connections.refreshing"),
    refreshAll: t("alisio.connections.refreshAll"),
    devicesTitle: t("alisio.connections.devices.title"),
    runtimeTitle: t("alisio.connections.runtimeTitle"),
    pendingDevices: t("alisio.connections.pendingDevices"),
    pairedDevices: t("alisio.connections.pairedDevices"),
    liveNodes: t("alisio.connections.liveNodes"),
    execReady: t("alisio.connections.nodes.execReady"),
    pendingNodes: t("alisio.connections.pendingNodes"),
  };
  const runtimeDetail =
    pendingNodes > 0
      ? `${execReadyNodes} ${text.execReady} · ${pendingNodes} ${text.pendingNodes}`
      : `${execReadyNodes} ${text.execReady}`;

  return html`
    <section class="alisio-page alisio-connections-page">
      <div class="card alisio-connections-hero">
        <div class="alisio-page__eyebrow">${text.eyebrow}</div>
        <div class="alisio-connections-hero__head">
          <div>
            <div class="card-title">${text.title}</div>
            <div class="card-sub">${text.subtitle}</div>
          </div>
          <button class="btn" ?disabled=${refreshing} @click=${props.onRefresh}>
            ${refreshing ? text.refreshing : text.refreshAll}
          </button>
        </div>
        <div class="alisio-connections-overview">
          ${showOverviewLoading
            ? renderSkeletonStatCards(2)
            : html`
                ${renderOverviewCard({
                  label: text.devicesTitle,
                  value: pairedDevices,
                  headline: text.pairedDevices,
                  detail: `${pendingDevices} ${text.pendingDevices}`,
                })}
                ${renderOverviewCard({
                  label: text.runtimeTitle,
                  value: connectedNodes,
                  headline: text.liveNodes,
                  detail: runtimeDetail,
                })}
              `}
        </div>
      </div>
      <div class="alisio-connections-stack">
        ${renderSharing(props)} ${renderNodes(props, { includeExecApprovals: false })}
      </div>
    </section>
  `;
}
