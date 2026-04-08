import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import { legacySkillSources } from "../../brand-compat.ts";
import { t } from "../../i18n/index.ts";
import {
  skillEnvEditKey,
  type SkillActionOutput,
  type SkillConsentRequest,
  type SkillMessageMap,
} from "../controllers/skills.ts";
import { resolveSafeExternalUrl } from "../open-external-url.ts";
import type { SkillStatusEntry } from "../types.ts";

export type SkillsStatusFilter = "all" | "ready" | "needs-setup" | "disabled";

type SkillDetailDialogProps = {
  edits: Record<string, string>;
  busyKey: string | null;
  messages: SkillMessageMap;
  actionOutputs: Record<string, SkillActionOutput>;
  consentRequest: SkillConsentRequest | null;
  onToggle: (skillKey: string, enabled: boolean) => void;
  onEdit: (skillKey: string, value: string) => void;
  onEnvEdit: (skillKey: string, envName: string, value: string) => void;
  onSaveKey: (skillKey: string) => void;
  onSaveEnv: (skillKey: string, envName: string) => void;
  onInstall: (skillKey: string, name: string, installId: string) => void;
  onMarketplaceInstall: (skillKey: string) => void;
  onMarketplaceRemove: (skillKey: string) => void;
  onMarketplaceExecute: (skillKey: string) => void;
  onConsentResolve: (decision: "allow-once" | "allow-always" | "deny") => void;
  onConsentDismiss: () => void;
  onEnableConfig: (skillKey: string, configPath: string) => void;
  onAllowBundled: (skillKey: string) => void;
  onDetailClose: () => void;
  onOpenChannels: () => void;
  onOpenSettings: () => void;
};

type SkillMissingKind = "bin" | "anyBin" | "env" | "config" | "os";

export function buildSkillStatusCounts(
  skills: SkillStatusEntry[],
): Record<SkillsStatusFilter, number> {
  const counts: Record<SkillsStatusFilter, number> = {
    all: skills.length,
    ready: 0,
    "needs-setup": 0,
    disabled: 0,
  };
  for (const skill of skills) {
    if (skill.disabled) {
      counts.disabled++;
    } else if (skill.eligible) {
      counts.ready++;
    } else {
      counts["needs-setup"]++;
    }
  }
  return counts;
}

export function skillMatchesStatus(skill: SkillStatusEntry, status: SkillsStatusFilter): boolean {
  switch (status) {
    case "all":
      return true;
    case "ready":
      return !skill.disabled && skill.eligible;
    case "needs-setup":
      return !skill.disabled && !skill.eligible;
    case "disabled":
      return skill.disabled;
  }
}

export function skillStatusClass(skill: SkillStatusEntry): string {
  if (skill.disabled) {
    return "muted";
  }
  return skill.eligible ? "ok" : "warn";
}

export function skillStatusLabel(skill: SkillStatusEntry) {
  if (skill.disabled) {
    return t("alisio.capabilities.filters.disabled");
  }
  if (skill.blockedByAllowlist) {
    return t("alisio.capabilities.status.blocked");
  }
  return skill.eligible
    ? t("alisio.capabilities.filters.ready")
    : t("alisio.capabilities.filters.needsSetup");
}

export function humanizeSkillSource(source: string) {
  switch (source) {
    case legacySkillSources.bundled:
      return t("alisio.capabilities.sources.builtIn");
    case legacySkillSources.managed:
      return t("alisio.capabilities.sources.managed");
    case legacySkillSources.workspace:
      return t("alisio.capabilities.sources.workspace");
    case "agents-skills-project":
      return t("alisio.capabilities.sources.project");
    case "agents-skills-personal":
      return t("alisio.capabilities.sources.personal");
    case legacySkillSources.plugin:
      return t("alisio.capabilities.sources.plugin");
    case legacySkillSources.extra:
      return t("alisio.capabilities.sources.extra");
    case "alisio-mcp":
      return "MCP server";
    default:
      return t("alisio.capabilities.sources.external");
  }
}

