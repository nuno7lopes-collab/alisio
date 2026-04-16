import { html, nothing } from "lit";
import { commandPrefixPattern, docsUrl } from "../../brand-compat.ts";
import { t } from "../../i18n/index.ts";
import {
  isChannelBusyKey,
  isLegacyWhatsAppInlineLinkStep,
  normalizeChannelAccountId,
} from "../channels-shared.ts";
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
  type ResolvedChannelRow,
} from "./channel-display.ts";
import { connectorBrandStyle, getChannelBranding } from "./connector-branding.ts";
import {
  renderSkeletonButton,
  renderSkeletonLines,
  renderSkeletonListItem,
  renderSkeletonPill,
  renderSurfaceEmptyState,
} from "./loading-skeleton.ts";

type WizardAnswer = {
  stepId: string;
  value?: unknown;
};

type ChannelsProps = {
  connected: boolean;
  connectionError?: string | null;
  loading: boolean;
  error: string | null;
  snapshot: ChannelsStatusSnapshot | null;
  lastSuccess: number | null;
  busyKey: string | null;
  actionMessage: string | null;
  loginQrDataUrl: string | null;
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
  onApproveChannelPairing: (channelId: string, accountId: string, requestId: string) => void;
  onRejectChannelPairing: (channelId: string, accountId: string, requestId: string) => void;
  onOpenSupportUrl: (url: string) => void;
};

type ChannelVisualStatus = {
  key:
    | "connected"
    | "attention"
    | "linked"
    | "ready"
    | "notConfigured"
    | "waitingForFirstDm"
    | "pendingApproval";
  label: string;
  className: string;
};

type ChannelRequirements = {
  title: string;
  items: string[];
};

type ChannelActionButton = {
  label: string;
  action: () => void;
  busy: boolean;
  emphasis: "primary" | "secondary";
};

type WhatsAppLinkState = {
  showQr: boolean;
  qrDataUrl: string | null;
  linkAction: ChannelActionButton;
  waitBusy: boolean;
};

const CHANNEL_REQUIREMENT_KEYS: Partial<Record<string, readonly string[]>> = {
  telegram: ["steps.telegram.0", "steps.telegram.1", "steps.telegram.2", "steps.telegram.3"],
  discord: ["steps.discord.0", "steps.discord.1", "steps.discord.2", "steps.discord.3"],
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
  return docsUrl(raw);
}

function resolveLocalizedChannelDescription(row: ResolvedChannelRow): string | null {
  const localized = channelText(`descriptions.${row.id}`);
  return localized !== `alisio.channels.descriptions.${row.id}` ? localized : null;
}

function resolveChannelIcon(row: ResolvedChannelRow) {
  switch (row.id) {
    case "telegram":
      return icons.telegramBrand;
    case "discord":
      return icons.discordBrand;
    case "whatsapp":
      return icons.whatsappBrand;
    default:
      return icons.link;
  }
}

function renderChannelIcon(row: ResolvedChannelRow) {
  const branding = getChannelBranding(row.id);
  if (branding) {
    return html`<span
      class="channel-card__icon channel-card__icon--brand channel-card__icon--${row.id}"
      style=${connectorBrandStyle(branding)}
      aria-hidden="true"
    >
      <img src=${branding.logoUrl} alt="" loading="lazy" decoding="async" />
    </span>`;
  }
  return html`<span class="channel-card__icon channel-card__icon--${row.id}" aria-hidden="true"
    >${resolveChannelIcon(row)}</span
  >`;
}

function renderMetaLine(items: Array<string | null | undefined>, className = "channel-meta-line") {
  const visibleItems = [...new Set(items.map((item) => item?.trim()).filter(Boolean))];
  if (visibleItems.length === 0) {
    return nothing;
  }
  return html`
    <div class=${className}>
      ${visibleItems.map(
        (item, index) => html`
          ${index > 0
            ? html`<span class="channel-meta-line__separator" aria-hidden="true"></span>`
            : nothing}
          <span class="channel-meta-line__item">${item}</span>
        `,
      )}
    </div>
  `;
}

