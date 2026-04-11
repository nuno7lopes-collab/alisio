import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { renderSkeletonStatCards } from "./loading-skeleton.ts";
import { countConnectedNodes, countReadyExecNodes } from "./nodes-shared.ts";
import { renderNodes, type NodesProps } from "./nodes.ts";
import {
  expandSharingScopeSelection,
  SHARING_POLICY_MODE_ORDER,
  SHARING_RESOURCE_ORDER,
  resolveSharingApprovalOptions,
  resolveSharingRequestOptions,
  type SharingResourceKey,
  type SharingSuggestion,
} from "./sharing-shared.ts";

type SharingListTarget = NonNullable<NodesProps["sharing"]>["devices"]["available"][number];

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
      return t("alisio.connections.sharing.models");
    case "exec":
      return t("alisio.connections.sharing.exec");
    case "read-only":
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

function resolveSharingResourceLabel(resource: SharingResourceKey) {
  return t(`alisio.connections.sharing.resource.${resource}`);
}

function resolveSharingPolicyModeLabel(mode: string) {
  return t(`alisio.connections.sharing.policyMode.${mode}`);
}

function resolveSharingPolicyModeHint(mode: string) {
  return t(`alisio.connections.sharing.policyModeHint.${mode}`);
}

function resolveSharingResourcePolicies(sharing: NonNullable<NodesProps["sharing"]>) {
  return (
    sharing.policy.resourcePolicies ?? {
      compute: "light-approval",
      models: "paired-device",
      jobs: "light-approval",
      artifacts: "paired-device",
      cache: "paired-device",
      memory: "explicit-consent",
      vault: "explicit-consent",
      files: "explicit-consent",
      context: "explicit-consent",
    }
  );
}

function resolveExecutionPolicyMode(sharing: NonNullable<NodesProps["sharing"]>) {
  const policies = resolveSharingResourcePolicies(sharing);
  if (
    policies.models === "paired-device" &&
    policies.compute === "paired-device" &&
    policies.jobs === "paired-device"
  ) {
    return "paired-device";
  }
  if (
    policies.models === "explicit-consent" ||
    policies.compute === "explicit-consent" ||
    policies.jobs === "explicit-consent"
  ) {
    return "explicit-consent";
  }
  return "light-approval";
}

function resolveSensitiveSharingResourcesLabel() {
  return [
    t("alisio.connections.sharing.resource.memory"),
    t("alisio.connections.sharing.resource.vault"),
    t("alisio.connections.sharing.resource.files"),
    t("alisio.connections.sharing.resource.context"),
  ].join(", ");
}

function renderSharingSummary(sharing: NonNullable<NodesProps["sharing"]>) {
  return html`
    <div
      class="alisio-connections-summary"
      aria-label=${t("alisio.connections.sharing.summaryTitle")}
    >
      <span class="pill">${t("alisio.connections.sharing.summary.discovery")}</span>
      <span class="pill"
        >${t("alisio.connections.sharing.models")} ·
        ${resolveSharingPolicyModeLabel(resolveSharingResourcePolicies(sharing).models)}</span
      >
      <span class="pill"
        >${t("alisio.connections.sharing.exec")} ·
        ${resolveSharingPolicyModeLabel(resolveExecutionPolicyMode(sharing))}</span
      >
      <span class="pill"
        >${t("alisio.connections.sharing.summary.sensitive")} ·
        ${resolveSharingPolicyModeLabel("explicit-consent")}</span
      >
    </div>
  `;
}

function isPassiveSharingSuggestion(suggestion: SharingSuggestion) {
  return suggestion.kind === "sensitive-consent";
}

