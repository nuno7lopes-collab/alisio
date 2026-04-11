import { html, nothing } from "lit";
import { validateAlisioEmail } from "../../../../src/shared/alisio-account.js";
import {
  alisioOrganizationsUpgradeMessage,
  alisioSupportsOrganizations,
  normalizeAlisioPlan,
} from "../../../../src/shared/alisio-billing.js";
import { t } from "../../i18n/index.ts";
import type { AlisioOrganizationMembershipState, AlisioSharingState } from "../types.ts";
import {
  renderSkeletonButton,
  renderSkeletonLines,
  renderSkeletonListItem,
  renderSkeletonPill,
} from "./loading-skeleton.ts";
import {
  expandSharingScopeSelection,
  resolveSharingApprovalOptions,
  SHARING_POLICY_MODE_ORDER,
  SHARING_RESOURCE_ORDER,
  resolveSharingRequestOptions,
  type SharingResourceKey,
  type SharingResourcePolicyMap,
  type SharingSuggestion,
} from "./sharing-shared.ts";

export function renderOrganization(props: {
  connected: boolean;
  accountReady: boolean;
  plan?: string | null | undefined;
  loading: boolean;
  error: string | null;
  organization: AlisioOrganizationMembershipState | null;
  sharingLoading: boolean;
  sharingError: string | null;
  sharing: AlisioSharingState | null;
  draftMode: "create" | "join";
  organizationName: string;
  inviteEmail: string;
  onDraftModeChange: (mode: "create" | "join") => void;
  onOrganizationNameChange: (value: string) => void;
  onInviteEmailChange: (value: string) => void;
  onCreateOrganization: () => void;
  onJoinOrganization: () => void;
  onResetOrganization: () => void;
  onRefreshSharing: () => void;
  onRequestAccess: (targetId: string, scopes?: readonly string[]) => void;
  onApproveRequest: (requestId: string, scopes?: readonly string[]) => void;
  onRejectRequest: (requestId: string) => void;
  onRevokeGrant: (grantId: string) => void;
  onSetPolicy: (allowExternalUse: boolean) => void;
  onSetResourcePolicy: (
    resource: SharingResourceKey,
    mode: SharingResourcePolicyMap[SharingResourceKey],
  ) => void;
}) {
  const membership = props.organization?.mode ?? "none";
  const hasOrganization = membership !== "none";
  const trimmedOrganizationName = props.organizationName.trim();
  const trimmedInviteEmail = props.inviteEmail.trim();
  const inviteEmailError =
    props.draftMode === "join" && trimmedInviteEmail && validateAlisioEmail(trimmedInviteEmail)
      ? t("alisio.organization.invitationInvalid")
      : null;
  const organizationsSupported = alisioSupportsOrganizations(normalizeAlisioPlan(props.plan));
  const planUpgradeMessage = organizationsSupported ? null : alisioOrganizationsUpgradeMessage();
  const canEditOrganization =
    props.connected && props.accountReady && !props.loading && organizationsSupported;
  const canSubmitDraft =
    canEditOrganization && trimmedOrganizationName.length > 0 && !inviteEmailError;
  const showInitialLoading =
    props.loading &&
    !props.organization &&
    !props.error &&
    !trimmedOrganizationName &&
    !trimmedInviteEmail;
  const membershipLabel =
    membership === "owner"
      ? t("alisio.organization.membership.owner")
      : membership === "member"
        ? t("alisio.organization.membership.member")
        : t("alisio.organization.membership.personal");
  const text = {
    title: t("alisio.organization.title"),
    subtitle: t("alisio.organization.subtitle"),
    loading: t("alisio.organization.loading"),
    currentOrganization: t("alisio.organization.currentOrganization"),
    unnamedOrganization: t("alisio.organization.unnamedOrganization"),
    youCreated: t("alisio.organization.youCreated"),
    youJoined: t("alisio.organization.youJoined"),
    invitation: t("alisio.organization.invitation"),
    linkedThroughEmail: t("alisio.organization.linkedThroughEmail"),
    leaveForNow: t("alisio.organization.leaveForNow"),
    createOrganization: t("alisio.organization.createOrganization"),
    joinOrganization: t("alisio.organization.joinOrganization"),
    organizationName: t("alisio.organization.organizationName"),
    createPlaceholder: t("alisio.organization.createPlaceholder"),
    joinPlaceholder: t("alisio.organization.joinPlaceholder"),
    invitationEmail: t("alisio.organization.invitationEmail"),
    invitationPlaceholder: t("alisio.organization.invitationPlaceholder"),
    invitationHint: t("alisio.organization.invitationHint"),
    invitationInvalid: t("alisio.organization.invitationInvalid"),
    submitCreate: t("alisio.organization.submitCreate"),
    submitJoin: t("alisio.organization.submitJoin"),
    saving: t("alisio.organization.saving"),
    reconnectHint: t("alisio.organization.reconnectHint"),
    accountHint: t("alisio.organization.accountHint"),
    keepPersonalTitle: t("alisio.organization.keepPersonalTitle"),
    keepPersonalBody: t("alisio.organization.keepPersonalBody"),
    afterFirstChatTitle: t("alisio.organization.afterFirstChatTitle"),
    afterFirstChatBody: t("alisio.organization.afterFirstChatBody"),
    sharingTitle: t("alisio.organization.sharing.title"),
    sharingSubtitle: t("alisio.organization.sharing.subtitle"),
    sharingRefresh: t("alisio.organization.sharing.refresh"),
    sharingPolicyTitle: t("alisio.organization.sharing.policyTitle"),
    sharingPolicyBody: t("alisio.organization.sharing.policyBody"),
    sharingAllowExternalUse: t("alisio.organization.sharing.allowExternalUse"),
    sharingOwnedTitle: t("alisio.organization.sharing.ownedTitle"),
    sharingOwnedEmpty: t("alisio.organization.sharing.ownedEmpty"),
    sharingAvailableTitle: t("alisio.organization.sharing.availableTitle"),
    sharingAvailableEmpty: t("alisio.organization.sharing.availableEmpty"),
    sharingSharedTitle: t("alisio.organization.sharing.sharedTitle"),
    sharingSharedEmpty: t("alisio.organization.sharing.sharedEmpty"),
    sharingIncomingTitle: t("alisio.organization.sharing.incomingTitle"),
    sharingIncomingEmpty: t("alisio.organization.sharing.incomingEmpty"),
    sharingOutgoingTitle: t("alisio.organization.sharing.outgoingTitle"),
    sharingOutgoingEmpty: t("alisio.organization.sharing.outgoingEmpty"),
    sharingGrantsTitle: t("alisio.organization.sharing.grantsTitle"),
    sharingGrantsEmpty: t("alisio.organization.sharing.grantsEmpty"),
    sharingAuditTitle: t("alisio.organization.sharing.auditTitle"),
    sharingAuditEmpty: t("alisio.organization.sharing.auditEmpty"),
    sharingRequestAccess: t("alisio.organization.sharing.requestAccess"),
    sharingApprove: t("alisio.organization.sharing.approve"),
    sharingReject: t("alisio.organization.sharing.reject"),
    sharingRevoke: t("alisio.organization.sharing.revoke"),
    sharingReadOnly: t("alisio.organization.sharing.scope.readOnly"),
    sharingModelUse: t("alisio.organization.sharing.scope.modelUse"),
    sharingExec: t("alisio.organization.sharing.scope.exec"),
  };
  const sharing = props.sharing;
  const sharingDisabled = !props.connected || !props.accountReady || props.sharingLoading;
  const sharingUpgradeMessage = sharing?.policy.upgradeMessage ?? null;
  const requestStatusLabel = (status: string | null | undefined) => {
    const normalized = status === "denied" ? "rejected" : status;
    return normalized ? t(`alisio.organization.sharing.requestStatus.${normalized}`) : "";
  };
  const resourceLabel = (resource: SharingResourceKey) =>
    t(`alisio.connections.sharing.resource.${resource}`);
  const policyModeLabel = (mode: string) => t(`alisio.connections.sharing.policyMode.${mode}`);
  const policyModeHint = (mode: string) => t(`alisio.connections.sharing.policyModeHint.${mode}`);
  const resourcePolicies = sharing?.policy.resourcePolicies ?? {
    compute: "light-approval",
    models: "paired-device",
    jobs: "light-approval",
    artifacts: "paired-device",
    cache: "paired-device",
    memory: "explicit-consent",
    vault: "explicit-consent",
    files: "explicit-consent",
    context: "explicit-consent",
  };
  const resolveExecutionPolicyMode = (state: AlisioSharingState) => {
    const policies = state.policy.resourcePolicies ?? resourcePolicies;
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
  };
  const sensitiveResourcesLabel = [
    t("alisio.connections.sharing.resource.memory"),
    t("alisio.connections.sharing.resource.vault"),
    t("alisio.connections.sharing.resource.files"),
    t("alisio.connections.sharing.resource.context"),
  ].join(", ");
  const formatScopes = (scopes: readonly string[] | null | undefined) =>
    Array.isArray(scopes) && scopes.length > 0 ? scopes.join(" · ") : null;
  const scopeLabel = (scope: string) =>
    scope === "exec"
      ? text.sharingExec
      : scope === "model-use"
        ? text.sharingModelUse
        : text.sharingReadOnly;
  const isSensitiveResource = (resource: SharingResourceKey) =>
    resource === "memory" || resource === "vault" || resource === "files" || resource === "context";
  const isPassiveSuggestion = (suggestion: SharingSuggestion) =>
    suggestion.kind === "sensitive-consent";
  const suggestionCopy = (suggestion: SharingSuggestion) => {
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
  };
  const renderRequestAccessButtons = (target: AlisioSharingState["devices"]["available"][number]) =>
    resolveSharingRequestOptions(target).map((scope) => {
      const scopes = expandSharingScopeSelection(scope);
      return html`
        <button
          class="btn"
          ?disabled=${sharingDisabled || target.requestStatus === "pending"}
          @click=${() => props.onRequestAccess(target.targetId, scopes)}
        >
          ${target.requestStatus === "pending"
            ? requestStatusLabel(target.requestStatus)
            : `${text.sharingRequestAccess} ${scopeLabel(scope)}`}
        </button>
      `;
    });
  const renderSuggestionAction = (suggestion: SharingSuggestion) =>
    suggestion.targetId && suggestion.scopes
      ? html`
          <div class="row">
            <button
              class="btn"
              ?disabled=${sharingDisabled}
              @click=${() => props.onRequestAccess(suggestion.targetId!, suggestion.scopes)}
            >
              ${t("alisio.connections.sharing.requestExec")}
            </button>
          </div>
        `
      : nothing;
  const visibleSuggestions = (sharing?.suggestions ?? []).filter(
    (suggestion) => !isPassiveSuggestion(suggestion),
  );
  const automaticResources = SHARING_RESOURCE_ORDER.filter(
    (resource) => !isSensitiveResource(resource),
  );
  const visibleSharingCards = [
    (sharing?.devices.owned ?? []).length,
    (sharing?.devices.available ?? []).length,
    (sharing?.devices.sharedWithMe ?? []).length,
    (sharing?.incomingRequests ?? []).length,
    (sharing?.outgoingRequests ?? []).length,
    (sharing?.approvals ?? sharing?.grants ?? []).length,
    (sharing?.audit ?? []).length,
  ].some((count) => count > 0);

  return html`
    <section class="alisio-page">
      <div class="card alisio-organization-hero">
        <div class="alisio-page__eyebrow">${text.title}</div>
        <div class="alisio-organization-hero__topbar">
          <div>
            <div class="card-title">${text.title}</div>
            <div class="card-sub">${text.subtitle}</div>
          </div>
          ${showInitialLoading
            ? renderSkeletonPill()
            : html`<span class="pill ${hasOrganization ? "pill--ready" : ""}"
                >${membershipLabel}</span
              >`}
        </div>
        ${props.error ? html`<div class="callout danger">${props.error}</div>` : nothing}
        ${!props.connected ? html`<div class="callout info">${text.reconnectHint}</div>` : nothing}
        ${props.connected && !props.accountReady && !showInitialLoading
          ? html`<div class="callout info">${text.accountHint}</div>`
          : nothing}
        ${props.connected && props.accountReady && !hasOrganization && planUpgradeMessage
          ? html`<div class="callout info">${planUpgradeMessage}</div>`
          : nothing}
        ${showInitialLoading
          ? html`
              <div class="alisio-organization-grid" role="status" aria-label=${text.loading}>
                <div class="card alisio-organization-panel">
                  ${renderSkeletonLines(["medium", "long"], { compact: true })}
                  <div class="loading-state__list">
                    ${renderSkeletonListItem({ lines: ["short", "long", "medium"], aside: "pill" })}
                    ${renderSkeletonListItem({ lines: ["medium", "short"] })}
                  </div>
                </div>
                <div class="card alisio-organization-panel alisio-organization-panel--muted">
                  ${renderSkeletonLines(["short", "medium"], { compact: true })}
                  ${renderSkeletonLines(["full", "long", "medium"])}
                  <div class="row">${renderSkeletonButton({ wide: true })}</div>
                </div>
              </div>
            `
          : hasOrganization
            ? html`
                <div class="alisio-organization-grid">
                  <div class="card alisio-organization-panel">
                    <div class="agent-kv">
                      <div class="label">${text.currentOrganization}</div>
                      <div>${props.organization?.organizationName ?? text.unnamedOrganization}</div>
                      <div class="agent-kv-sub">
                        ${membership === "owner" ? text.youCreated : text.youJoined}
                      </div>
                    </div>
                    ${props.organization?.inviteEmail
                      ? html`
                          <div class="agent-kv">
                            <div class="label">${text.invitation}</div>
                            <div>${props.organization.inviteEmail}</div>
                            <div class="agent-kv-sub">${text.linkedThroughEmail}</div>
                          </div>
                        `
                      : nothing}
                  </div>
                  <div class="card alisio-organization-panel">
                    <div class="card-title">${text.keepPersonalTitle}</div>
                    <div class="card-sub">${text.keepPersonalBody}</div>
                    <div class="row alisio-organization-panel__action">
                      <button
                        class="btn"
                        ?disabled=${!canEditOrganization}
                        @click=${props.onResetOrganization}
                      >
                        ${text.leaveForNow}
                      </button>
                    </div>
                  </div>
                </div>
              `
            : html`
                <div class="alisio-organization-grid">
                  <div class="card alisio-organization-panel">
                    <div class="alisio-organization-actions alisio-settings-options">
                      <button
                        class="chip ${props.draftMode === "create" ? "chip-active" : ""}"
                        ?disabled=${!canEditOrganization}
                        @click=${() => props.onDraftModeChange("create")}
                      >
                        ${text.createOrganization}
                      </button>
                      <button
                        class="chip ${props.draftMode === "join" ? "chip-active" : ""}"
                        ?disabled=${!canEditOrganization}
                        @click=${() => props.onDraftModeChange("join")}
                      >
                        ${text.joinOrganization}
                      </button>
                    </div>
                    <div class="alisio-organization-form">
                      <label class="field">
                        <span>${text.organizationName}</span>
                        <input
                          type="text"
                          autocomplete="organization"
                          placeholder=${props.draftMode === "create"
                            ? text.createPlaceholder
                            : text.joinPlaceholder}
                          .value=${props.organizationName}
                          ?disabled=${!canEditOrganization}
                          @input=${(event: Event) =>
                            props.onOrganizationNameChange(
                              (event.target as HTMLInputElement).value,
                            )}
                        />
                      </label>
                      ${props.draftMode === "join"
                        ? html`
                            <label class="field">
                              <span>${text.invitationEmail}</span>
                              <input
                                type="email"
                                autocomplete="email"
                                placeholder=${text.invitationPlaceholder}
                                .value=${props.inviteEmail}
                                ?disabled=${!canEditOrganization}
                                @input=${(event: Event) =>
                                  props.onInviteEmailChange(
                                    (event.target as HTMLInputElement).value,
                                  )}
                              />
                              <small class="field-note">${text.invitationHint}</small>
                            </label>
                          `
                        : nothing}
                      ${inviteEmailError
                        ? html`<div class="callout danger">${text.invitationInvalid}</div>`
                        : nothing}
                      <div class="row">
                        <button
                          class="btn primary"
                          ?disabled=${!canSubmitDraft}
                          @click=${props.draftMode === "create"
                            ? props.onCreateOrganization
                            : props.onJoinOrganization}
                        >
                          ${props.loading
                            ? text.saving
                            : props.draftMode === "create"
                              ? text.submitCreate
                              : text.submitJoin}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div class="card alisio-organization-panel alisio-organization-panel--muted">
                    <div class="card-title">${text.afterFirstChatTitle}</div>
                    <div class="card-sub">${text.afterFirstChatBody}</div>
                  </div>
                </div>
              `}
        ${props.connected && props.accountReady
          ? html`
              <div class="alisio-organization-grid">
                <div class="card alisio-organization-panel">
                  <div class="alisio-organization-hero__topbar">
                    <div>
                      <div class="card-title">${text.sharingTitle}</div>
                      <div class="card-sub">${text.sharingSubtitle}</div>
                    </div>
                    <button
                      class="btn"
                      ?disabled=${sharingDisabled}
                      @click=${props.onRefreshSharing}
                    >
                      ${text.sharingRefresh}
                    </button>
                  </div>
                  ${props.sharingError
                    ? html`<div class="callout danger">${props.sharingError}</div>`
                    : nothing}
                  ${sharingUpgradeMessage
                    ? html`<div class="callout info">${sharingUpgradeMessage}</div>`
                    : nothing}
                  ${sharing
                    ? html`
                        <div
                          class="alisio-connections-summary"
                          aria-label=${t("alisio.connections.sharing.summaryTitle")}
                        >
                          <span class="pill"
                            >${t("alisio.connections.sharing.summary.discovery")}</span
                          >
                          <span class="pill"
                            >${t("alisio.connections.sharing.models")} ·
                            ${policyModeLabel(resourcePolicies.models)}</span
                          >
                          <span class="pill"
                            >${t("alisio.connections.sharing.exec")} ·
                            ${policyModeLabel(resolveExecutionPolicyMode(sharing))}</span
                          >
                          <span class="pill"
                            >${t("alisio.connections.sharing.summary.sensitive")} ·
                            ${policyModeLabel("explicit-consent")}</span
                          >
                        </div>
                      `
                    : nothing}
                  ${sharing?.policy.ownerScope === "organization"
                    ? html`
                        <label class="field">
                          <span>${text.sharingAllowExternalUse}</span>
                          <input
                            type="checkbox"
                            .checked=${sharing?.policy.allowExternalUse ?? false}
                            ?disabled=${sharingDisabled ||
                            !sharing?.policy.editable ||
                            !sharing?.planSupported}
                            @change=${(event: Event) =>
                              props.onSetPolicy((event.target as HTMLInputElement).checked)}
                          />
                        </label>
                      `
                    : nothing}
                  ${sharing
                    ? html`
                        <div class="agent-kv" style="margin-top: 4px;">
                          <div class="label">${t("alisio.connections.sharing.policyTitle")}</div>
                        </div>
                        <div
                          class="loading-state__list alisio-sharing-policy-grid"
                          style="margin-top: 12px;"
                        >
                          ${automaticResources.map((resource) => {
                            const mode = resourcePolicies[resource];
                            return html`
                              <div
                                class="list-item alisio-connections-entry alisio-connections-entry--policy"
                              >
                                <div class="alisio-connections-entry__stack">
                                  <div>${resourceLabel(resource)}</div>
                                  <div class="list-sub">${policyModeHint(mode)}</div>
                                </div>
                                <label class="alisio-connections-policy-select">
                                  <span class="sr-only"
                                    >${resourceLabel(resource)}
                                    ${t("alisio.connections.sharing.policyModeLabel")}</span
                                  >
                                  <select
                                    aria-label=${`${resourceLabel(resource)} ${t("alisio.connections.sharing.policyModeLabel")}`}
                                    .value=${mode}
                                    ?disabled=${sharingDisabled ||
                                    !sharing.policy.resourcesEditable}
                                    @change=${(event: Event) =>
                                      props.onSetResourcePolicy(
                                        resource,
                                        (event.target as HTMLSelectElement)
                                          .value as SharingResourcePolicyMap[SharingResourceKey],
                                      )}
                                  >
                                    ${SHARING_POLICY_MODE_ORDER.map(
                                      (candidate) =>
                                        html`<option value=${candidate}>
                                          ${policyModeLabel(candidate)}
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
                              <div>${t("alisio.connections.sharing.sensitiveGroup")}</div>
                              <div class="list-sub">${sensitiveResourcesLabel}</div>
                            </div>
                            <span class="pill">${policyModeLabel("explicit-consent")}</span>
                          </div>
                        </div>
                      `
                    : nothing}
                </div>
                ${visibleSuggestions.length > 0
                  ? html`
                      <div class="card alisio-organization-panel">
                        <div class="card-title">
                          ${t("alisio.connections.sharing.suggestionsTitle")}
                        </div>
                        <div class="loading-state__list">
                          ${visibleSuggestions.map((suggestion) => {
                            const copy = suggestionCopy(suggestion);
                            return html`
                              <div
                                class="list-item alisio-connections-entry alisio-connections-entry--compact"
                              >
                                <div>${copy.title}</div>
                                ${suggestion.targetLabel
                                  ? html`<div class="list-sub">${suggestion.targetLabel}</div>`
                                  : nothing}
                                <div class="list-sub">${resourceLabel(suggestion.resource)}</div>
                                ${renderSuggestionAction(suggestion)}
                              </div>
                            `;
                          })}
                        </div>
                      </div>
                    `
                  : nothing}
                ${(sharing?.devices.owned ?? []).length > 0
                  ? html`<div class="card alisio-organization-panel">
                      <div class="card-title">${text.sharingOwnedTitle}</div>
                      <div class="loading-state__list">
                        ${(sharing?.devices.owned ?? []).map(
                          (target) => html`
                            <div class="list-item">
                              <div>${target.label}</div>
                              <div class="list-sub">${target.platform ?? target.targetId}</div>
                            </div>
                          `,
                        )}
                      </div>
                    </div>`
                  : nothing}
                ${(sharing?.devices.available ?? []).length > 0
                  ? html`<div class="card alisio-organization-panel">
                      <div class="card-title">${text.sharingAvailableTitle}</div>
                      <div class="loading-state__list">
                        ${(sharing?.devices.available ?? []).map(
                          (target) => html`
                            <div class="list-item">
                              <div>${target.label}</div>
                              <div class="list-sub">${target.ownerLabel}</div>
                              <div class="row">${renderRequestAccessButtons(target)}</div>
                            </div>
                          `,
                        )}
                      </div>
                    </div>`
                  : nothing}
                ${(sharing?.devices.sharedWithMe ?? []).length > 0
                  ? html`<div class="card alisio-organization-panel">
                      <div class="card-title">${text.sharingSharedTitle}</div>
                      <div class="loading-state__list">
                        ${(sharing?.devices.sharedWithMe ?? []).map((target) => {
                          const requestButtons = renderRequestAccessButtons(target);
                          const grantId = target.grantId;
                          return html`
                            <div class="list-item">
                              <div>${target.label}</div>
                              <div class="list-sub">${target.ownerLabel}</div>
                              ${formatScopes(target.grantScopes)
                                ? html`
                                    <div class="list-sub">${formatScopes(target.grantScopes)}</div>
                                  `
                                : nothing}
                              ${requestButtons.length > 0 || grantId
                                ? html`
                                    <div class="row">
                                      ${requestButtons}
                                      ${grantId
                                        ? html`
                                            <button
                                              class="btn"
                                              ?disabled=${sharingDisabled}
                                              @click=${() => props.onRevokeGrant(grantId)}
                                            >
                                              ${text.sharingRevoke}
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
                    </div>`
                  : nothing}
                ${(sharing?.incomingRequests ?? []).length > 0
                  ? html`<div class="card alisio-organization-panel">
                      <div class="card-title">${text.sharingIncomingTitle}</div>
                      <div class="loading-state__list">
                        ${(sharing?.incomingRequests ?? []).map(
                          (request) => html`
                            <div class="list-item">
                              <div>${request.targetLabel}</div>
                              <div class="list-sub">${request.requester.label}</div>
                              ${formatScopes(request.scopes)
                                ? html`<div class="list-sub">${formatScopes(request.scopes)}</div>`
                                : nothing}
                              <div class="row">
                                ${resolveSharingApprovalOptions(request.scopes).map(
                                  (scope) => html`
                                    <button
                                      class="btn primary"
                                      ?disabled=${sharingDisabled || request.status !== "pending"}
                                      @click=${() =>
                                        props.onApproveRequest(
                                          request.requestId,
                                          expandSharingScopeSelection(scope),
                                        )}
                                    >
                                      ${text.sharingApprove} ${scopeLabel(scope)}
                                    </button>
                                  `,
                                )}
                                <button
                                  class="btn"
                                  ?disabled=${sharingDisabled || request.status !== "pending"}
                                  @click=${() => props.onRejectRequest(request.requestId)}
                                >
                                  ${text.sharingReject}
                                </button>
                              </div>
                            </div>
                          `,
                        )}
                      </div>
                    </div>`
                  : nothing}
                ${(sharing?.outgoingRequests ?? []).length > 0
                  ? html`<div class="card alisio-organization-panel">
                      <div class="card-title">${text.sharingOutgoingTitle}</div>
                      <div class="loading-state__list">
                        ${(sharing?.outgoingRequests ?? []).map(
                          (request) => html`
                            <div class="list-item">
                              <div>${request.targetLabel}</div>
                              <div class="list-sub">${requestStatusLabel(request.status)}</div>
                              ${formatScopes(request.scopes)
                                ? html`<div class="list-sub">${formatScopes(request.scopes)}</div>`
                                : nothing}
                            </div>
                          `,
                        )}
                      </div>
                    </div>`
                  : nothing}
                ${(sharing?.approvals ?? sharing?.grants ?? []).length > 0
                  ? html`<div class="card alisio-organization-panel">
                      <div class="card-title">${text.sharingGrantsTitle}</div>
                      <div class="loading-state__list">
                        ${(sharing?.approvals ?? sharing?.grants ?? []).map(
                          (grant) => html`
                            <div class="list-item">
                              <div>${grant.targetLabel}</div>
                              <div class="list-sub">
                                ${grant.owner.label} → ${grant.grantee.label}
                              </div>
                              ${formatScopes(grant.scopes)
                                ? html`<div class="list-sub">${formatScopes(grant.scopes)}</div>`
                                : nothing}
                              <div class="row">
                                <button
                                  class="btn"
                                  ?disabled=${sharingDisabled}
                                  @click=${() => props.onRevokeGrant(grant.grantId)}
                                >
                                  ${text.sharingRevoke}
                                </button>
                              </div>
                            </div>
                          `,
                        )}
                      </div>
                    </div>`
                  : nothing}
                ${(sharing?.audit ?? []).length > 0
                  ? html`<div class="card alisio-organization-panel">
                      <div class="card-title">${text.sharingAuditTitle}</div>
                      <div class="loading-state__list">
                        ${(sharing?.audit ?? []).slice(0, 10).map(
                          (entry) => html`
                            <div class="list-item">
                              <div>${entry.summary}</div>
                              <div class="list-sub">${entry.createdAt}</div>
                            </div>
                          `,
                        )}
                      </div>
                    </div>`
                  : nothing}
                ${!visibleSharingCards
                  ? html`
                      <div class="card alisio-organization-panel">
                        <div class="muted">${t("alisio.connections.sharing.emptyState")}</div>
                      </div>
                    `
                  : nothing}
              </div>
            `
          : nothing}
      </div>
    </section>
  `;
}
