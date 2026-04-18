import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { resolveConnectionsModel } from "../controllers/connections-model.ts";
import { icons } from "../icons.ts";
import { renderComputersPanel } from "./connections-computers.ts";
import {
  renderSkeletonLines,
  renderSkeletonListItem,
  renderSkeletonPill,
} from "./loading-skeleton.ts";
import type { NodesProps } from "./connections-types.ts";
import { renderNodes } from "./nodes.ts";
import {
  expandSharingScopeSelection,
  SHARING_POLICY_MODE_ORDER,
  SHARING_RESOURCE_ORDER,
  resolveSharingApprovalOptions,
  resolveSharingRequestOptions,
  type SharingResourceKey,
  type SharingSuggestion,
} from "./sharing-shared.ts";

type SharingListTarget = NonNullable<NodesProps["computers"]["sharing"]>["devices"]["available"][number];

function renderOverviewCard(params: {
  label: string;
  value: number | string;
  detail?: string | null;
  icon: unknown;
}) {
  return html`
    <article class="alisio-connections-overview-card">
      <span class="alisio-connections-overview-card__icon" aria-hidden="true">${params.icon}</span>
      <span class="alisio-connections-overview-card__label">${params.label}</span>
      <strong>${params.value}</strong>
      ${params.detail
        ? html`<div class="alisio-connections-overview-card__detail">${params.detail}</div>`
        : nothing}
    </article>
  `;
}