function resolveSharingSuggestionCopy(suggestion: SharingSuggestion) {
  switch (suggestion.kind) {
    case "model-reuse":
      return {
        title: t("alisio.connections.sharing.suggestion.modelReuse.title", {
          target: suggestion.targetLabel ?? suggestion.targetId ?? "",
        }),
        body: t("alisio.connections.sharing.suggestion.modelReuse.body"),
      };
    case "artifact-cache":
      return {
        title: t("alisio.connections.sharing.suggestion.artifactCache.title", {
          target: suggestion.targetLabel ?? suggestion.targetId ?? "",
        }),
        body: t("alisio.connections.sharing.suggestion.artifactCache.body"),
      };
    case "cache-reuse":
      return {
        title: t("alisio.connections.sharing.suggestion.cacheReuse.title", {
          target: suggestion.targetLabel ?? suggestion.targetId ?? "",
        }),
        body: t("alisio.connections.sharing.suggestion.cacheReuse.body"),
      };
    case "exec-upgrade":
      return {
        title: t("alisio.connections.sharing.suggestion.execUpgrade.title", {
          target: suggestion.targetLabel ?? suggestion.targetId ?? "",
        }),
        body: t("alisio.connections.sharing.suggestion.execUpgrade.body"),
      };
    case "distributed-jobs":
      return {
        title: t("alisio.connections.sharing.suggestion.distributedJobs.title", {
          target: suggestion.targetLabel ?? suggestion.targetId ?? "",
        }),
        body: t("alisio.connections.sharing.suggestion.distributedJobs.body"),
      };
    case "sensitive-consent":
      return {
        title: t("alisio.connections.sharing.suggestion.sensitiveConsent.title"),
        body: t("alisio.connections.sharing.suggestion.sensitiveConsent.body"),
      };
  }
}

function isSensitiveSharingResource(resource: SharingResourceKey) {
  return (
    resource === "memory" || resource === "vault" || resource === "files" || resource === "context"
  );
}

function renderSharingRequestButtons(params: {
  target: SharingListTarget;
  loading: boolean;
  onSharingRequest: NodesProps["onSharingRequest"];
}) {
  const requestStatus = resolveSharingStatusLabel(params.target.requestStatus);
  return resolveSharingRequestOptions(params.target).map((scope) => {
    const scopes = expandSharingScopeSelection(scope);
    const label =
      scope === "exec" &&
      (params.target.modelAccess === "shared" || params.target.modelAccess === "owner")
        ? t("alisio.connections.sharing.requestExec")
        : resolveSharingRequestLabel(scopes);
    return html`
      <button
        class="btn"
        ?disabled=${params.loading ||
        !params.onSharingRequest ||
        params.target.requestStatus === "pending"}
        @click=${() => params.onSharingRequest?.(params.target.targetId, scopes)}
      >
        ${params.target.requestStatus === "pending" ? requestStatus : label}
      </button>
    `;
  });
}

function describeSharingTargetAccess(target: SharingListTarget) {
  return [
    `${t("alisio.connections.sharing.models")}: ${resolveSharingAccessLabel(target.modelAccess)}`,
    `${t("alisio.connections.sharing.exec")}: ${resolveSharingAccessLabel(target.execAccess)}`,
  ].join(" · ");
}

function resolveSharingOwnerBadge(params: {
  viewer: NonNullable<NodesProps["sharing"]>["viewer"];
  target: SharingListTarget;
}) {
  if (params.target.ownerKey === params.viewer.ownerKey) {
    return t("alisio.connections.sharing.sameAccount");
  }
  return params.target.ownerLabel?.trim() || null;
}