function formatSkillMissingItem(kind: SkillMissingKind, value: string) {
  return t(`alisio.capabilities.detail.requirement.${kind}`, { value });
}

function skillStatusChipClass(skill: SkillStatusEntry) {
  if (skill.disabled || skill.blockedByAllowlist || !skill.eligible) {
    return "chip chip-warn";
  }
  return "chip chip-ok";
}

function safeExternalHref(raw?: string): string | null {
  if (!raw) {
    return null;
  }
  return resolveSafeExternalUrl(raw, window.location.href);
}

function resolveEditableEnvNames(skill: SkillStatusEntry): string[] {
  const required = skill.requirements.env ?? [];
  const missing = skill.missing.env ?? [];
  return Array.from(new Set([...required, ...missing])).filter(
    (envName) => envName !== skill.primaryEnv,
  );
}

function isSecretLikeEnvName(envName: string): boolean {
  const normalized = envName.toUpperCase();
  return ["KEY", "TOKEN", "SECRET", "PASSWORD", "PASS", "PWD"].some((part) =>
    normalized.includes(part),
  );
}

type SkillSetupAction = {
  label: string;
  action: () => void;
};

function resolveSetupActions(
  skill: SkillStatusEntry,
  props: Pick<
    SkillDetailDialogProps,
    "onAllowBundled" | "onEnableConfig" | "onOpenChannels" | "onOpenSettings"
  >,
): SkillSetupAction[] {
  const actions: SkillSetupAction[] = [];
  if (skill.blockedByAllowlist && skill.bundled) {
    actions.push({
      label: t("alisio.capabilities.detail.allowBundled"),
      action: () => props.onAllowBundled(skill.skillKey),
    });
  }
  if (skill.missing.config.length === 0) {
    return actions;
  }
  const configPaths = Array.from(new Set(skill.missing.config));
  if (skill.missing.config.every((path) => path.startsWith("channels."))) {
    actions.push({
      label: t("alisio.capabilities.detail.openChannels"),
      action: props.onOpenChannels,
    });
    return actions;
  }
  const enablePath = configPaths.find((path) => path.endsWith(".enabled"));
  if (configPaths.length === 1 && enablePath) {
    actions.push({
      label: t("alisio.capabilities.detail.enableInConfig"),
      action: () => props.onEnableConfig(skill.skillKey, enablePath),
    });
    return actions;
  }
  actions.push({
    label: t("alisio.capabilities.detail.openSettings"),
    action: props.onOpenSettings,
  });
  return actions;
}

function buildPermissionChipsFromSpec(
  permissions: SkillStatusEntry["permissions"] | undefined,
): string[] {
  if (!permissions) {
    return [];
  }
  const chips = [
    `Consent: ${permissions.consent}`,
    `Sandbox: ${permissions.sandbox.mode}/${permissions.sandbox.filesystem}/${permissions.sandbox.network}`,
  ];
  if ((permissions.exec?.bins?.length ?? 0) > 0) {
    chips.push(`Exec: ${permissions.exec?.bins?.join(", ")}`);
  }
  if ((permissions.files?.write?.length ?? 0) > 0) {
    chips.push(`Write: ${permissions.files?.write?.join(", ")}`);
  }
  if (permissions.network?.outbound) {
    chips.push(
      permissions.network.hosts?.length
        ? `Network: ${permissions.network.hosts.join(", ")}`
        : "Network: outbound",
    );
  }
  if (permissions.mcp?.consume) {
    chips.push("Consume MCP");
  }
  return chips;
}

function buildPermissionChips(skill: SkillStatusEntry): string[] {
  return buildPermissionChipsFromSpec(skill.permissions);
}

function buildOutputChipsFromSpec(outputs: SkillStatusEntry["outputs"] | undefined): string[] {
  if (!outputs) {
    return [];
  }
  return [`Primary: ${outputs.primary}`, ...outputs.formats.map((format) => `Format: ${format}`)];
}

function buildOutputChips(skill: SkillStatusEntry): string[] {
  return buildOutputChipsFromSpec(skill.outputs);
}

