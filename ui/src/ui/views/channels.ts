import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type {
  ChannelAccountSnapshot,
  ChannelStatusIssue,
  ChannelsStatusSnapshot,
  ChannelUiMetaEntry,
  WizardStep,
} from "../types.ts";

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
  onStartWhatsAppLink: (force: boolean) => void;
  onWaitWhatsAppLink: () => void;
  onLogoutChannel: (channelId: string, accountId?: string) => void;
  onOpenSupportUrl: (url: string) => void;
};

type ResolvedChannelRow = {
  id: string;
  meta: ChannelUiMetaEntry;
  summary: Record<string, unknown>;
  issues: ChannelStatusIssue[];
  accounts: ChannelAccountSnapshot[];
  defaultAccountId: string | null;
  defaultAccount: ChannelAccountSnapshot | null;
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

function channelText(key: string, params?: Record<string, string>) {
  return t(`alisio.channels.${key}`, params);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

function formatTimestamp(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatLastActivity(account: ChannelAccountSnapshot | null): string | null {
  if (!account) {
    return null;
  }
  const lastActivity = [account.lastInboundAt, account.lastOutboundAt]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .toSorted((left, right) => right - left)[0];
  return formatTimestamp(lastActivity);
}

function deriveChannelMeta(
  snapshot: ChannelsStatusSnapshot | null,
  channelId: string,
): ChannelUiMetaEntry {
  const label = snapshot?.channelLabels?.[channelId] ?? channelId;
  const detailLabel = snapshot?.channelDetailLabels?.[channelId] ?? channelText("noDetails");
  const systemImage = snapshot?.channelSystemImages?.[channelId];
  return {
    id: channelId,
    label,
    detailLabel,
    ...(typeof systemImage === "string" && systemImage.trim() ? { systemImage } : {}),
  };
}

function resolveChannelRows(snapshot: ChannelsStatusSnapshot | null): ResolvedChannelRow[] {
  if (!snapshot) {
    return [];
  }
  const order = snapshot.channelOrder ?? [];
  const metaById = new Map<string, ChannelUiMetaEntry>();
  for (const entry of snapshot.channelMeta ?? []) {
    metaById.set(entry.id, entry);
  }
  const ids = [...order];
  for (const entry of snapshot.channelMeta ?? []) {
    if (!ids.includes(entry.id)) {
      ids.push(entry.id);
    }
  }
  for (const channelId of Object.keys(snapshot.channels ?? {})) {
    if (!ids.includes(channelId)) {
      ids.push(channelId);
    }
  }
  return ids.map((channelId) => {
    const accounts = snapshot.channelAccounts[channelId] ?? [];
    const defaultAccountId = snapshot.channelDefaultAccountId[channelId] ?? null;
    const defaultAccount =
      accounts.find((entry) => entry.accountId === defaultAccountId) ?? accounts[0] ?? null;
    return {
      id: channelId,
      meta: metaById.get(channelId) ?? deriveChannelMeta(snapshot, channelId),
      summary: asRecord(snapshot.channels[channelId]),
      issues: snapshot.channelIssues?.[channelId] ?? [],
      accounts,
      defaultAccountId,
      defaultAccount,
    };
  });
}

function resolveChannelIdentifier(row: ResolvedChannelRow): string | null {
  const summary = row.summary;
  const account = row.defaultAccount;
  const probe = asRecord(account?.probe);
  const summarySelf = asRecord(summary.self);

  if (row.id === "telegram") {
    const bot = asRecord(probe.bot);
    const username = readString(bot, "username");
    return username ? `@${username.replace(/^@+/, "")}` : null;
  }
  if (row.id === "discord") {
    const bot = asRecord(probe.bot);
    return readString(bot, "username");
  }
  if (row.id === "whatsapp") {
    return (
      readString(summarySelf, "e164") ??
      readString(summarySelf, "jid") ??
      account?.name?.trim() ??
      null
    );
  }
  return account?.name?.trim() ?? null;
}

function resolveAccountLabel(row: ResolvedChannelRow): string {
  const account = row.defaultAccount;
  const accountId = row.defaultAccountId?.trim();
  if (account?.name?.trim()) {
    return account.name.trim();
  }
  if (!accountId || accountId === "default") {
    return channelText("noAccount");
  }
  return accountId;
}

function resolveChannelFlags(row: ResolvedChannelRow) {
  const summary = row.summary;
  const account = row.defaultAccount;
  const configured = readBoolean(summary, "configured") || account?.configured === true;
  const linked = readBoolean(summary, "linked") || account?.linked === true;
  const connected =
    readBoolean(summary, "connected") ||
    readBoolean(summary, "running") ||
    account?.connected === true ||
    account?.running === true;
  const attention =
    row.issues.length > 0 ||
    Boolean(account?.lastError?.trim()) ||
    Boolean(readString(summary, "lastError"));
  const setupAvailable =
    readBoolean(summary, "setupAvailable") ||
    row.id === "telegram" ||
    row.id === "whatsapp" ||
    row.id === "discord";
  const logoutAvailable =
    readBoolean(summary, "logoutAvailable") || row.id === "telegram" || row.id === "whatsapp";
  const linkMode = readString(summary, "linkMode") ?? (row.id === "whatsapp" ? "qr" : "wizard");

  return {
    configured,
    linked,
    connected,
    attention,
    setupAvailable,
    logoutAvailable,
    linkMode,
  };
}

function resolveChannelStatus(row: ResolvedChannelRow): ChannelVisualStatus {
  const flags = resolveChannelFlags(row);
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

function resolveChannelRequirements(row: ResolvedChannelRow): ChannelRequirements | null {
  if (row.id === "telegram") {
    return {
      title: channelText("stepsTitle"),
      items: [
        channelText("steps.telegram.0"),
        channelText("steps.telegram.1"),
        channelText("steps.telegram.2"),
      ],
    };
  }
  if (row.id === "discord") {
    return {
      title: channelText("stepsTitle"),
      items: [
        channelText("steps.discord.0"),
        channelText("steps.discord.1"),
        channelText("steps.discord.2"),
      ],
    };
  }
  if (row.id === "whatsapp") {
    return {
      title: channelText("stepsTitle"),
      items: [
        channelText("steps.whatsapp.0"),
        channelText("steps.whatsapp.1"),
        channelText("steps.whatsapp.2"),
      ],
    };
  }
  return null;
}

function resolvePrimaryAction(
  row: ResolvedChannelRow,
  props: ChannelsProps,
): { label: string; action: () => void; busy: boolean } | null {
  const flags = resolveChannelFlags(row);
  const isSetupBusy =
    props.setupLoading ||
    props.setupSubmitting ||
    props.setupSessionId !== null ||
    props.setupStep !== null;

  if (row.id === "whatsapp" && flags.configured) {
    return {
      label: flags.linked ? channelText("relink") : channelText("showQr"),
      action: () => {
        props.onStartWhatsAppLink(flags.linked);
      },
      busy: props.busyKey === "whatsapp:start" || props.busyKey === "whatsapp:wait",
    };
  }

  if (!flags.setupAvailable) {
    return null;
  }

  return {
    label:
      flags.configured || flags.attention
        ? channelText("configureAction")
        : channelText("connectAction"),
    action: () => {
      props.onStartChannelSetup(row.id);
    },
    busy: isSetupBusy,
  };
}

function buildWizardAnswer(props: ChannelsProps): WizardAnswer | undefined {
  const step = props.setupStep;
  if (!step) {
    return undefined;
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

function renderWizardStep(step: WizardStep, props: ChannelsProps) {
  const message = step.message?.trim() || "";
  if (step.type === "text") {
    return html`
      <label class="field" style="margin-top: 14px;">
        <span>${message}</span>
        <input
          class="input"
          .value=${props.setupDraftText}
          type=${step.sensitive ? "password" : "text"}
          placeholder=${step.placeholder ?? ""}
          @input=${(event: Event) => {
            props.onSetupDraftTextChange((event.target as HTMLInputElement).value);
          }}
        />
        ${step.sensitive
          ? html`<div class="list-sub" style="margin-top: 8px;">
              ${channelText("setupSensitiveHint")}
            </div>`
          : nothing}
      </label>
    `;
  }
  if (step.type === "confirm") {
    return html`
      <label
        class="list-item"
        style="margin-top: 14px; align-items: center; gap: 12px; cursor: pointer;"
      >
        <input
          type="checkbox"
          .checked=${props.setupDraftConfirm}
          @change=${(event: Event) => {
            props.onSetupDraftConfirmChange((event.target as HTMLInputElement).checked);
          }}
        />
        <div class="list-main">
          <div class="list-title">${message}</div>
        </div>
      </label>
    `;
  }
  if (step.type === "select" && Array.isArray(step.options)) {
    return html`
      <div style="display: grid; gap: 10px; margin-top: 14px;">
        ${step.options.map(
          (option, index) => html`
            <label class="list-item" style="align-items: flex-start; gap: 12px; cursor: pointer;">
              <input
                type="radio"
                name="channel-setup-select"
                .checked=${props.setupDraftSelectIndex === index}
                @change=${() => {
                  props.onSetupDraftSelectIndexChange(index);
                }}
              />
              <div class="list-main">
                <div class="list-title">${option.label}</div>
                ${option.hint ? html`<div class="list-sub">${option.hint}</div>` : nothing}
              </div>
            </label>
          `,
        )}
      </div>
    `;
  }
  if (step.type === "multiselect" && Array.isArray(step.options)) {
    return html`
      <div style="display: grid; gap: 10px; margin-top: 14px;">
        ${step.options.map(
          (option, index) => html`
            <label class="list-item" style="align-items: flex-start; gap: 12px; cursor: pointer;">
              <input
                type="checkbox"
                .checked=${props.setupDraftMultiIndexes.includes(index)}
                @change=${(event: Event) => {
                  const checked = (event.target as HTMLInputElement).checked;
                  const next = checked
                    ? [...new Set([...props.setupDraftMultiIndexes, index])]
                    : props.setupDraftMultiIndexes.filter((entry) => entry !== index);
                  props.onSetupDraftMultiIndexesChange(next);
                }}
              />
              <div class="list-main">
                <div class="list-title">${option.label}</div>
                ${option.hint ? html`<div class="list-sub">${option.hint}</div>` : nothing}
              </div>
            </label>
          `,
        )}
      </div>
    `;
  }
  return html`
    <div class="list-item" style="margin-top: 14px;">
      <div class="list-main">
        <div class="list-sub" style="white-space: pre-wrap;">
          ${message || channelText("setupWaiting")}
        </div>
      </div>
    </div>
  `;
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
    <section class="card">
      <div class="alisio-page__eyebrow">${channelText("setupEyebrow")}</div>
      <div class="card-title">${channelText("setupTitle", { channel: String(channelLabel) })}</div>
      ${requirements ? renderChannelSteps(requirements) : nothing}
      ${props.setupLoading && !step
        ? html`<div class="card-sub" style="margin-top: 10px;">${channelText("setupLoading")}</div>`
        : nothing}
      ${props.setupError
        ? html`<div class="pill danger" style="margin-top: 12px; width: fit-content;">
            ${props.setupError}
          </div>`
        : nothing}
      ${step
        ? html`
            ${step.title?.trim()
              ? html`<div class="list-title" style="margin-top: 14px;">${step.title}</div>`
              : nothing}
            ${renderWizardStep(step, props)}
          `
        : nothing}
      <div class="row" style="gap: 10px; margin-top: 18px; flex-wrap: wrap;">
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
    </section>
  `;
}

function renderIssueList(issues: ChannelStatusIssue[]) {
  if (issues.length === 0) {
    return nothing;
  }
  return html`
    <div style="display: grid; gap: 10px; margin-top: 14px;">
      ${issues.map(
        (issue) => html`
          <div class="list-item">
            <div class="list-main">
              <div class="list-title">${issue.message}</div>
              ${issue.fix ? html`<div class="list-sub">${issue.fix}</div>` : nothing}
            </div>
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

function renderWhatsAppQr(row: ResolvedChannelRow, props: ChannelsProps) {
  if (row.id !== "whatsapp" || !props.loginQrDataUrl) {
    return nothing;
  }
  return html`
    <div class="qr-wrap" style="margin-top: 16px;">
      <img src=${props.loginQrDataUrl} alt="WhatsApp QR" />
    </div>
    <div class="card-sub" style="margin-top: 12px;">${channelText("qrHelp")}</div>
    <div class="row" style="gap: 10px; margin-top: 14px; flex-wrap: wrap;">
      <button
        class="btn btn--sm"
        ?disabled=${props.busyKey === "whatsapp:wait"}
        @click=${props.onWaitWhatsAppLink}
      >
        ${props.busyKey === "whatsapp:wait"
          ? channelText("checkingLink")
          : channelText("checkLink")}
      </button>
    </div>
  `;
}

function renderChannelCard(row: ResolvedChannelRow, props: ChannelsProps) {
  const status = resolveChannelStatus(row);
  const docsUrl = buildChannelDocsUrl(row.meta.docsPath);
  const primaryAction = resolvePrimaryAction(row, props);
  const identifier = resolveChannelIdentifier(row);
  const lastActivity = formatLastActivity(row.defaultAccount);
  const flags = resolveChannelFlags(row);
  const requirements = resolveChannelRequirements(row);
  const canLogout =
    flags.logoutAvailable && (flags.linked || flags.connected) && Boolean(row.defaultAccountId);

  return html`
    <article class="card">
      <div class="row" style="justify-content: space-between; align-items: flex-start; gap: 12px;">
        <div>
          <div class="card-title">${row.meta.label}</div>
          <div class="card-sub" style="margin-top: 8px;">
            ${row.meta.blurb?.trim() || row.meta.detailLabel || channelText("noDetails")}
          </div>
        </div>
        <span class=${status.className}>${status.label}</span>
      </div>

      <div class="chip-row" style="margin-top: 14px;">
        <span class="chip">${resolveAccountLabel(row)}</span>
        ${identifier ? html`<span class="chip">${identifier}</span>` : nothing}
        ${lastActivity
          ? html` <span class="chip">${channelText("lastActivity")}: ${lastActivity}</span> `
          : html`<span class="chip">${channelText("activityNone")}</span>`}
      </div>

      ${renderIssueList(row.issues)}
      ${requirements && (!flags.connected || row.issues.length > 0)
        ? renderChannelSteps(requirements, { compact: true })
        : nothing}
      ${renderWhatsAppQr(row, props)}

      <div class="row" style="gap: 10px; margin-top: 18px; flex-wrap: wrap;">
        ${primaryAction
          ? html`
              <button
                class="btn btn--sm primary"
                ?disabled=${primaryAction.busy}
                @click=${primaryAction.action}
              >
                ${primaryAction.label}
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
        ${canLogout
          ? html`
              <button
                class="btn btn--sm danger"
                @click=${() => {
                  props.onLogoutChannel(row.id, row.defaultAccountId ?? undefined);
                }}
              >
                ${channelText("logout")}
              </button>
            `
          : nothing}
      </div>
    </article>
  `;
}

export function renderChannels(props: ChannelsProps) {
  const rows = resolveChannelRows(props.snapshot);
  const connectedChannels = rows.filter((row) => resolveChannelFlags(row).connected).length;
  const attentionChannels = rows.filter((row) => resolveChannelFlags(row).attention).length;
  const publishedChannels = rows.length;
  const lastChecked = formatTimestamp(props.lastSuccess ?? props.snapshot?.ts ?? null);

  return html`
    <section class="alisio-page">
      <section class="card">
        <div class="alisio-page__eyebrow">${channelText("eyebrow")}</div>
        <div
          class="row"
          style="justify-content: space-between; align-items: flex-start; gap: 16px;"
        >
          <div>
            <div class="card-title">${channelText("title")}</div>
            <div class="card-sub">${channelText("subtitle")}</div>
          </div>
          <button class="btn btn--sm" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${props.loading ? channelText("refreshing") : channelText("refresh")}
          </button>
        </div>

        <div
          style="display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); margin-top: 18px;"
        >
          <article class="list-item">
            <div class="list-title">${publishedChannels}</div>
            <div class="list-sub">${channelText("availableChannels")}</div>
          </article>
          <article class="list-item">
            <div class="list-title">${connectedChannels}</div>
            <div class="list-sub">${channelText("connectedChannels")}</div>
          </article>
          <article class="list-item">
            <div class="list-title">${attentionChannels}</div>
            <div class="list-sub">${channelText("attentionChannels")}</div>
          </article>
          <article class="list-item">
            <div class="list-title">${lastChecked ?? "—"}</div>
            <div class="list-sub">${channelText("lastChecked")}</div>
          </article>
        </div>

        ${props.actionMessage
          ? html`
              <div class="pill pill--ok" style="margin-top: 16px; width: fit-content;">
                ${props.actionMessage}
              </div>
            `
          : nothing}
        ${props.error
          ? html`
              <div class="pill danger" style="margin-top: 12px; width: fit-content;">
                ${props.error}
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
            <section
              style="display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));"
            >
              ${rows.map((row) => renderChannelCard(row, props))}
            </section>
          `
        : html`
            <section class="card">
              <div class="card-sub">${channelText("empty")}</div>
            </section>
          `}

      <section class="card">
        <div class="card-title">${channelText("sessionTitle")}</div>
        <div class="card-sub" style="margin-top: 10px;">${channelText("sessionBody")}</div>
        <div class="chip-row" style="margin-top: 14px;">
          <span class="chip">${channelText("sessionDirect")}</span>
          <span class="chip">${channelText("sessionGroups")}</span>
        </div>
      </section>
    </section>
  `;
}
