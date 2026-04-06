import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import { t } from "../../i18n/index.ts";
import type { SkillMessageMap } from "../controllers/skills.ts";
import { resolveSafeExternalUrl } from "../open-external-url.ts";
import type { SkillStatusEntry } from "../types.ts";

export type SkillsStatusFilter = "all" | "ready" | "needs-setup" | "disabled";

type SkillDetailDialogProps = {
  edits: Record<string, string>;
  busyKey: string | null;
  messages: SkillMessageMap;
  onToggle: (skillKey: string, enabled: boolean) => void;
  onEdit: (skillKey: string, value: string) => void;
  onSaveKey: (skillKey: string) => void;
  onInstall: (skillKey: string, name: string, installId: string) => void;
  onDetailClose: () => void;
};

type SkillMissingKind = "bin" | "env" | "config" | "os";

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
    case "openclaw-bundled":
      return t("alisio.capabilities.sources.builtIn");
    case "openclaw-managed":
      return t("alisio.capabilities.sources.managed");
    case "openclaw-workspace":
      return t("alisio.capabilities.sources.workspace");
    case "openclaw-plugin":
      return t("alisio.capabilities.sources.plugin");
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

export function computeSkillMissing(skill: SkillStatusEntry): string[] {
  return [
    ...skill.missing.bins.map((value) => formatSkillMissingItem("bin", value)),
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
  const canInstall = skill.install.length > 0 && skill.missing.bins.length > 0;
  const showBundledBadge = Boolean(skill.bundled && skill.source !== "openclaw-bundled");
  const missing = computeSkillMissing(skill);
  const reasons = computeSkillReasons(skill);
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
            ${canInstall
              ? html`
                  <button
                    class="btn"
                    ?disabled=${busy}
                    @click=${() => props.onInstall(skill.skillKey, skill.name, skill.install[0].id)}
                  >
                    ${busy ? t("alisio.capabilities.detail.installing") : skill.install[0].label}
                  </button>
                `
              : nothing}
          </div>

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