export function computeSkillMissing(skill: SkillStatusEntry): string[] {
  return [
    ...skill.missing.bins.map((value) => formatSkillMissingItem("bin", value)),
    ...(skill.missing.anyBins.length > 0
      ? [formatSkillMissingItem("anyBin", skill.missing.anyBins.join(", "))]
      : []),
    ...skill.missing.env.map((value) => formatSkillMissingItem("env", value)),
    ...skill.missing.config.map((value) => formatSkillMissingItem("config", value)),
    ...skill.missing.os.map((value) => formatSkillMissingItem("os", value)),
  ];
}

export function computeSkillReasons(skill: SkillStatusEntry): string[] {
  const reasons: string[] = [];
  if (skill.disabled) {
    reasons.push(t("alisio.capabilities.reasons.disabled"));
  }
  if (skill.blockedByAllowlist) {
    reasons.push(t("alisio.capabilities.reasons.blockedByAllowlist"));
  }
  if (skill.access && !skill.access.allowed) {
    reasons.push(...skill.access.issues.map((issue) => issue.message));
  }
  if (skill.manifestIssues?.length) {
    reasons.push(...skill.manifestIssues.map((issue) => issue.message));
  }
  return reasons;
}

export function renderSkillStatusChips(params: {
  skill: SkillStatusEntry;
  showBundledBadge?: boolean;
}) {
  const skill = params.skill;
  const showBundledBadge = Boolean(params.showBundledBadge);
  return html`
    <div class="chip-row" style="margin-top: 6px;">
      <span class="chip">${humanizeSkillSource(skill.source)}</span>
      ${skill.installed ? html`<span class="chip chip-ok">Installed</span>` : nothing}
      ${skill.kind === "mcp-server" ? html`<span class="chip">MCP</span>` : nothing}
      ${showBundledBadge
        ? html` <span class="chip">${t("alisio.capabilities.sources.bundledBadge")}</span> `
        : nothing}
      <span class=${skillStatusChipClass(skill)}>${skillStatusLabel(skill)}</span>
    </div>
  `;
}