function renderChannelToolbarSkeleton() {
  return html`
    <section class="channel-toolbar" aria-hidden="true">
      <div class="channel-toolbar__meta">${renderSkeletonLines(["short"], { compact: true })}</div>
      ${renderSkeletonButton({ small: true })}
    </section>
  `;
}

function renderChannelCardSkeleton() {
  return html`
    <article class="channel-card" aria-hidden="true">
      <div class="channel-card__header">
        <div class="channel-card__identity">
          <span class="channel-card__icon skeleton"></span>
          <div class="channel-card__title-wrap">
            ${renderSkeletonLines(["medium", "long"], { compact: true })}
          </div>
        </div>
        ${renderSkeletonPill({ small: true })}
      </div>
      <div class="channel-card__description">
        ${renderSkeletonLines(["full", "medium"], { compact: true })}
      </div>
      <div class="channel-card__accounts">
        ${Array.from({ length: 2 }, (_, index) => {
          const aside =
            index === 0
              ? renderSkeletonPill({ small: true })
              : renderSkeletonButton({ small: true });
          return html`
            <div class="channel-account">
              <div class="channel-account__head">
                <div class="channel-account__title-wrap">
                  ${renderSkeletonLines(index === 0 ? ["medium", "short"] : ["short", "medium"], {
                    compact: true,
                  })}
                </div>
                ${aside}
              </div>
              <div class="row channel-account__actions">
                ${renderSkeletonButton({ small: true })} ${renderSkeletonButton({ small: true })}
              </div>
            </div>
          `;
        })}
      </div>
      <div class="row channel-card__footer">
        ${renderSkeletonButton({ small: true })} ${renderSkeletonButton({ small: true })}
      </div>
    </article>
  `;
}

function renderSetupPanelSkeleton(selectedRow: ResolvedChannelRow | null) {
  return html`
    <section
      class="card channel-setup-panel"
      role="status"
      aria-label=${channelText("setupLoading")}
    >
      <div class="channel-setup-panel__header">
        ${selectedRow
          ? html`<span class="channel-card__icon skeleton"></span>`
          : html`<div class="skeleton loading-state__icon-square"></div>`}
        <div class="channel-setup-panel__header-copy">
          ${renderSkeletonLines(["short", "medium"], { compact: true })}
        </div>
      </div>
      <div class="channel-setup-panel__body">
        <aside class="channel-setup-panel__guide">
          <div class="loading-state__list">
            ${renderSkeletonListItem({ lines: ["long"], compact: true })}
            ${renderSkeletonListItem({ lines: ["medium"], compact: true })}
            ${renderSkeletonListItem({ lines: ["long"], compact: true })}
          </div>
        </aside>
        <div class="channel-setup-panel__stage">
          ${renderSkeletonLines(["medium", "long", "full"], { compact: true })}
          <div class="row channel-setup-panel__actions">
            ${renderSkeletonButton({ small: true })} ${renderSkeletonButton({ small: true })}
          </div>
        </div>
      </div>
    </section>
  `;
}

function resolveAccountTitle(row: ResolvedChannelRow, account: ChannelAccountSnapshot) {
  const identifier = resolveAccountIdentifier(row, account);
  const accountLabel =
    account.name?.trim() ||
    (account.accountId.trim() === "default" ? channelText("noAccount") : account.accountId.trim());
  if (row.accounts.length === 1 && identifier) {
    return {
      title: identifier,
      metaItems: [
        accountLabel !== channelText("noAccount") && accountLabel !== identifier
          ? accountLabel
          : null,
      ],
    };
  }
  return {
    title: accountLabel,
    metaItems: [identifier],
  };
}

function shouldRenderAccountStatus(
  row: ResolvedChannelRow,
  channelStatus: ChannelVisualStatus,
  accountStatus: ChannelVisualStatus,
) {
  return row.accounts.length > 1 || channelStatus.key !== accountStatus.key;
}

