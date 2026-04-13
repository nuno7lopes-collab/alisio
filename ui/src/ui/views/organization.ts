import { html, nothing } from "lit";
import { validateAlisioEmail } from "../../../../src/shared/alisio-account.js";
import {
  alisioSupportsOrganizations,
  normalizeAlisioPlan,
} from "../../../../src/shared/alisio-billing.js";
import { t } from "../../i18n/index.ts";
import type { AlisioOrganizationMembershipState } from "../types.ts";
import {
  renderSkeletonButton,
  renderSkeletonLines,
  renderSkeletonListItem,
  renderSkeletonPill,
} from "./loading-skeleton.ts";

export function renderOrganization(props: {
  connected: boolean;
  accountReady: boolean;
  plan?: string | null | undefined;
  loading: boolean;
  error: string | null;
  organization: AlisioOrganizationMembershipState | null;
  draftMode: "create" | "join";
  organizationName: string;
  inviteEmail: string;
  onDraftModeChange: (mode: "create" | "join") => void;
  onOrganizationNameChange: (value: string) => void;
  onInviteEmailChange: (value: string) => void;
  onCreateOrganization: () => void;
  onJoinOrganization: () => void;
  onResetOrganization: () => void;
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
    upgradeHint: t("alisio.organization.upgradeHint"),
    createHint: t("alisio.organization.createHint"),
    leaveHint: t("alisio.organization.leaveHint"),
  };

  return html`
    <section class="alisio-page">
      <div class="card alisio-organization-hero">
        <div class="alisio-organization-hero__topbar">
          <div class="card-title">${text.title}</div>
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
        ${props.connected && props.accountReady && !hasOrganization && !organizationsSupported
          ? html`<div class="callout info">${text.upgradeHint}</div>`
          : nothing}
        ${showInitialLoading
          ? html`
              <div class="alisio-organization-grid" role="status" aria-label=${text.loading}>
                <div class="card alisio-organization-panel alisio-organization-panel--full">
                  ${renderSkeletonLines(["medium", "long"], { compact: true })}
                  <div class="loading-state__list">
                    ${renderSkeletonListItem({ lines: ["short", "long", "medium"], aside: "pill" })}
                    ${renderSkeletonListItem({ lines: ["medium", "short"] })}
                  </div>
                  <div class="row">${renderSkeletonButton({ wide: true })}</div>
                </div>
              </div>
            `
          : hasOrganization
            ? html`
                <div class="alisio-organization-grid">
                  <div class="card alisio-organization-panel alisio-organization-panel--full">
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
                    <div class="card-sub">${text.leaveHint}</div>
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
                  <div class="card alisio-organization-panel alisio-organization-panel--full">
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
                      <div class="card-sub">${text.createHint}</div>
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
                </div>
              `}
      </div>
    </section>
  `;
}
