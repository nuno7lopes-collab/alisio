import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { AlisioOrganizationMembershipState } from "../types.ts";
import {
  renderSkeletonButton,
  renderSkeletonLines,
  renderSkeletonListItem,
  renderSkeletonPill,
} from "./loading-skeleton.ts";

export function renderOrganization(props: {
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
  const showInitialLoading = props.loading && !props.organization && !props.error;
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
    submitCreate: t("alisio.organization.submitCreate"),
    submitJoin: t("alisio.organization.submitJoin"),
    keepPersonalTitle: t("alisio.organization.keepPersonalTitle"),
    keepPersonalBody: t("alisio.organization.keepPersonalBody"),
    afterFirstChatTitle: t("alisio.organization.afterFirstChatTitle"),
    afterFirstChatBody: t("alisio.organization.afterFirstChatBody"),
  };

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
            : html`<span class="pill">${membershipLabel}</span>`}
        </div>
        ${props.error ? html`<div class="callout danger">${props.error}</div>` : nothing}
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
                    <div class="row">
                      <button class="btn" @click=${props.onResetOrganization}>
                        ${text.leaveForNow}
                      </button>
                    </div>
                  </div>
                </div>
              `
            : html`
                <div class="alisio-organization-grid">
                  <div class="card alisio-organization-panel">
                    <div class="alisio-organization-actions">
                      <button
                        class="chip ${props.draftMode === "create" ? "chip-active" : ""}"
                        @click=${() => props.onDraftModeChange("create")}
                      >
                        ${text.createOrganization}
                      </button>
                      <button
                        class="chip ${props.draftMode === "join" ? "chip-active" : ""}"
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
                          placeholder=${props.draftMode === "create"
                            ? text.createPlaceholder
                            : text.joinPlaceholder}
                          .value=${props.organizationName}
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
                                placeholder=${text.invitationPlaceholder}
                                .value=${props.inviteEmail}
                                @input=${(event: Event) =>
                                  props.onInviteEmailChange(
                                    (event.target as HTMLInputElement).value,
                                  )}
                              />
                            </label>
                          `
                        : nothing}
                      <div class="row">
                        <button
                          class="btn primary"
                          ?disabled=${!props.organizationName.trim()}
                          @click=${props.draftMode === "create"
                            ? props.onCreateOrganization
                            : props.onJoinOrganization}
                        >
                          ${props.draftMode === "create" ? text.submitCreate : text.submitJoin}
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
      </div>
    </section>
  `;
}