function renderOverviewSkeletonCard(icon: unknown) {
  return html`
    <article class="alisio-connections-overview-card alisio-connections-overview-card--skeleton">
      <span class="alisio-connections-overview-card__icon" aria-hidden="true">${icon}</span>
      <span class="skeleton skeleton-line skeleton-line--short" aria-hidden="true"></span>
      <span class="skeleton alisio-connections-overview-card__metric-skeleton" aria-hidden="true">
      </span>
      ${renderSkeletonLines(["medium"], {
        compact: true,
        className: "alisio-connections-overview-card__detail-skeleton",
      })}
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
  return normalized ? t(`alisio.connections.sharing.requestStatus.${normalized}`) : "";
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

function resolveSharingResourcePolicies(sharing: NonNullable<NodesProps["computers"]["sharing"]>) {
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

function resolveExecutionPolicyMode(sharing: NonNullable<NodesProps["computers"]["sharing"]>) {
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

function renderSharingSummary(sharing: NonNullable<NodesProps["computers"]["sharing"]>) {
  const resourcePolicies = resolveSharingResourcePolicies(sharing);
  return html`
    <div
      class="alisio-connections-summary"
      aria-label=${t("alisio.connections.sharing.summaryTitle")}
    >
      <div class="alisio-connections-summary-item">
        <span class="alisio-connections-summary-item__label"
          >${t("alisio.connections.sharing.title")}</span
        >
        <strong>${t("alisio.connections.sharing.summary.discovery")}</strong>
      </div>
      <div class="alisio-connections-summary-item">
        <span class="alisio-connections-summary-item__label"
          >${t("alisio.connections.sharing.models")}</span
        >
        <strong>${resolveSharingPolicyModeLabel(resourcePolicies.models)}</strong>
      </div>
      <div class="alisio-connections-summary-item">
        <span class="alisio-connections-summary-item__label"
          >${t("alisio.connections.sharing.exec")}</span
        >
        <strong>${resolveSharingPolicyModeLabel(resolveExecutionPolicyMode(sharing))}</strong>
      </div>
      <div class="alisio-connections-summary-item">
        <span class="alisio-connections-summary-item__label"
          >${t("alisio.connections.sharing.summary.sensitive")}</span
        >
        <strong>${resolveSharingPolicyModeLabel("explicit-consent")}</strong>
      </div>
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
  viewer: NonNullable<NodesProps["computers"]["sharing"]>["viewer"];
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
    <section class="alisio-connections-subsection alisio-connections-subsection--insights">
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
  sharing: NonNullable<NodesProps["computers"]["sharing"]>,
) {
  const resourcePolicies = resolveSharingResourcePolicies(sharing);
  const automaticResources = SHARING_RESOURCE_ORDER.filter(
    (resource) => !isSensitiveSharingResource(resource),
  );
  return html`
    <section class="alisio-connections-subsection alisio-connections-subsection--policy">
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
                  ?disabled=${props.computers.sharingLoading === true ||
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

function renderSharingContent(props: NodesProps) {
  const loading = props.computers.sharingLoading === true;
  const showPanel =
    loading || props.computers.sharingError != null || props.computers.sharing != null;
  if (!showPanel) {
    return nothing;
  }

  const sharing = props.computers.sharing;
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
    loading: t("alisio.connections.loading"),
    refresh: t("common.refresh"),
    availableTitle: t("alisio.connections.sharing.availableTitle"),
    availableEmpty: t("alisio.connections.sharing.availableEmpty"),
    sharedTitle: t("alisio.connections.sharing.sharedTitle"),
    sharedEmpty: t("alisio.connections.sharing.sharedEmpty"),
    incomingTitle: t("alisio.connections.sharing.incomingTitle"),
    incomingEmpty: t("alisio.connections.sharing.incomingEmpty"),
    currentScopes: t("alisio.connections.sharing.currentScopes"),
    approve: t("alisio.connections.sharing.approve"),
    reject: t("alisio.connections.sharing.reject"),
    revoke: t("alisio.connections.sharing.revoke"),
    allowExternalUse: t("alisio.connections.sharing.allowExternalUse"),
    externalOn: t("alisio.connections.sharing.externalOn"),
    externalOff: t("alisio.connections.sharing.externalOff"),
    emptyState: t("alisio.connections.sharing.emptyState"),
  };
  const showExternalPolicyToggle =
    sharing != null &&
    sharing.policy.ownerScope === "organization" &&
    (sharing.policy.editable || typeof props.onSharingSetPolicy === "function");

  return html`
    <div class="alisio-connections-panel__body alisio-connections-panel__body--sharing">
      ${props.computers.sharingError
        ? html`<div class="callout danger" style="margin-top: 12px;"
            >${props.computers.sharingError}</div
          >`
        : nothing}
      ${sharing
        ? html`
            <div class="alisio-connections-toolbar">
              ${renderSharingSummary(sharing)}
              ${showExternalPolicyToggle
                ? html`
                    <div class="alisio-connections-inline-setting">
                      <label class="field alisio-connections-inline-setting__field">
                        <span>${text.allowExternalUse}</span>
                        <input
                          type="checkbox"
                          .checked=${sharing.policy.allowExternalUse}
                          ?disabled=${loading ||
                          !sharing.policy.editable ||
                          !props.onSharingSetPolicy}
                          @change=${(event: Event) =>
                            props.onSharingSetPolicy?.((event.target as HTMLInputElement).checked)}
                        />
                      </label>
                      <div class="alisio-connections-inline-setting__note">
                        ${sharing.policy.allowExternalUse ? text.externalOn : text.externalOff}
                      </div>
                    </div>
                  `
                : nothing}
            </div>
          `
        : nothing}
      ${loading && !sharing
        ? html`
            <div class="alisio-connections-sections" role="status" aria-label=${text.loading}>
              <section class="alisio-connections-subsection">
                <div class="alisio-connections-subsection__head">
                  <span class="alisio-connections-subsection__title">${text.availableTitle}</span>
                  ${renderSkeletonPill({ small: true })}
                </div>
                <div class="loading-state__list">
                  ${renderSkeletonListItem({ lines: ["medium", "long", "short"], aside: "button" })}
                  ${renderSkeletonListItem({ lines: ["short", "medium"], aside: "pill" })}
                </div>
              </section>
              <section class="alisio-connections-subsection">
                <div class="alisio-connections-subsection__head">
                  <span class="alisio-connections-subsection__title">${text.sharedTitle}</span>
                  ${renderSkeletonPill({ small: true })}
                </div>
                <div class="loading-state__list">
                  ${renderSkeletonListItem({ lines: ["medium", "long"], aside: "button" })}
                  ${renderSkeletonListItem({ lines: ["short", "medium", "long"] })}
                </div>
              </section>
            </div>
          `
        : html`
            <div class="alisio-connections-sections">
              <div class="alisio-connections-sections alisio-connections-sections--sharing-top">
                ${renderSharingSuggestions({
                  suggestions,
                  loading,
                  onSharingRequest: props.onSharingRequest,
                })}
                ${sharing ? renderSharingResourcePolicies(props, sharing) : nothing}
              </div>
              <div
                class="alisio-connections-sections alisio-connections-sections--sharing-activity"
              >
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
                        <span class="alisio-connections-subsection__title"
                          >${text.sharedTitle}</span
                        >
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
            </div>
          `}
    </div>
  `;
}

export function renderConnections(props: NodesProps) {
  const computers = props.computers;
  const connectionsModel = resolveConnectionsModel(computers);
  const accountComputers = connectionsModel.accountComputersCount;
  const pendingAccess =
    connectionsModel.pendingDeviceRequests.length +
    connectionsModel.pendingSharing.incoming.length +
    connectionsModel.pendingSharing.outgoing.length;
  const onlineComputers = connectionsModel.onlineComputersCount;
  const execReadyNodes = connectionsModel.execReadyNodesCount;
  const refreshing =
    computers.nodesLoading ||
    computers.devicesLoading ||
    Boolean(computers.sharingLoading) ||
    computers.nodePairingsLoading;
  const devicesInitialLoading = !computers.devicesList && !computers.devicesError;
  const runtimeInitialLoading =
    (!computers.nodesLoaded && !computers.nodesError) ||
    (!computers.nodePairingsList && !computers.nodePairingsError);
  const devicesUnavailable = !computers.devicesList && Boolean(computers.devicesError);
  const runtimeUnavailable =
    (!computers.nodesLoaded && Boolean(computers.nodesError)) ||
    (!computers.nodePairingsList && Boolean(computers.nodePairingsError));
  const text = {
    title: t("alisio.connections.title"),
    refreshing: t("alisio.connections.refreshing"),
    refreshAll: t("alisio.connections.refreshAll"),
    accountComputers: t("alisio.connections.accountComputers"),
    onlineComputers: t("alisio.connections.onlineComputers"),
    pendingAccess: t("alisio.connections.pendingAccess"),
    execReady: t("alisio.connections.nodes.execReady"),
    na: t("common.na"),
    advanced: t("alisio.connections.advanced"),
  };
  return html`
    <section class="alisio-page alisio-connections-page">
      <div class="card alisio-connections-hero" aria-busy=${refreshing ? "true" : "false"}>
        <div class="alisio-connections-hero__head">
          <div>
            <div class="card-title">${text.title}</div>
          </div>
          <button class="btn" ?disabled=${refreshing} @click=${props.onRefresh}>
            ${refreshing ? text.refreshing : text.refreshAll}
          </button>
        </div>
        <div class="alisio-connections-overview">
          ${devicesInitialLoading
            ? renderOverviewSkeletonCard(icons.smartphone)
            : renderOverviewCard({
                label: text.accountComputers,
                value: devicesUnavailable ? text.na : accountComputers,
                icon: icons.smartphone,
              })}
          ${devicesInitialLoading
            ? renderOverviewSkeletonCard(icons.radio)
            : renderOverviewCard({
                label: text.pendingAccess,
                value: devicesUnavailable ? text.na : pendingAccess,
                icon: icons.radio,
              })}
          ${runtimeInitialLoading
            ? renderOverviewSkeletonCard(icons.monitor)
            : renderOverviewCard({
                label: text.onlineComputers,
                value: runtimeUnavailable ? text.na : onlineComputers,
                icon: icons.monitor,
              })}
          ${runtimeInitialLoading
            ? renderOverviewSkeletonCard(icons.zap)
            : renderOverviewCard({
                label: text.execReady,
                value: runtimeUnavailable ? text.na : execReadyNodes,
                icon: icons.zap,
              })}
        </div>
      </div>
      <div class="alisio-connections-stack">
        ${renderComputersPanel(props, connectionsModel)}
        ${connectionsModel.hasAdvancedSharing
          ? html`
              <details class="card alisio-connections-panel alisio-connections-panel--sharing">
                <summary class="alisio-connections-panel__head">
                  <div class="alisio-connections-panel__identity">
                    <span class="alisio-connections-panel__icon" aria-hidden="true"
                      >${icons.link}</span
                    >
                    <div>
                      <div class="card-title">${text.advanced}</div>
                      <div class="card-sub">${t("alisio.connections.sharing.subtitle")}</div>
                    </div>
                  </div>
                </summary>
                ${renderSharingContent(props)}
              </details>
            `
          : nothing}
        ${renderNodes(
          props,
          {
            includeExecApprovals: false,
            collapseNodeInventoryByComputer: true,
          },
          {
            connectionsModel,
          },
        )}
      </div>
    </section>
  `;
}
