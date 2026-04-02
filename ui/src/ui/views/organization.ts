import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { AlisioOrganizationMembershipState } from "../types.ts";

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
  };

  return html`
    <section class="alisio-page">
      <div class="card alisio-organization-hero">
        <div class="card-title">${text.title}</div>
        <div class="card-sub">${text.subtitle}</div>
        ${props.error ? html`<div class="callout danger">${props.error}</div>` : nothing}
        ${props.loading
          ? html`<div class="empty-state" style="margin-top: 20px;">${text.loading}</div>`
          : hasOrganization
            ? html`
                <div class="alisio-organization-current">
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
                  <div class="row">
                    <button class="btn" @click=${props.onResetOrganization}>
                      ${text.leaveForNow}
                    </button>
                  </div>
                </div>
              `
            : html`
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
                        props.onOrganizationNameChange((event.target as HTMLInputElement).value)}
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
                              props.onInviteEmailChange((event.target as HTMLInputElement).value)}
                          />
                        </label>
                      `
                    : nothing}
                  <div class="row">
                    <button
                      class="btn"
                      ?disabled=${!props.organizationName.trim()}
                      @click=${props.draftMode === "create"
                        ? props.onCreateOrganization
                        : props.onJoinOrganization}
                    >
                      ${props.draftMode === "create" ? text.submitCreate : text.submitJoin}
                    </button>
                  </div>
                </div>
              `}
      </div>
    </section>
  `;
}
