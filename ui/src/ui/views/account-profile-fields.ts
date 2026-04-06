import { html } from "lit";
import {
  ALISIO_AGENT_NAME_MAX_LENGTH,
  ALISIO_USERNAME_MAX_LENGTH,
  ALISIO_USERNAME_MIN_LENGTH,
  resolveAlisioAgentName,
} from "../../../../src/shared/alisio-account.js";

export type AccountProfileField =
  | "username"
  | "displayName"
  | "email"
  | "agentName"
  | "avatarLabel";

type AccountProfileFieldsProps = {
  profile: {
    username?: string;
    displayName?: string;
    email?: string;
    agentName?: string;
    avatarLabel?: string;
  } | null;
  emailFallback?: string;
  emailManagedByCloud: boolean;
  mode: "live" | "commit";
  labels: {
    displayName: string;
    agentName?: string;
    username: string;
    email: string;
    avatarLabel: string;
    emailManagedByCloud?: string;
  };
  onFieldChange: (field: AccountProfileField, value: string) => void;
};

function handleFieldChange(
  props: AccountProfileFieldsProps,
  field: AccountProfileField,
  event: Event,
) {
  props.onFieldChange(field, (event.target as HTMLInputElement).value);
}

export function renderAccountProfileFields(props: AccountProfileFieldsProps) {
  const agentNameValue =
    props.profile?.agentName === undefined
      ? resolveAlisioAgentName(undefined)
      : props.profile.agentName;

  return html`
    <label class="field">
      <span>${props.labels.displayName}</span>
      ${props.mode === "live"
        ? html`
            <input
              type="text"
              autocomplete="name"
              .value=${props.profile?.displayName ?? ""}
              @input=${(event: Event) => handleFieldChange(props, "displayName", event)}
            />
          `
        : html`
            <input
              type="text"
              autocomplete="name"
              .value=${props.profile?.displayName ?? ""}
              @change=${(event: Event) => handleFieldChange(props, "displayName", event)}
            />
          `}
    </label>
    ${props.labels.agentName
      ? html`
          <label class="field">
            <span>${props.labels.agentName}</span>
            ${props.mode === "live"
              ? html`
                  <input
                    type="text"
                    autocomplete="nickname"
                    maxlength=${String(ALISIO_AGENT_NAME_MAX_LENGTH)}
                    .value=${agentNameValue ?? ""}
                    @input=${(event: Event) => handleFieldChange(props, "agentName", event)}
                  />
                `
              : html`
                  <input
                    type="text"
                    autocomplete="nickname"
                    maxlength=${String(ALISIO_AGENT_NAME_MAX_LENGTH)}
                    .value=${agentNameValue ?? ""}
                    @change=${(event: Event) => handleFieldChange(props, "agentName", event)}
                  />
                `}
          </label>
        `
      : null}
    <label class="field">
      <span>${props.labels.username}</span>
      ${props.mode === "live"
        ? html`
            <input
              type="text"
              autocomplete="username"
              minlength=${String(ALISIO_USERNAME_MIN_LENGTH)}
              maxlength=${String(ALISIO_USERNAME_MAX_LENGTH)}
              .value=${props.profile?.username ?? ""}
              @input=${(event: Event) => handleFieldChange(props, "username", event)}
            />
          `
        : html`
            <input
              type="text"
              autocomplete="username"
              minlength=${String(ALISIO_USERNAME_MIN_LENGTH)}
              maxlength=${String(ALISIO_USERNAME_MAX_LENGTH)}
              .value=${props.profile?.username ?? ""}
              @change=${(event: Event) => handleFieldChange(props, "username", event)}
            />
          `}
    </label>
    <label class="field">
      <span>${props.labels.email}</span>
      ${props.mode === "live"
        ? html`
            <input
              type="email"
              autocomplete="email"
              inputmode="email"
              .value=${props.profile?.email ?? props.emailFallback ?? ""}
              ?disabled=${props.emailManagedByCloud}
              @input=${(event: Event) => handleFieldChange(props, "email", event)}
            />
          `
        : html`
            <input
              type="email"
              autocomplete="email"
              inputmode="email"
              .value=${props.profile?.email ?? props.emailFallback ?? ""}
              ?disabled=${props.emailManagedByCloud}
              @change=${(event: Event) => handleFieldChange(props, "email", event)}
            />
          `}
      ${props.emailManagedByCloud && props.labels.emailManagedByCloud
        ? html`<small class="field-note">${props.labels.emailManagedByCloud}</small>`
        : null}
    </label>
    <label class="field">
      <span>${props.labels.avatarLabel}</span>
      ${props.mode === "live"
        ? html`
            <input
              type="text"
              maxlength="2"
              autocomplete="off"
              .value=${props.profile?.avatarLabel ?? ""}
              @input=${(event: Event) => handleFieldChange(props, "avatarLabel", event)}
            />
          `
        : html`
            <input
              type="text"
              maxlength="2"
              autocomplete="off"
              .value=${props.profile?.avatarLabel ?? ""}
              @change=${(event: Event) => handleFieldChange(props, "avatarLabel", event)}
            />
          `}
    </label>
  `;
}
