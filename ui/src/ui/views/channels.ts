import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { icons } from "../icons.ts";
import type {
  ChannelAccountSnapshot,
  ChannelStatusIssue,
  ChannelsStatusSnapshot,
  WizardStep,
} from "../types.ts";
import {
  formatChannelLastActivity,
  formatLastActivity,
  formatTimestamp,
  resolveAccountFlags,
  resolveAccountIdentifier,
  resolveChannelFlags,
  resolveChannelIdentifier,
  resolveChannelIssues,
  resolveChannelRows,
  summarizeChannelsSnapshot,
  type ResolvedChannelRow,
} from "./channel-display.ts";

type WizardAnswer = {
  stepId: string;
  value?: unknown;
};

type ChannelsProps = {
  connected: boolean;
  loading: boolean;
  error: string | null;
  snapshot: ChannelsStatusSnapshot | null;
  lastSuccess: number | null;
  busyKey: string | null;
  actionMessage: string | null;
  loginQrDataUrl: string | null;
  loginConnected: boolean | null;
  loginAccountId: string | null;
  setupLoading: boolean;
  setupSubmitting: boolean;
  setupSessionId: string | null;
  setupStep: WizardStep | null;
  setupStatus: string | null;
  setupError: string | null;
  setupDraftText: string;
  setupDraftConfirm: boolean;
  setupDraftSelectIndex: number;
  setupDraftMultiIndexes: number[];
  setupChannelId: string | null;
  onRefresh: () => void;
  onStartChannelSetup: (channelId: string) => void;
  onContinueSetup: (answer?: WizardAnswer) => void;
  onCancelSetup: () => void;
  onSetupDraftTextChange: (value: string) => void;
  onSetupDraftConfirmChange: (value: boolean) => void;
  onSetupDraftSelectIndexChange: (value: number) => void;
  onSetupDraftMultiIndexesChange: (value: number[]) => void;
  onStartWhatsAppLink: (force: boolean, accountId?: string) => void;
  onWaitWhatsAppLink: (accountId?: string) => void;
  onLogoutChannel: (channelId: string, accountId?: string) => void;
  onOpenSupportUrl: (url: string) => void;
};

type ChannelVisualStatus = {
  key: "connected" | "attention" | "linked" | "ready" | "notConfigured";
  label: string;
  className: string;
};

type ChannelRequirements = {
  title: string;
  items: string[];
};

const CHANNEL_REQUIREMENT_KEYS: Partial<Record<string, readonly string[]>> = {
  telegram: ["steps.telegram.0", "steps.telegram.1", "steps.telegram.2"],
  discord: ["steps.discord.0", "steps.discord.1", "steps.discord.2"],
  whatsapp: ["steps.whatsapp.0", "steps.whatsapp.1", "steps.whatsapp.2"],
};

function channelText(key: string, params?: Record<string, string>) {
  return t(`alisio.channels.${key}`, params);
}

