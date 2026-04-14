import { html } from "lit";
import { t } from "../../i18n/index.ts";
import { icons } from "../icons.ts";
import type { ThemeTransitionContext } from "../theme-transition.ts";
import {
  getThemeAccent,
  THEME_PREVIEW_TONES,
  type ThemeAccents,
  type ThemeFamily,
  type ThemeMode,
} from "../theme.ts";

type AppearanceThemeOption = {
  id: ThemeFamily;
  labelKey: string;
  icon: typeof icons.zap;
};

const THEME_OPTIONS: AppearanceThemeOption[] = [
  { id: "mood", labelKey: "alisio.settings.appearance.themes.mood", icon: icons.zap },
  { id: "noir", labelKey: "alisio.settings.appearance.themes.noir", icon: icons.link },
  { id: "matte", labelKey: "alisio.settings.appearance.themes.matte", icon: icons.barChart },
];

export type AppearanceControlsProps = {
  themeFamily: ThemeFamily;
  themeMode: ThemeMode;
  themeAccents: ThemeAccents;
  onThemeFamilyChange: (themeFamily: ThemeFamily, context?: ThemeTransitionContext) => void;
  onThemeAccentChange: (themeFamily: ThemeFamily, accent: string) => void;
  onThemeModeChange: (mode: ThemeMode) => void;
};

export function renderAppearanceControls(props: AppearanceControlsProps) {
  const modeOptions = [
    {
      id: "system" as const,
      label: t("alisio.settings.appearance.options.system"),
    },
    {
      id: "light" as const,
      label: t("alisio.settings.appearance.options.light"),
    },
    {
      id: "dark" as const,
      label: t("alisio.settings.appearance.options.dark"),
    },
  ];

  return html`
    <div class="settings-appearance__section">
      <h3 class="settings-appearance__heading">${t("alisio.settings.appearance.themeTitle")}</h3>
      <div
        class="settings-theme-grid"
        role="radiogroup"
        aria-label=${t("alisio.settings.appearance.themeTitle")}
      >
        ${THEME_OPTIONS.map((option) => {
          const active = option.id === props.themeFamily;
          const preview = THEME_PREVIEW_TONES[option.id];
          const accent = getThemeAccent(props.themeAccents, option.id);
          return html`
            <button
              type="button"
              class="settings-theme-card settings-theme-card--${option.id} ${active
                ? "settings-theme-card--active"
                : ""}"
              role="radio"
              aria-checked=${active}
              data-theme-option=${option.id}
              style=${`--theme-preview-bg:${preview.bg};--theme-preview-rail:${preview.rail};--theme-preview-panel:${preview.panel};--theme-preview-accent:${accent};--theme-preview-border:${preview.border};`}
              @click=${(event: Event) => {
                if (active) {
                  return;
                }
                props.onThemeFamilyChange(option.id, {
                  element: event.currentTarget as HTMLElement,
                });
              }}
            >
              <span class="settings-theme-card__preview" aria-hidden="true">
                <span class="settings-theme-card__preview-shell">
                  <span class="settings-theme-card__preview-rail"></span>
                  <span class="settings-theme-card__preview-panel"></span>
                  <span class="settings-theme-card__preview-accent"></span>
                </span>
              </span>
              <span class="settings-theme-card__copy">
                <span class="settings-theme-card__label">${t(option.labelKey)}</span>
                <label class="settings-theme-card__accent-row">
                  <span class="settings-theme-card__accent-label"
                    >${t("alisio.settings.appearance.accentLabel")}</span
                  >
                  <span
                    class="settings-theme-card__accent-chip"
                    style=${`--theme-preview-accent:${accent};`}
                  >
                    <input
                      class="settings-theme-card__accent-input"
                      type="color"
                      .value=${accent}
                      aria-label=${t("alisio.settings.appearance.accentPicker", {
                        theme: t(option.labelKey),
                      })}
                      @click=${(event: Event) => event.stopPropagation()}
                      @change=${(event: Event) => {
                        event.stopPropagation();
                        props.onThemeAccentChange(
                          option.id,
                          (event.currentTarget as HTMLInputElement).value,
                        );
                      }}
                    />
                  </span>
                </label>
              </span>
              <span class="settings-theme-card__icon" aria-hidden="true">${option.icon}</span>
              <span class="settings-theme-card__check" aria-hidden="true"
                >${active ? icons.check : ""}</span
              >
            </button>
          `;
        })}
      </div>
    </div>

    <div class="settings-appearance__section">
      <h3 class="settings-appearance__heading">${t("alisio.settings.appearance.modeTitle")}</h3>
      <div
        class="alisio-settings-options"
        role="tablist"
        aria-label=${t("alisio.settings.appearance.modeTitle")}
      >
        ${modeOptions.map(
          (mode) => html`
            <button
              type="button"
              class="chip ${props.themeMode === mode.id ? "chip-active" : ""}"
              data-theme-mode=${mode.id}
              @click=${() => {
                if (props.themeMode === mode.id) {
                  return;
                }
                props.onThemeModeChange(mode.id);
              }}
            >
              ${mode.label}
            </button>
          `,
        )}
      </div>
    </div>
  `;
}