export function renderSkillDetailDialog(skill: SkillStatusEntry, props: SkillDetailDialogProps) {
  const busy = props.busyKey === skill.skillKey;
  const hasEditedValue = Object.hasOwn(props.edits, skill.skillKey);
  const apiKey = hasEditedValue ? (props.edits[skill.skillKey] ?? "") : "";
  const message = props.messages[skill.skillKey] ?? null;
  const actionOutput = props.actionOutputs?.[skill.skillKey] ?? null;
  const consentRequest =
    props.consentRequest?.skillKey === skill.skillKey ? props.consentRequest : null;
  const editableEnvNames = resolveEditableEnvNames(skill);
  const installHelpsEnvSetup = skill.install.some(
    (option) => option.kind === "download" || option.bins.length === 0,
  );
  const canInstall =
    skill.install.length > 0 &&
    !skill.disabled &&
    !skill.blockedByAllowlist &&
    !skill.eligible &&
    (skill.missing.bins.length > 0 ||
      skill.missing.anyBins.length > 0 ||
      (skill.missing.env.length > 0 && installHelpsEnvSetup));
  const showBundledBadge = Boolean(skill.bundled && skill.source !== legacySkillSources.bundled);
  const missing = computeSkillMissing(skill);
  const reasons = computeSkillReasons(skill);
  const setupActions = resolveSetupActions(skill, props);
  const permissionChips = buildPermissionChips(skill);
  const outputChips = buildOutputChips(skill);
  const consentPermissionChips = buildPermissionChipsFromSpec(consentRequest?.permissions);
  const consentOutputChips = buildOutputChipsFromSpec(consentRequest?.outputs);
  const consentGrantChips =
    skill.consentGrants?.map((grant) => `${grant.action}: always allowed`) ?? [];
  const hasMarketplaceActions = Boolean(skill.installable || skill.removable || skill.executable);
  const marketplaceActions = [
    skill.installable
      ? html`
          <button
            class="btn"
            ?disabled=${busy}
            @click=${() => props.onMarketplaceInstall(skill.skillKey)}
          >
            Install locally
          </button>
        `
      : nothing,
    skill.removable
      ? html`
          <button
            class="btn"
            ?disabled=${busy}
            @click=${() => props.onMarketplaceRemove(skill.skillKey)}
          >
            Remove local copy
          </button>
        `
      : nothing,
    skill.executable
      ? html`
          <button
            class="btn"
            ?disabled=${busy}
            @click=${() => props.onMarketplaceExecute(skill.skillKey)}
          >
            ${skill.kind === "mcp-server" ? "Inspect MCP" : "Run skill"}
          </button>
        `
      : nothing,
  ];
  const showToggle = skill.kind !== "mcp-server";
  const ensureModalOpen = (el?: Element) => {
    if (!(el instanceof HTMLDialogElement) || el.open) {
      return;
    }
    el.showModal();
  };

  return html`
    <dialog
      class="md-preview-dialog md-preview-dialog--skill"
      ${ref(ensureModalOpen)}
      @click=${(event: Event) => {
        const dialog = event.currentTarget as HTMLDialogElement;
        if (event.target === dialog) {
          dialog.close();
        }
      }}
      @close=${props.onDetailClose}
    >
      <div class="md-preview-dialog__panel md-preview-dialog__panel--skill">
        <div class="md-preview-dialog__header md-preview-dialog__header--skill">
          <div class="md-preview-dialog__title skill-detail__title">
            <span class="statusDot ${skillStatusClass(skill)}"></span>
            ${skill.emoji ? html`<span class="skill-detail__emoji">${skill.emoji}</span>` : nothing}
            <span>${skill.name}</span>
          </div>
          <button
            class="btn btn--sm"
            @click=${(event: Event) => {
              (event.currentTarget as HTMLElement).closest("dialog")?.close();
            }}
          >
            ${t("alisio.capabilities.detail.close")}
          </button>
        </div>
        <div class="md-preview-dialog__body md-preview-dialog__body--skill">
          <div class="skill-detail__body">
            <div class="skill-detail__intro">
              <div class="skill-detail__lead">${skill.description}</div>
            </div>
            ${renderSkillStatusChips({ skill, showBundledBadge })}
          </div>

          ${missing.length > 0
            ? html`
                <div class="callout skill-detail__callout skill-detail__callout--warn">
                  <div class="skill-detail__section-title">
                    ${t("alisio.capabilities.detail.missingTitle")}
                  </div>
                  <div class="chip-row skill-detail__chip-list">
                    ${missing.map((item) => html`<span class="chip chip-warn">${item}</span>`)}
                  </div>
                </div>
              `
            : nothing}
          ${reasons.length > 0
            ? html`
                <div class="skill-detail__section">
                  <div class="skill-detail__section-title">
                    ${t("alisio.capabilities.detail.reasonsTitle")}
                  </div>
                  <div class="chip-row skill-detail__chip-list">
                    ${reasons.map((reason) => html`<span class="chip">${reason}</span>`)}
                  </div>
                </div>
              `
            : nothing}
          ${permissionChips.length > 0
            ? html`
                <div class="skill-detail__section">
                  <div class="skill-detail__section-title">Permissions</div>
                  <div class="chip-row skill-detail__chip-list">
                    ${permissionChips.map((chip) => html`<span class="chip">${chip}</span>`)}
                  </div>
                </div>
              `
            : nothing}
          ${outputChips.length > 0
            ? html`
                <div class="skill-detail__section">
                  <div class="skill-detail__section-title">Outputs</div>
                  <div class="chip-row skill-detail__chip-list">
                    ${outputChips.map((chip) => html`<span class="chip">${chip}</span>`)}
                  </div>
                </div>
              `
            : nothing}
          ${skill.access && !skill.access.allowed
            ? html`
                <div class="callout skill-detail__callout skill-detail__callout--warn">
                  Marketplace access: ${skill.access.issues.map((issue) => issue.message).join(" ")}
                </div>
              `
            : nothing}
          ${consentGrantChips.length > 0
            ? html`
                <div class="skill-detail__section">
                  <div class="skill-detail__section-title">Stored consent</div>
                  <div class="chip-row skill-detail__chip-list">
                    ${consentGrantChips.map((chip) => html`<span class="chip">${chip}</span>`)}
                  </div>
                </div>
              `
            : nothing}
          ${hasMarketplaceActions
            ? html`
                <div class="skill-detail__section">
                  <div class="skill-detail__section-title">Marketplace actions</div>
                  <div class="chip-row skill-detail__chip-list">${marketplaceActions}</div>
                </div>
              `
            : nothing}
          ${consentRequest
            ? html`
                <div class="callout skill-detail__callout skill-detail__callout--warn">
                  <div class="skill-detail__section-title">${consentRequest.title}</div>
                  <div>${consentRequest.description}</div>
                  ${consentPermissionChips.length > 0
                    ? html`
                        <div class="chip-row skill-detail__chip-list" style="margin-top: 10px;">
                          ${consentPermissionChips.map(
                            (chip) => html`<span class="chip">${chip}</span>`,
                          )}
                        </div>
                      `
                    : nothing}
                  ${consentOutputChips.length > 0
                    ? html`
                        <div class="chip-row skill-detail__chip-list" style="margin-top: 10px;">
                          ${consentOutputChips.map(
                            (chip) => html`<span class="chip">${chip}</span>`,
                          )}
                        </div>
                      `
                    : nothing}
                  <div class="chip-row skill-detail__chip-list" style="margin-top: 10px;">
                    <button
                      class="btn"
                      ?disabled=${busy}
                      @click=${() => props.onConsentResolve("allow-once")}
                    >
                      Allow once
                    </button>
                    <button
                      class="btn"
                      ?disabled=${busy}
                      @click=${() => props.onConsentResolve("allow-always")}
                    >
                      Allow always
                    </button>
                    <button class="btn" ?disabled=${busy} @click=${props.onConsentDismiss}>
                      Cancel
                    </button>
                    <button
                      class="btn"
                      ?disabled=${busy}
                      @click=${() => props.onConsentResolve("deny")}
                    >
                      Deny
                    </button>
                  </div>
                </div>
              `
            : nothing}
          ${showToggle
            ? html`
                <div class="skill-detail__toggle-row">
                  <label class="skill-toggle-wrap">
                    <input
                      type="checkbox"
                      class="skill-toggle"
                      .checked=${!skill.disabled}
                      ?disabled=${busy}
                      @change=${(event: Event) =>
                        props.onToggle(skill.skillKey, (event.target as HTMLInputElement).checked)}
                    />
                  </label>
                  <span class="skill-detail__toggle-label">
                    ${skill.disabled
                      ? t("alisio.capabilities.detail.disabled")
                      : t("alisio.capabilities.detail.enabled")}
                  </span>
                </div>
              `
            : nothing}
          ${canInstall || setupActions.length > 0
            ? html`
                <div class="skill-detail__section">
                  <div class="skill-detail__section-title">
                    ${t("alisio.capabilities.detail.setupActions")}
                  </div>
                  <div class="chip-row skill-detail__chip-list">
                    ${canInstall
                      ? skill.install.map(
                          (option) => html`
                            <button
                              class="btn"
                              ?disabled=${busy}
                              @click=${() => props.onInstall(skill.skillKey, skill.name, option.id)}
                            >
                              ${busy ? t("alisio.capabilities.detail.installing") : option.label}
                            </button>
                          `,
                        )
                      : nothing}
                    ${setupActions.map(
                      (setupAction) => html`
                        <button class="btn" @click=${setupAction.action}>
                          ${setupAction.label}
                        </button>
                      `,
                    )}
                  </div>
                </div>
              `
            : nothing}
          ${message
            ? html`<div class="callout ${message.kind === "error" ? "danger" : "success"}">
                ${message.message}
              </div>`
            : nothing}
          ${skill.primaryEnv
            ? html`
                <div class="skill-detail__section">
                  <label class="field">
                    <span>
                      ${t("alisio.capabilities.detail.apiKey")}
                      <span class="muted skill-detail__field-meta"> (${skill.primaryEnv}) </span>
                    </span>
                    <input
                      type="password"
                      .value=${apiKey}
                      @input=${(event: Event) =>
                        props.onEdit(skill.skillKey, (event.target as HTMLInputElement).value)}
                    />
                  </label>
                  <div class="muted skill-detail__field-note">
                    ${t("alisio.capabilities.detail.apiKeyHint")}
                  </div>
                  ${(() => {
                    const href = safeExternalHref(skill.homepage);
                    return href
                      ? html`
                          <div class="muted skill-detail__field-note">
                            ${t("alisio.capabilities.detail.getKey")}:
                            <a href=${href} target="_blank" rel="noopener noreferrer"
                              >${skill.homepage}</a
                            >
                          </div>
                        `
                      : nothing;
                  })()}
                  <button
                    class="btn primary"
                    ?disabled=${busy || !hasEditedValue}
                    @click=${() => props.onSaveKey(skill.skillKey)}
                  >
                    ${t("alisio.capabilities.detail.saveKey")}
                  </button>
                </div>
              `
            : nothing}
          ${editableEnvNames.map((envName) => {
            const editKey = skillEnvEditKey(skill.skillKey, envName);
            const hasEditedEnvValue = Object.hasOwn(props.edits, editKey);
            const envValue = hasEditedEnvValue ? (props.edits[editKey] ?? "") : "";
            return html`
              <div class="skill-detail__section">
                <label class="field">
                  <span>${envName}</span>
                  <input
                    type=${isSecretLikeEnvName(envName) ? "password" : "text"}
                    .value=${envValue}
                    @input=${(event: Event) =>
                      props.onEnvEdit(
                        skill.skillKey,
                        envName,
                        (event.target as HTMLInputElement).value,
                      )}
                  />
                </label>
                <div class="muted skill-detail__field-note">
                  ${t("alisio.capabilities.detail.valueHint")}
                </div>
                ${(() => {
                  const href = safeExternalHref(skill.homepage);
                  return href
                    ? html`
                        <div class="muted skill-detail__field-note">
                          ${t("alisio.capabilities.detail.source")}:
                          <a href=${href} target="_blank" rel="noopener noreferrer"
                            >${skill.homepage}</a
                          >
                        </div>
                      `
                    : nothing;
                })()}
                <button
                  class="btn primary"
                  ?disabled=${busy || !hasEditedEnvValue}
                  @click=${() => props.onSaveEnv(skill.skillKey, envName)}
                >
                  ${t("alisio.capabilities.detail.saveValue")}
                </button>
              </div>
            `;
          })}
          ${actionOutput
            ? html`
                <div class="skill-detail__section">
                  <div class="skill-detail__section-title">${actionOutput.title}</div>
                  <pre class="exec-approval-command mono" style="white-space: pre-wrap;">
${actionOutput.text}</pre
                  >
                </div>
              `
            : nothing}
          ${skill.recentAudit && skill.recentAudit.length > 0
            ? html`
                <div class="skill-detail__section">
                  <div class="skill-detail__section-title">Recent activity</div>
                  <div class="list">
                    ${skill.recentAudit.slice(0, 5).map(
                      (entry) => html`
                        <div class="list-item">
                          <div class="list-title">
                            ${entry.action} ·
                            ${entry.outcome}${entry.decision ? ` · ${entry.decision}` : ""}
                          </div>
                          <div class="list-sub">${entry.summary}</div>
                        </div>
                      `,
                    )}
                  </div>
                </div>
              `
            : nothing}

          <div class="skill-detail__meta">
            <div>
              <span class="skill-detail__meta-label"
                >${t("alisio.capabilities.detail.source")}:</span
              >
              ${humanizeSkillSource(skill.source)}
            </div>
            ${(() => {
              const href = safeExternalHref(skill.homepage);
              return href
                ? html`
                    <div>
                      <a href=${href} target="_blank" rel="noopener noreferrer"
                        >${skill.homepage}</a
                      >
                    </div>
                  `
                : nothing;
            })()}
          </div>
        </div>
      </div>
    </dialog>
  `;
}