function buildChannelDocsUrl(docsPath?: string): string | null {
  const raw = docsPath?.trim();
  if (!raw) {
    return null;
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  return `https://docs.openclaw.ai${raw.startsWith("/") ? raw : `/${raw}`}`;
}

function resolveLocalizedChannelDescription(row: ResolvedChannelRow): string | null {
  const localized = channelText(`descriptions.${row.id}`);
  return localized !== `alisio.channels.descriptions.${row.id}` ? localized : null;
}

function isLegacyWhatsAppInlineLinkStep(
  channelId: string | null | undefined,
  step: WizardStep | null | undefined,
) {
  if (channelId?.trim() !== "whatsapp" || step?.type !== "confirm") {
    return false;
  }
  return /\b(?:re-)?link whatsapp now\b/i.test(step.message?.trim() ?? "");
}

function resolveChannelIcon(row: ResolvedChannelRow) {
  switch (row.id) {
    case "telegram":
      return icons.paperPlane;
    case "discord":
      return icons.chatBubbles;
    case "whatsapp":
      return icons.messageSquare;
    default:
      return icons.link;
  }
}

function renderChannelIcon(row: ResolvedChannelRow) {
  return html`<span class="channel-card__icon" aria-hidden="true"
    >${resolveChannelIcon(row)}</span
  >`;
}

function resolveVisualStatus(flags: ReturnType<typeof resolveChannelFlags>): ChannelVisualStatus {
  if (flags.attention) {
    return {
      key: "attention",
      label: channelText("status.attention"),
      className: "chip chip-warn",
    };
  }
  if (flags.connected) {
    return {
      key: "connected",
      label: channelText("status.connected"),
      className: "chip chip-ok",
    };
  }
  if (flags.linked) {
    return {
      key: "linked",
      label: channelText("status.linked"),
      className: "chip chip-active",
    };
  }
  if (flags.configured) {
    return {
      key: "ready",
      label: channelText("status.ready"),
      className: "chip",
    };
  }
  return {
    key: "notConfigured",
    label: channelText("status.notConfigured"),
    className: "chip",
  };
}

function resolveChannelStatus(row: ResolvedChannelRow): ChannelVisualStatus {
  return resolveVisualStatus(resolveChannelFlags(row));
}

function resolveAccountStatus(
  row: ResolvedChannelRow,
  account: ChannelAccountSnapshot,
): ChannelVisualStatus {
  return resolveVisualStatus(resolveAccountFlags(row, account));
}

function resolveChannelRequirements(row: ResolvedChannelRow): ChannelRequirements | null {
  const keys = CHANNEL_REQUIREMENT_KEYS[row.id];
  if (!keys) {
    return null;
  }
  return {
    title: channelText("stepsTitle"),
    items: keys.map((key) => channelText(key)),
  };
}

function resolveSetupAction(
  row: ResolvedChannelRow,
  props: ChannelsProps,
): { label: string; action: () => void; busy: boolean } | null {
  const flags = resolveChannelFlags(row);
  const isSetupBusy =
    props.setupLoading ||
    props.setupSubmitting ||
    props.setupSessionId !== null ||
    props.setupStep !== null;

  if (!flags.setupAvailable) {
    return null;
  }

  return {
    label: flags.setupOnly
      ? flags.configured || flags.attention
        ? channelText("fixSetup")
        : channelText("finishSetup")
      : flags.configured || flags.attention
        ? channelText("configureAction")
        : channelText("connectAction"),
    action: () => {
      props.onStartChannelSetup(row.id);
    },
    busy: isSetupBusy,
  };
}

function resolveWhatsAppAccountAction(
  row: ResolvedChannelRow,
  account: ChannelAccountSnapshot,
  props: ChannelsProps,
): { label: string; action: () => void; busy: boolean } | null {
  if (row.id !== "whatsapp") {
    return null;
  }
  const flags = resolveAccountFlags(row, account);
  if (!flags.configured && !flags.linked) {
    return null;
  }
  const busy =
    (props.busyKey === "whatsapp:start" || props.busyKey === "whatsapp:wait") &&
    (props.loginAccountId ?? row.defaultAccountId ?? "default") === account.accountId;
  return {
    label: flags.linked ? channelText("relink") : channelText("showQr"),
    action: () => {
      props.onStartWhatsAppLink(flags.linked, account.accountId);
    },
    busy,
  };
}

function buildWizardAnswer(props: ChannelsProps): WizardAnswer | undefined {
  const step = props.setupStep;
  if (!step) {
    return undefined;
  }
  if (isLegacyWhatsAppInlineLinkStep(props.setupChannelId, step)) {
    return {
      stepId: step.id,
      value: false,
    };
  }
  if (step.type === "text") {
    return {
      stepId: step.id,
      value: props.setupDraftText,
    };
  }
  if (step.type === "confirm") {
    return {
      stepId: step.id,
      value: props.setupDraftConfirm,
    };
  }
  if (step.type === "select") {
    const options = Array.isArray(step.options) ? step.options : [];
    const selected = options[props.setupDraftSelectIndex];
    return selected
      ? {
          stepId: step.id,
          value: selected.value,
        }
      : undefined;
  }
  if (step.type === "multiselect") {
    const options = Array.isArray(step.options) ? step.options : [];
    return {
      stepId: step.id,
      value: props.setupDraftMultiIndexes
        .map((index) => options[index]?.value)
        .filter((value) => value !== undefined),
    };
  }
  return { stepId: step.id };
}

function resolveSetupContinueLabel(
  step: WizardStep | null,
  submitting: boolean,
  opts?: { hasError?: boolean },
) {
  if (submitting) {
    return channelText("setupSubmitting");
  }
  if (!step && opts?.hasError) {
    return channelText("setupResume");
  }
  if (!step) {
    return channelText("setupContinue");
  }
  if (step.type === "note" || step.type === "progress" || step.type === "action") {
    return channelText("setupAcknowledge");
  }
  if (step.type === "confirm") {
    return channelText("setupSaveContinue");
  }
  if (step.type === "text" || step.type === "select" || step.type === "multiselect") {
    return channelText("setupSaveContinue");
  }
  return channelText("setupContinue");
}

function isSetupCommandLine(line: string) {
  return /^(alisio|openclaw)\s+/i.test(line.trim());
}

function readSetupDocsUrl(line: string) {
  const match = line.trim().match(/^Docs?:\s+(https?:\/\/\S+)$/i);
  return match?.[1]?.trim() || null;
}

function renderSetupNoteMessage(message: string) {
  const lines = message
    .split(/\r?\n/g)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  const visibleLines = lines.length > 0 ? lines : [channelText("setupWaiting")];
  return html`
    <div class="channel-setup-note">
      ${visibleLines.map((line) => {
        const trimmed = line.trim();
        const docsUrl = readSetupDocsUrl(trimmed);
        if (docsUrl) {
          return html`
            <a class="channel-setup-note__link" href=${docsUrl} target="_blank" rel="noreferrer">
              ${docsUrl}
            </a>
          `;
        }
        if (isSetupCommandLine(trimmed)) {
          return html`<code class="channel-setup-note__code">${trimmed}</code>`;
        }
        return html`<div class="channel-setup-note__line">${trimmed}</div>`;
      })}
    </div>
  `;
}

function renderSetupOption(params: {
  type: "radio" | "checkbox";
  checked: boolean;
  title: string;
  hint?: string;
  name?: string;
  onChange: (checked: boolean) => void;
}) {
  const classes = [
    "channel-setup-option",
    params.checked ? "channel-setup-option--selected" : "",
    params.type === "checkbox" ? "channel-setup-option--checkbox" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return html`
    <label class=${classes}>
      <input
        class="channel-setup-option__input"
        type=${params.type}
        name=${params.name ?? ""}
        .checked=${params.checked}
        @change=${(event: Event) => {
          params.onChange((event.target as HTMLInputElement).checked);
        }}
      />
      <span class="channel-setup-option__marker" aria-hidden="true">
        ${params.type === "radio" && params.checked
          ? html`<span class="channel-setup-option__marker-dot"></span>`
          : nothing}
      </span>
      <span class="channel-setup-option__content">
        <span class="channel-setup-option__title">${params.title}</span>
        ${params.hint
          ? html`<span class="channel-setup-option__hint">${params.hint}</span>`
          : nothing}
      </span>
    </label>
  `;
}

function renderWizardStep(step: WizardStep, props: ChannelsProps) {
  if (isLegacyWhatsAppInlineLinkStep(props.setupChannelId, step)) {
    return renderSetupNoteMessage(channelText("setupWhatsappQrHandledInChannels"));
  }
  const message = step.message?.trim() || "";
  if (step.type === "text") {
    return html`
      <label class="channel-setup-field">
        ${message ? html`<span class="channel-setup-field__label">${message}</span>` : nothing}
        <input
          class="input channel-setup-field__input"
          .value=${props.setupDraftText}
          type=${step.sensitive ? "password" : "text"}
          placeholder=${step.placeholder ?? ""}
          @input=${(event: Event) => {
            props.onSetupDraftTextChange((event.target as HTMLInputElement).value);
          }}
        />
        ${step.sensitive
          ? html`<div class="channel-setup-field__hint">${channelText("setupSensitiveHint")}</div>`
          : nothing}
      </label>
    `;
  }
  if (step.type === "confirm") {
    return html`
      <div class="channel-setup-options">
        ${renderSetupOption({
          type: "checkbox",
          checked: props.setupDraftConfirm,
          title: message,
          onChange: (checked) => {
            props.onSetupDraftConfirmChange(checked);
          },
        })}
      </div>
    `;
  }
  if (step.type === "select" && Array.isArray(step.options)) {
    return html`
      <div class="channel-setup-stage">
        ${message ? html`<div class="channel-setup-stage__description">${message}</div>` : nothing}
        <div class="channel-setup-options">
          ${step.options.map(
            (option, index) => html`
              ${renderSetupOption({
                type: "radio",
                checked: props.setupDraftSelectIndex === index,
                title: option.label,
                hint: option.hint,
                name: "channel-setup-select",
                onChange: () => {
                  props.onSetupDraftSelectIndexChange(index);
                },
              })}
            `,
          )}
        </div>
      </div>
    `;
  }
  if (step.type === "multiselect" && Array.isArray(step.options)) {
    return html`
      <div class="channel-setup-stage">
        ${message ? html`<div class="channel-setup-stage__description">${message}</div>` : nothing}
        <div class="channel-setup-options">
          ${step.options.map(
            (option, index) => html`
              ${renderSetupOption({
                type: "checkbox",
                checked: props.setupDraftMultiIndexes.includes(index),
                title: option.label,
                hint: option.hint,
                onChange: (checked) => {
                  const next = checked
                    ? [...new Set([...props.setupDraftMultiIndexes, index])]
                    : props.setupDraftMultiIndexes.filter((entry) => entry !== index);
                  props.onSetupDraftMultiIndexesChange(next);
                },
              })}
            `,
          )}
        </div>
      </div>
    `;
  }
  return renderSetupNoteMessage(message || channelText("setupWaiting"));
}

function renderSetupPanel(props: ChannelsProps, rows: ResolvedChannelRow[]) {
  const selectedRow = rows.find((entry) => entry.id === props.setupChannelId) ?? null;
  const channelLabel = selectedRow?.meta.label ?? props.setupChannelId ?? channelText("title");
  const shouldShow =
    props.setupLoading ||
    props.setupSessionId !== null ||
    props.setupStep !== null ||
    Boolean(props.setupError);
  if (!shouldShow) {
    return nothing;
  }

  const step = props.setupStep;
  const canContinue = !props.setupLoading;
  const requirements = selectedRow ? resolveChannelRequirements(selectedRow) : null;
  const docsUrl = selectedRow ? buildChannelDocsUrl(selectedRow.meta.docsPath) : null;

  return html`
    <section class="card channel-setup-panel">
      <div class="channel-setup-panel__header">
        ${selectedRow ? renderChannelIcon(selectedRow) : nothing}
        <div class="channel-setup-panel__header-copy">
          <div class="alisio-page__eyebrow">${channelText("setupEyebrow")}</div>
          <div class="card-title">
            ${channelText("setupTitle", { channel: String(channelLabel) })}
          </div>
        </div>
      </div>
      <div class="channel-setup-panel__body">
        ${requirements
          ? html`<aside class="channel-setup-panel__guide">
              ${renderChannelSteps(requirements)}
            </aside>`
          : nothing}
        <div class="channel-setup-panel__stage">
          ${props.setupLoading && !step
            ? html`<div class="card-sub">${channelText("setupLoading")}</div>`
            : nothing}
          ${props.setupError
            ? html`<div class="channel-feedback channel-feedback--danger">${props.setupError}</div>`
            : nothing}
          ${step
            ? html`
                ${step.title?.trim()
                  ? html`<div class="channel-setup-stage__title">${step.title}</div>`
                  : nothing}
                ${renderWizardStep(step, props)}
              `
            : nothing}
          <div class="row channel-setup-panel__actions">
            <button
              class="btn btn--sm primary"
              ?disabled=${!canContinue || props.setupSubmitting}
              @click=${() => {
                props.onContinueSetup(buildWizardAnswer(props));
              }}
            >
              ${resolveSetupContinueLabel(step, props.setupSubmitting, {
                hasError: Boolean(props.setupError),
              })}
            </button>
            ${props.setupSessionId
              ? html`
                  <button
                    class="btn btn--sm"
                    ?disabled=${props.setupSubmitting}
                    @click=${props.onCancelSetup}
                  >
                    ${channelText("setupCancel")}
                  </button>
                `
              : nothing}
            ${docsUrl
              ? html`
                  <button
                    class="btn btn--sm"
                    @click=${() => {
                      props.onOpenSupportUrl(docsUrl);
                    }}
                  >
                    ${channelText("openGuide")}
                  </button>
                `
              : nothing}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderIssueList(issues: ChannelStatusIssue[]) {
  if (issues.length === 0) {
    return nothing;
  }
  return html`
    <div class="channel-issue-list">
      ${issues.map(
        (issue) => html`
          <div class="channel-issue">
            <div class="channel-issue__message">${issue.message}</div>
            ${issue.fix ? html`<div class="channel-issue__fix">${issue.fix}</div>` : nothing}
          </div>
        `,
      )}
    </div>
  `;
}

function renderChannelSteps(requirements: ChannelRequirements, opts?: { compact?: boolean }) {
  const classes = opts?.compact ? "channel-steps channel-steps--compact" : "channel-steps";
  return html`
    <div class="channel-steps-block">
      <div class="channel-steps-label">${requirements.title}</div>
      <div class=${classes}>
        ${requirements.items.map(
          (item, index) => html`
            <div class="channel-step">
              <div class="channel-step__bullet" aria-hidden="true">${index + 1}</div>
              <div class="channel-step__text">${item}</div>
            </div>
          `,
        )}
      </div>
    </div>
  `;
}

function renderWhatsAppQr(accountId: string, props: ChannelsProps) {
  const activeAccountId = props.loginAccountId?.trim() || "default";
  if (!props.loginQrDataUrl || activeAccountId !== accountId) {
    return nothing;
  }
  return html`
    <div class="qr-wrap channel-qr">
      <img src=${props.loginQrDataUrl} alt="WhatsApp QR" />
    </div>
    <div class="card-sub channel-qr__help">${channelText("qrHelp")}</div>
    <div class="row channel-qr__actions">
      <button
        class="btn btn--sm"
        ?disabled=${props.busyKey === "whatsapp:wait"}
        @click=${() => {
          props.onWaitWhatsAppLink(accountId);
        }}
      >
        ${props.busyKey === "whatsapp:wait"
          ? channelText("checkingLink")
          : channelText("checkLink")}
      </button>
    </div>
  `;
}

function renderAccountBlock(
  row: ResolvedChannelRow,
  account: ChannelAccountSnapshot,
  props: ChannelsProps,
) {
  const status = resolveAccountStatus(row, account);
  const issues = resolveChannelIssues(row, account.accountId);
  const identifier = resolveAccountIdentifier(row, account);
  const lastActivity = formatLastActivity(account);
  const flags = resolveAccountFlags(row, account);
  const accountAction = resolveWhatsAppAccountAction(row, account, props);
  const canLogout =
    flags.logoutAvailable && (flags.linked || flags.connected) && Boolean(account.accountId);
  const accountLabel =
    account.name?.trim() ||
    (account.accountId.trim() === "default" ? channelText("noAccount") : account.accountId.trim());

  return html`
    <section class="channel-account">
      <div class="channel-account__head">
        <div class="channel-account__title-wrap">
          <div class="channel-account__eyebrow">${channelText("channelAccount")}</div>
          <div class="channel-account__title">${accountLabel}</div>
        </div>
        <span class=${status.className}>${status.label}</span>
      </div>

      <div class="chip-row">
        ${identifier ? html`<span class="chip">${identifier}</span>` : nothing}
        ${lastActivity
          ? html`<span class="chip">${channelText("lastActivity")}: ${lastActivity}</span>`
          : html`<span class="chip">${channelText("activityNone")}</span>`}
      </div>

      ${renderIssueList(issues)} ${renderWhatsAppQr(account.accountId, props)}
      ${accountAction || canLogout
        ? html`
            <div class="row channel-account__actions">
              ${accountAction
                ? html`
                    <button
                      class="btn btn--sm primary"
                      ?disabled=${accountAction.busy}
                      @click=${accountAction.action}
                    >
                      ${accountAction.label}
                    </button>
                  `
                : nothing}
              ${canLogout
                ? html`
                    <button
                      class="btn btn--sm danger"
                      ?disabled=${props.busyKey === `${row.id}:logout`}
                      @click=${() => {
                        props.onLogoutChannel(row.id, account.accountId);
                      }}
                    >
                      ${channelText("logout")}
                    </button>
                  `
                : nothing}
            </div>
          `
        : nothing}
    </section>
  `;
}

function renderChannelCard(row: ResolvedChannelRow, props: ChannelsProps) {
  const status = resolveChannelStatus(row);
  const docsUrl = buildChannelDocsUrl(row.meta.docsPath);
  const setupAction = resolveSetupAction(row, props);
  const flags = resolveChannelFlags(row);
  const identifier = resolveChannelIdentifier(row);
  const lastActivity = formatChannelLastActivity(row);
  const requirements = resolveChannelRequirements(row);
  const description =
    resolveLocalizedChannelDescription(row) ??
    row.meta.blurb?.trim() ??
    row.meta.detailLabel ??
    channelText("noDetails");
  const showCompactRequirements =
    requirements && props.setupChannelId !== row.id && (!flags.connected || row.issues.length > 0);

  return html`
    <article class="card channel-card">
      <div class="channel-card__header">
        <div class="channel-card__identity">
          ${renderChannelIcon(row)}
          <div class="channel-card__title-wrap">
            <div class="channel-card__eyebrow">${row.meta.detailLabel}</div>
            <div class="card-title">${row.meta.label}</div>
          </div>
        </div>
        <span class=${status.className}>${status.label}</span>
      </div>
      <div class="card-sub channel-card__description">${description}</div>
      ${(identifier || lastActivity) &&
      html`
        <div class="chip-row channel-card__summary">
          ${identifier ? html`<span class="chip">${identifier}</span>` : nothing}
          ${lastActivity
            ? html`<span class="chip">${channelText("lastActivity")}: ${lastActivity}</span>`
            : nothing}
        </div>
      `}
      ${showCompactRequirements ? renderChannelSteps(requirements, { compact: true }) : nothing}

      <div class="channel-card__accounts">
        ${row.accounts.map((account) => renderAccountBlock(row, account, props))}
      </div>

      <div class="row channel-card__footer">
        ${setupAction
          ? html`
              <button
                class="btn btn--sm primary"
                ?disabled=${setupAction.busy}
                @click=${setupAction.action}
              >
                ${setupAction.label}
              </button>
            `
          : nothing}
        ${docsUrl
          ? html`
              <button
                class="btn btn--sm"
                @click=${() => {
                  props.onOpenSupportUrl(docsUrl);
                }}
              >
                ${channelText("openGuide")}
              </button>
            `
          : nothing}
      </div>
    </article>
  `;
}

export function renderChannels(props: ChannelsProps) {
  const rows = resolveChannelRows(props.snapshot);
  const summary = summarizeChannelsSnapshot(props.snapshot);
  const lastChecked = formatTimestamp(props.lastSuccess ?? props.snapshot?.ts ?? null);

  return html`
    <section class="alisio-page">
      <section class="card channel-hero">
        <div class="alisio-page__eyebrow">${channelText("eyebrow")}</div>
        <div class="row channel-hero__top">
          <div>
            <div class="card-title">${channelText("title")}</div>
            <div class="card-sub">${channelText("subtitle")}</div>
          </div>
          <button class="btn btn--sm" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${props.loading ? channelText("refreshing") : channelText("refresh")}
          </button>
        </div>

        <div class="channel-summary-grid">
          <article class="channel-summary-card">
            <div class="channel-summary-card__value">${summary.totalChannels}</div>
            <div class="channel-summary-card__label">${channelText("availableChannels")}</div>
          </article>
          <article class="channel-summary-card">
            <div class="channel-summary-card__value">${summary.connectedChannels}</div>
            <div class="channel-summary-card__label">${channelText("connectedChannels")}</div>
          </article>
          <article class="channel-summary-card">
            <div class="channel-summary-card__value">${summary.attentionChannels}</div>
            <div class="channel-summary-card__label">${channelText("attentionChannels")}</div>
          </article>
          <article class="channel-summary-card">
            <div class="channel-summary-card__value channel-summary-card__value--timestamp">
              ${lastChecked ?? "—"}
            </div>
            <div class="channel-summary-card__label">${channelText("lastChecked")}</div>
          </article>
        </div>

        ${props.actionMessage || props.error
          ? html`
              <div class="channel-feedback-stack">
                ${props.actionMessage
                  ? html`
                      <div class="channel-feedback channel-feedback--ok">
                        ${props.actionMessage}
                      </div>
                    `
                  : nothing}
                ${props.error
                  ? html`
                      <div class="channel-feedback channel-feedback--danger">${props.error}</div>
                    `
                  : nothing}
              </div>
            `
          : nothing}
      </section>

      ${!props.connected
        ? html`
            <section class="card">
              <div class="card-sub">${channelText("disconnected")}</div>
            </section>
          `
        : nothing}
      ${renderSetupPanel(props, rows)}
      ${rows.length > 0
        ? html`
            <section class="channels-grid">
              ${rows.map((row) => renderChannelCard(row, props))}
            </section>
          `
        : html`
            <section class="card">
              <div class="card-sub">${channelText("empty")}</div>
            </section>
          `}

      <section class="card channel-session-card">
        <div class="card-title">${channelText("sessionTitle")}</div>
        <div class="card-sub channel-session-card__description">${channelText("sessionBody")}</div>
        <div class="channel-session-card__grid">
          <div class="channel-session-card__item">
            <span class="channel-session-card__icon" aria-hidden="true">${icons.link}</span>
            <span class="channel-session-card__text">${channelText("sessionDirect")}</span>
          </div>
          <div class="channel-session-card__item">
            <span class="channel-session-card__icon" aria-hidden="true">
              ${icons.messageSquare}
            </span>
            <span class="channel-session-card__text">${channelText("sessionGroups")}</span>
          </div>
        </div>
      </section>
    </section>
  `;
}