function renderSharingSuggestions(params: {
  suggestions: readonly SharingSuggestion[];
  loading: boolean;
  onSharingRequest: NodesProps["onSharingRequest"];
}) {
  const suggestions = params.suggestions.filter(
    (suggestion) => !isPassiveSharingSuggestion(suggestion),
  );
  if (suggestions.length === 0) {
    return nothing;
  }
  return html`
    <section class="alisio-connections-subsection">
      <div class="alisio-connections-subsection__head">
        <span class="alisio-connections-subsection__title"
          >${t("alisio.connections.sharing.suggestionsTitle")}</span
        >
        ${renderPanelCount(suggestions.length)}
      </div>
      <div class="list">
        ${suggestions.map((suggestion) => {
          const copy = resolveSharingSuggestionCopy(suggestion);
          return html`
            <div class="list-item alisio-connections-entry alisio-connections-entry--compact">
              <div class="alisio-connections-entry__head">
                <div class="list-title">${copy.title}</div>
                <div class="alisio-connections-entry__pills">
                  <span class="pill">${resolveSharingResourceLabel(suggestion.resource)}</span>
                </div>
              </div>
              ${suggestion.targetLabel
                ? html`<div class="list-sub">${suggestion.targetLabel}</div>`
                : nothing}
              ${suggestion.targetId && suggestion.scopes && params.onSharingRequest
                ? html`
                    <div class="alisio-connections-entry__actions">
                      <button
                        class="btn"
                        ?disabled=${params.loading}
                        @click=${() =>
                          params.onSharingRequest?.(suggestion.targetId!, suggestion.scopes)}
                      >
                        ${suggestion.kind === "exec-upgrade"
                          ? t("alisio.connections.sharing.requestExec")
                          : resolveSharingRequestLabel(suggestion.scopes)}
                      </button>
                    </div>
                  `
                : nothing}
            </div>
          `;
        })}
      </div>
    </section>
  `;
}

