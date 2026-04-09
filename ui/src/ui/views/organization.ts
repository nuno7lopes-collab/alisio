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
  resolveSharingRequestOptions,
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
  const formatScopes = (scopes: readonly string[] | null | undefined) =>
    Array.isArray(scopes) && scopes.length > 0 ? scopes.join(" · ") : null;
  const scopeLabel = (scope: string) =>
    scope === "exec"
      ? text.sharingExec
      : scope === "model-use"
        ? text.sharingModelUse
        : text.sharingReadOnly;

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
                  <div class="agent-kv">
                    <div class="label">${text.sharingPolicyTitle}</div>
                    <div>${text.sharingPolicyBody}</div>
                  </div>
                  <label class="field">
                    <span>${text.sharingAllowExternalUse}</span>
                    <input
                      type="checkbox"
                      .checked=${sharing?.policy.allowExternalUse === true}
                      ?disabled=${sharingDisabled ||
                      !sharing?.policy.editable ||
                      !sharing?.planSupported}
                      @change=${(event: Event) =>
                        props.onSetPolicy((event.target as HTMLInputElement).checked)}
                    />
                  </label>
                </div>
                <div class="card alisio-organization-panel">
                  <div class="card-title">${text.sharingOwnedTitle}</div>
                  <div class="loading-state__list">
                    ${(sharing?.devices.owned ?? []).length > 0
                      ? (sharing?.devices.owned ?? []).map(
                          (target) => html`
                            <div class="list-item">
                              <div>${target.label}</div>
                              <div class="list-sub">${target.platform ?? target.targetId}</div>
                            </div>
                          `,
                        )
                      : html`<div class="muted">${text.sharingOwnedEmpty}</div>`}
                  </div>
                </div>
                <div class="card alisio-organization-panel">
                  <div class="card-title">${text.sharingAvailableTitle}</div>
                  <div class="loading-state__list">
                    ${(sharing?.devices.available ?? []).length > 0
                      ? (sharing?.devices.available ?? []).map(
                          (target) => html`
                            <div class="list-item">
                              <div>${target.label}</div>
                              <div class="list-sub">${target.ownerLabel}</div>
                              <div class="row">
                                ${resolveSharingRequestOptions(target).map(
                                  (scope) => html`
                                    <button
                                      class="btn"
                                      ?disabled=${sharingDisabled ||
                                      target.requestStatus === "pending"}
                                      @click=${() =>
                                        props.onRequestAccess(
                                          target.targetId,
                                          expandSharingScopeSelection(scope),
                                        )}
                                    >
                                      ${target.requestStatus === "pending"
                                        ? requestStatusLabel(target.requestStatus)
                                        : `${text.sharingRequestAccess} ${scopeLabel(scope)}`}
                                    </button>
                                  `,
                                )}
                              </div>
                            </div>
                          `,
                        )
                      : html`<div class="muted">${text.sharingAvailableEmpty}</div>`}
                  </div>
                </div>
                <div class="card alisio-organization-panel">
                  <div class="card-title">${text.sharingSharedTitle}</div>
                  <div class="loading-state__list">
                    ${(sharing?.devices.sharedWithMe ?? []).length > 0
                      ? (sharing?.devices.sharedWithMe ?? []).map(
                          (target) => html`
                            <div class="list-item">
                              <div>${target.label}</div>
                              <div class="list-sub">${target.ownerLabel}</div>
                              ${formatScopes(target.approvalScopes ?? target.grantScopes)
                                ? html`
                                    <div class="list-sub">
                                      ${formatScopes(target.approvalScopes ?? target.grantScopes)}
                                    </div>
                                  `
                                : nothing}
                              <div class="row">
                                <button
                                  class="btn"
                                  ?disabled=${sharingDisabled ||
                                  !(target.approvalId ?? target.grantId)}
                                  @click=${() =>
                                    (target.approvalId ?? target.grantId) &&
                                    props.onRevokeGrant(target.approvalId ?? target.grantId!)}
                                >
                                  ${text.sharingRevoke}
                                </button>
                              </div>
                            </div>
                          `,
                        )
                      : html`<div class="muted">${text.sharingSharedEmpty}</div>`}
                  </div>
                </div>
                <div class="card alisio-organization-panel">
                  <div class="card-title">${text.sharingIncomingTitle}</div>
                  <div class="loading-state__list">
                    ${(sharing?.incomingRequests ?? []).length > 0
                      ? (sharing?.incomingRequests ?? []).map(
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
                        )
                      : html`<div class="muted">${text.sharingIncomingEmpty}</div>`}
                  </div>
                </div>
                <div class="card alisio-organization-panel">
                  <div class="card-title">${text.sharingOutgoingTitle}</div>
                  <div class="loading-state__list">
                    ${(sharing?.outgoingRequests ?? []).length > 0
                      ? (sharing?.outgoingRequests ?? []).map(
                          (request) => html`
                            <div class="list-item">
                              <div>${request.targetLabel}</div>
                              <div class="list-sub">${requestStatusLabel(request.status)}</div>
                              ${formatScopes(request.scopes)
                                ? html`<div class="list-sub">${formatScopes(request.scopes)}</div>`
                                : nothing}
                            </div>
                          `,
                        )
                      : html`<div class="muted">${text.sharingOutgoingEmpty}</div>`}
                  </div>
                </div>
                <div class="card alisio-organization-panel">
                  <div class="card-title">${text.sharingGrantsTitle}</div>
                  <div class="loading-state__list">
                    ${(sharing?.approvals ?? sharing?.grants ?? []).length > 0
                      ? (sharing?.approvals ?? sharing?.grants ?? []).map(
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
                                  @click=${() =>
                                    props.onRevokeGrant(grant.approvalId ?? grant.grantId)}
                                >
                                  ${text.sharingRevoke}
                                </button>
                              </div>
                            </div>
                          `,
                        )
                      : html`<div class="muted">${text.sharingGrantsEmpty}</div>`}
                  </div>
                </div>
                <div class="card alisio-organization-panel">
                  <div class="card-title">${text.sharingAuditTitle}</div>
                  <div class="loading-state__list">
                    ${(sharing?.audit ?? []).length > 0
                      ? (sharing?.audit ?? []).slice(0, 10).map(
                          (entry) => html`
                            <div class="list-item">
                              <div>${entry.summary}</div>
                              <div class="list-sub">${entry.createdAt}</div>
                            </div>
                          `,
                        )
                      : html`<div class="muted">${text.sharingAuditEmpty}</div>`}
                  </div>
                </div>
              </div>
            `
          : nothing}
      </div>
    </section>
  `;
}