function resolveVisualStatus(flags: ReturnType<typeof resolveChannelFlags>): ChannelVisualStatus {
  if (flags.dmOnboardingState === "pending_approval") {
    return {
      key: "pendingApproval",
      label: channelText("status.pendingApproval"),
      className: "chip chip-warn",
    };
  }
  if (flags.dmOnboardingState === "waiting_for_first_dm") {
    return {
      key: "waitingForFirstDm",
      label: channelText("status.waitingForFirstDm"),
      className: "chip chip-active",
    };
  }
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
  const onboardingOnlyIssues = row.issues.every((issue) => issue.kind === "intent");
  const flags = resolveChannelFlags(row);
  if (flags.dmOnboardingState && onboardingOnlyIssues) {
    return resolveVisualStatus({ ...flags, attention: false });
  }
  return resolveVisualStatus(flags);
}

function resolveAccountStatus(
  row: ResolvedChannelRow,
  account: ChannelAccountSnapshot,
): ChannelVisualStatus {
  const accountIssues = resolveChannelIssues(row, account.accountId);
  const onboardingOnlyIssues = accountIssues.every((issue) => issue.kind === "intent");
  const flags = resolveAccountFlags(row, account);
  if (flags.dmOnboardingState && onboardingOnlyIssues) {
    return resolveVisualStatus({ ...flags, attention: false });
  }
  return resolveVisualStatus(flags);
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

function shouldPreferInlineWhatsAppLinkAction(row: ResolvedChannelRow, props: ChannelsProps) {
  if (row.id !== "whatsapp") {
    return false;
  }
  return row.accounts.some((account) => {
    const action = resolveWhatsAppLinkState(row, account, props);
    if (!action) {
      return false;
    }
    return !resolveAccountFlags(row, account).linked;
  });
}

function resolveSetupAction(
  row: ResolvedChannelRow,
  props: ChannelsProps,
): ChannelActionButton | null {
  const flags = resolveChannelFlags(row);
  const isSetupBusy =
    props.setupLoading ||
    props.setupSubmitting ||
    props.setupSessionId !== null ||
    props.setupStep !== null;

  if (!flags.setupAvailable) {
    return null;
  }
  if (shouldPreferInlineWhatsAppLinkAction(row, props)) {
    return null;
  }

  const hasConfiguredAccount = row.accounts.some(
    (account) => account.configured === true || account.linked === true,
  );
  const isNativeQrChannel = flags.linkMode === "qr";
  if (isNativeQrChannel && hasConfiguredAccount && !flags.setupOnly) {
    return {
      label: channelText("editChannelAction"),
      action: () => {
        props.onStartChannelSetup(row.id);
      },
      busy: isSetupBusy,
      emphasis: "secondary",
    };
  }

  return {
    label: flags.setupOnly
      ? flags.configured || flags.attention
        ? channelText("fixSetup")
        : channelText("finishSetup")
      : flags.dmOnboardingState
        ? channelText("finishSetup")
        : flags.configured || flags.attention
          ? channelText("configureAction")
          : channelText("connectAction"),
    action: () => {
      props.onStartChannelSetup(row.id);
    },
    busy: isSetupBusy,
    emphasis: "primary",
  };
}

function resolveTelegramDmOnboardingCopy(
  account: ChannelAccountSnapshot,
  flags: ReturnType<typeof resolveAccountFlags>,
) {
  if (flags.dmOnboardingState === "waiting_for_first_dm") {
    return channelText("dmOnboarding.waitingForFirstDm");
  }
  if (flags.dmOnboardingState === "pending_approval") {
    const count = account.pendingPairingRequests ?? flags.pendingPairingRequests ?? 0;
    return count === 1
      ? channelText("dmOnboarding.pendingApprovalOne")
      : channelText("dmOnboarding.pendingApprovalMany", { count: String(count) });
  }
  return null;
}

function resolveWhatsAppLinkState(
  row: ResolvedChannelRow,
  account: ChannelAccountSnapshot,
  props: ChannelsProps,
): WhatsAppLinkState | null {
  if (row.id !== "whatsapp") {
    return null;
  }
  const flags = resolveAccountFlags(row, account);
  if (!flags.configured && !flags.linked) {
    return null;
  }
  return {
    showQr:
      Boolean(props.loginQrDataUrl) &&
      normalizeChannelAccountId(props.loginAccountId) ===
        normalizeChannelAccountId(account.accountId),
    qrDataUrl: props.loginQrDataUrl,
    linkAction: {
      label: flags.linked ? channelText("relink") : channelText("showQr"),
      action: () => {
        props.onStartWhatsAppLink(flags.linked, account.accountId);
      },
      busy:
        isChannelBusyKey(props.busyKey, {
          channelId: "whatsapp",
          action: "login-start",
          accountId: account.accountId,
        }) ||
        isChannelBusyKey(props.busyKey, {
          channelId: "whatsapp",
          action: "login-wait",
          accountId: account.accountId,
        }),
      emphasis: "primary",
    },
    waitBusy: isChannelBusyKey(props.busyKey, {
      channelId: "whatsapp",
      action: "login-wait",
      accountId: account.accountId,
    }),
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
  return commandPrefixPattern.test(line.trim());
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
  if (props.setupLoading && !step && !props.setupError) {
    return renderSetupPanelSkeleton(selectedRow);
  }
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

function resolveUiIssueFix(row: ResolvedChannelRow, issue: ChannelStatusIssue): string | null {
  const fix = issue.fix?.trim() || null;
  if (row.id === "whatsapp" && issue.kind === "auth") {
    const message = issue.message.trim();
    if (/not linked|logged out/i.test(message)) {
      const localized = channelText("issueFixes.whatsappLink");
      return localized !== "alisio.channels.issueFixes.whatsappLink" ? localized : fix;
    }
  }
  return fix;
}

function renderIssueList(row: ResolvedChannelRow, issues: ChannelStatusIssue[]) {
  if (issues.length === 0) {
    return nothing;
  }
  return html`
    <div class="channel-issue-list">
      ${issues.map((issue) => {
        const fix = resolveUiIssueFix(row, issue);
        return html`
          <div class="channel-issue">
            <div class="channel-issue__message">${issue.message}</div>
            ${fix ? html`<div class="channel-issue__fix">${fix}</div>` : nothing}
          </div>
        `;
      })}
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

function renderWhatsAppQr(linkState: WhatsAppLinkState, accountId: string, props: ChannelsProps) {
  if (!linkState.showQr || !linkState.qrDataUrl) {
    return nothing;
  }
  return html`
    <div class="qr-wrap channel-qr">
      <img src=${linkState.qrDataUrl} alt="WhatsApp QR" />
    </div>
    <div class="card-sub channel-qr__help">${channelText("qrHelp")}</div>
    <div class="row channel-qr__actions">
      <button
        class="btn btn--sm"
        ?disabled=${linkState.waitBusy}
        @click=${() => {
          props.onWaitWhatsAppLink(accountId);
        }}
      >
        ${linkState.waitBusy ? channelText("checkingLink") : channelText("checkLink")}
      </button>
    </div>
  `;
}

function renderPendingPairingRequests(
  row: ResolvedChannelRow,
  account: ChannelAccountSnapshot,
  props: ChannelsProps,
) {
  const pendingRequests = Array.isArray(account.pendingPairing) ? account.pendingPairing : [];
  if (row.id !== "telegram" || pendingRequests.length === 0) {
    return nothing;
  }
  const approveBusy = isChannelBusyKey(props.busyKey, {
    channelId: row.id,
    action: "pairing-approve",
    accountId: account.accountId,
  });
  const rejectBusy = isChannelBusyKey(props.busyKey, {
    channelId: row.id,
    action: "pairing-reject",
    accountId: account.accountId,
  });
  return html`
    <div class="channel-pending-pairing">
      <div class="channel-pending-pairing__label">${channelText("pairing.pendingLabel")}</div>
      ${pendingRequests.map(
        (request) => html`
          <div class="channel-pending-pairing__item">
            <div class="channel-pending-pairing__copy">
              <div class="channel-pending-pairing__title">${request.label}</div>
              ${request.detail
                ? html`<div class="channel-pending-pairing__detail">${request.detail}</div>`
                : nothing}
            </div>
            <div class="row channel-pending-pairing__actions">
              <button
                class="btn btn--sm primary"
                ?disabled=${approveBusy || rejectBusy}
                @click=${() => {
                  props.onApproveChannelPairing(row.id, account.accountId, request.requestId);
                }}
              >
                ${channelText("pairing.approve")}
              </button>
              <button
                class="btn btn--sm danger"
                ?disabled=${approveBusy || rejectBusy}
                @click=${() => {
                  props.onRejectChannelPairing(row.id, account.accountId, request.requestId);
                }}
              >
                ${channelText("pairing.reject")}
              </button>
            </div>
          </div>
        `,
      )}
    </div>
  `;
}

function renderAccountBlock(
  row: ResolvedChannelRow,
  account: ChannelAccountSnapshot,
  props: ChannelsProps,
  channelStatus: ChannelVisualStatus,
) {
  const status = resolveAccountStatus(row, account);
  const lastActivity = formatLastActivity(account);
  const flags = resolveAccountFlags(row, account);
  const issues = resolveChannelIssues(row, account.accountId).filter(
    (issue) => !(row.id === "telegram" && flags.dmOnboardingState && issue.kind === "intent"),
  );
  const whatsappLinkState = resolveWhatsAppLinkState(row, account, props);
  const canLogout =
    flags.logoutAvailable && (flags.linked || flags.connected) && Boolean(account.accountId);
  const dmOnboardingCopy = resolveTelegramDmOnboardingCopy(account, flags);
  const accountHeading = resolveAccountTitle(row, account);
  const accountMeta = [
    ...accountHeading.metaItems,
    lastActivity ? `${channelText("lastActivity")}: ${lastActivity}` : null,
  ];

  return html`
    <section class="channel-account">
      <div class="channel-account__head">
        <div class="channel-account__title-wrap">
          <div class="channel-account__title">${accountHeading.title}</div>
          ${renderMetaLine(accountMeta, "channel-meta-line channel-account__meta")}
        </div>
        ${shouldRenderAccountStatus(row, channelStatus, status)
          ? html`<span class=${status.className}>${status.label}</span>`
          : nothing}
      </div>

      ${dmOnboardingCopy
        ? html`<div class="card-sub channel-account__note">${dmOnboardingCopy}</div>`
        : nothing}
      ${renderPendingPairingRequests(row, account, props)} ${renderIssueList(row, issues)}
      ${whatsappLinkState ? renderWhatsAppQr(whatsappLinkState, account.accountId, props) : nothing}
      ${whatsappLinkState || canLogout
        ? html`
            <div class="row channel-account__actions">
              ${whatsappLinkState
                ? html`
                    <button
                      class="btn btn--sm primary"
                      ?disabled=${whatsappLinkState.linkAction.busy}
                      @click=${whatsappLinkState.linkAction.action}
                    >
                      ${whatsappLinkState.linkAction.label}
                    </button>
                  `
                : nothing}
              ${canLogout
                ? html`
                    <button
                      class="btn btn--sm danger"
                      ?disabled=${isChannelBusyKey(props.busyKey, {
                        channelId: row.id,
                        action: "logout",
                        accountId: account.accountId,
                      })}
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
  const requirements = resolveChannelRequirements(row);
  const description =
    resolveLocalizedChannelDescription(row) ??
    row.meta.blurb?.trim() ??
    row.meta.detailLabel ??
    channelText("noDetails");
  const showCompactRequirements =
    requirements && props.setupChannelId !== row.id && (!flags.connected || row.issues.length > 0);
  const emptyMetaLine =
    row.accounts.length === 0
      ? [
          resolveChannelIdentifier(row),
          formatChannelLastActivity(row)
            ? `${channelText("lastActivity")}: ${formatChannelLastActivity(row)}`
            : null,
        ]
      : [];

  return html`
    <article class="card channel-card channel-card--${row.id}">
      <div class="channel-card__header">
        <div class="channel-card__identity">
          ${renderChannelIcon(row)}
          <div class="channel-card__title-wrap">
            <div class="card-title">${row.meta.label}</div>
          </div>
        </div>
        <span class=${status.className}>${status.label}</span>
      </div>
      <div class="card-sub channel-card__description">${description}</div>
      ${renderMetaLine(emptyMetaLine, "channel-meta-line channel-card__meta")}
      ${showCompactRequirements ? renderChannelSteps(requirements, { compact: true }) : nothing}

      <div class="channel-card__accounts">
        ${row.accounts.map((account) => renderAccountBlock(row, account, props, status))}
      </div>

      <div class="row channel-card__footer">
        ${setupAction
          ? html`
              <button
                class="btn btn--sm ${setupAction.emphasis === "primary" ? "primary" : ""}"
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
  const showInitialLoading = props.loading && !props.snapshot;
  const lastChecked = formatTimestamp(props.lastSuccess ?? props.snapshot?.ts ?? null);
  const hasVisibleWhatsAppQr = Boolean(props.loginQrDataUrl);
  const shouldShowActionMessage = Boolean(props.actionMessage) && !hasVisibleWhatsAppQr;
  const errorMessages = [...new Set([props.connectionError, props.error].filter(Boolean))];
  const showDisconnectedState =
    !showInitialLoading && !props.connected && errorMessages.length === 0;

  return html`
    <section class="alisio-page">
      ${showInitialLoading
        ? renderChannelToolbarSkeleton()
        : html`
            <section class="channel-toolbar">
              <div class="channel-toolbar__meta">
                ${lastChecked
                  ? html`
                      <div class="channel-toolbar__timestamp">
                        ${channelText("lastChecked")}: ${lastChecked}
                      </div>
                    `
                  : nothing}
              </div>
              <button class="btn btn--sm" ?disabled=${props.loading} @click=${props.onRefresh}>
                ${props.loading ? channelText("refreshing") : channelText("refresh")}
              </button>
            </section>
          `}
      ${shouldShowActionMessage || errorMessages.length > 0
        ? html`
            <div class="channel-feedback-stack">
              ${shouldShowActionMessage
                ? html`
                    <div class="channel-feedback channel-feedback--ok">${props.actionMessage}</div>
                  `
                : nothing}
              ${errorMessages.map(
                (message) =>
                  html`<div class="channel-feedback channel-feedback--danger">${message}</div>`,
              )}
            </div>
          `
        : nothing}
      ${showDisconnectedState
        ? html`
            <section class="card">
              ${renderSurfaceEmptyState({
                body: channelText("disconnected"),
                compact: true,
              })}
            </section>
          `
        : nothing}
      ${renderSetupPanel(props, rows)}
      ${showInitialLoading
        ? html`
            <section class="channels-grid" role="status" aria-label=${channelText("refreshing")}>
              ${renderChannelCardSkeleton()} ${renderChannelCardSkeleton()}
              ${renderChannelCardSkeleton()}
            </section>
          `
        : rows.length > 0
          ? html`
              <section class="channels-grid">
                ${rows.map((row) => renderChannelCard(row, props))}
              </section>
            `
          : html`
              <section class="card">
                ${renderSurfaceEmptyState({
                  body: channelText("empty"),
                  compact: true,
                })}
              </section>
            `}
    </section>
  `;
}