function renderSharingResourcePolicies(
  props: NodesProps,
  sharing: NonNullable<NodesProps["sharing"]>,
) {
  const resourcePolicies = resolveSharingResourcePolicies(sharing);
  const automaticResources = SHARING_RESOURCE_ORDER.filter(
    (resource) => !isSensitiveSharingResource(resource),
  );
  return html`
    <section class="alisio-connections-subsection">
      <div class="alisio-connections-subsection__head">
        <span class="alisio-connections-subsection__title"
          >${t("alisio.connections.sharing.policyTitle")}</span
        >
      </div>
      <div class="list alisio-sharing-policy-grid">
        ${automaticResources.map((resource) => {
          const mode = resourcePolicies[resource];
          return html`
            <div class="list-item alisio-connections-entry alisio-connections-entry--policy">
              <div class="alisio-connections-entry__stack">
                <div class="list-title">${resolveSharingResourceLabel(resource)}</div>
                <div class="list-sub">${resolveSharingPolicyModeHint(mode)}</div>
              </div>
              <label class="alisio-connections-policy-select">
                <span class="sr-only"
                  >${resolveSharingResourceLabel(resource)}
                  ${t("alisio.connections.sharing.policyModeLabel")}</span
                >
                <select
                  aria-label=${`${resolveSharingResourceLabel(resource)} ${t("alisio.connections.sharing.policyModeLabel")}`}
                  .value=${mode}
                  ?disabled=${props.sharingLoading === true ||
                  !sharing.policy.resourcesEditable ||
                  !props.onSharingSetResourcePolicy}
                  @change=${(event: Event) =>
                    props.onSharingSetResourcePolicy?.(
                      resource,
                      (event.target as HTMLSelectElement)
                        .value as (typeof resourcePolicies)[typeof resource],
                    )}
                >
                  ${SHARING_POLICY_MODE_ORDER.map(
                    (candidate) =>
                      html`<option value=${candidate}>
                        ${resolveSharingPolicyModeLabel(candidate)}
                      </option>`,
                  )}
                </select>
              </label>
            </div>
          `;
        })}
        <div
          class="list-item alisio-connections-entry alisio-connections-entry--policy alisio-sharing-policy-grid__full"
        >
          <div class="alisio-connections-entry__stack">
            <div class="list-title">${t("alisio.connections.sharing.sensitiveGroup")}</div>
            <div class="list-sub">${resolveSensitiveSharingResourcesLabel()}</div>
          </div>
          <span class="pill">${resolveSharingPolicyModeLabel("explicit-consent")}</span>
        </div>
      </div>
    </section>
  `;
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
  const suggestions = sharing?.suggestions ?? [];
  const showAvailable = available.length > 0;
  const showShared = sharedWithMe.length > 0;
  const showIncoming = incomingRequests.length > 0;
  const showActivity = showAvailable || showShared || showIncoming;
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
    emptyState: t("alisio.connections.sharing.emptyState"),
  };
  const showExternalPolicyToggle =
    sharing != null &&
    sharing.policy.ownerScope === "organization" &&
    (sharing.policy.editable || typeof props.onSharingSetPolicy === "function");

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
      ${sharing ? renderSharingSummary(sharing) : nothing}
      ${showExternalPolicyToggle && sharing
        ? html`
            <label class="field" style="margin-top: 4px;">
              <span>${text.allowExternalUse}</span>
              <input
                type="checkbox"
                .checked=${sharing.policy.allowExternalUse}
                ?disabled=${loading || !sharing.policy.editable || !props.onSharingSetPolicy}
                @change=${(event: Event) =>
                  props.onSharingSetPolicy?.((event.target as HTMLInputElement).checked)}
              />
            </label>
            <div class="alisio-connections-entry__note" style="margin-top: -4px;">
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
              ${renderSharingSuggestions({
                suggestions,
                loading,
                onSharingRequest: props.onSharingRequest,
              })}
              ${sharing ? renderSharingResourcePolicies(props, sharing) : nothing}
              ${showAvailable
                ? html`<section class="alisio-connections-subsection">
                    <div class="alisio-connections-subsection__head">
                      <span class="alisio-connections-subsection__title"
                        >${text.availableTitle}</span
                      >
                      ${renderPanelCount(available.length)}
                    </div>
                    <div class="list">
                      ${available.map((target) => {
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
                              ${renderSharingRequestButtons({
                                target,
                                loading,
                                onSharingRequest: props.onSharingRequest,
                              })}
                            </div>
                          </div>
                        `;
                      })}
                    </div>
                  </section>`
                : nothing}
              ${showShared
                ? html`<section class="alisio-connections-subsection">
                    <div class="alisio-connections-subsection__head">
                      <span class="alisio-connections-subsection__title">${text.sharedTitle}</span>
                      ${renderPanelCount(sharedWithMe.length)}
                    </div>
                    <div class="list">
                      ${sharedWithMe.map((target) => {
                        const scopes = formatSharingScopes(target.grantScopes);
                        const grantId = target.grantId;
                        const requestButtons = renderSharingRequestButtons({
                          target,
                          loading,
                          onSharingRequest: props.onSharingRequest,
                        });
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
                            ${scopes
                              ? html`
                                  <div class="alisio-connections-entry__note">
                                    ${text.currentScopes}: ${scopes}
                                  </div>
                                `
                              : nothing}
                            ${requestButtons.length > 0 || grantId
                              ? html`
                                  <div class="alisio-connections-entry__actions">
                                    ${requestButtons}
                                    ${grantId
                                      ? html`
                                          <button
                                            class="btn"
                                            ?disabled=${loading || !props.onSharingRevoke}
                                            @click=${() => props.onSharingRevoke?.(grantId)}
                                          >
                                            ${text.revoke}
                                          </button>
                                        `
                                      : nothing}
                                  </div>
                                `
                              : nothing}
                          </div>
                        `;
                      })}
                    </div>
                  </section>`
                : nothing}
              ${showIncoming
                ? html`<section class="alisio-connections-subsection">
                    <div class="alisio-connections-subsection__head">
                      <span class="alisio-connections-subsection__title"
                        >${text.incomingTitle}</span
                      >
                      ${renderPanelCount(incomingRequests.length)}
                    </div>
                    <div class="list">
                      ${incomingRequests.map((request) => {
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
                  </section>`
                : nothing}
              ${!showActivity
                ? html`
                    <section class="alisio-connections-subsection">
                      <div class="alisio-connections-empty">${text.emptyState}</div>
                    </section>
                  `
                : nothing}
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
