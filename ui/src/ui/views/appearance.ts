import { html } from "lit";
import { t } from "../../i18n/index.ts";
import { icons } from "../icons.ts";
import type { ThemeTransitionContext } from "../theme-transition.ts";
import type { ThemeMode, ThemeName } from "../theme.ts";

type AppearanceThemeOption = {
  id: ThemeName;
  labelKey: string;
  icon: typeof icons.zap;
};

const THEME_OPTIONS: AppearanceThemeOption[] = [
  { id: "claw", labelKey: "alisio.settings.appearance.themes.claw", icon: icons.zap },
  { id: "knot", labelKey: "alisio.settings.appearance.themes.knot", icon: icons.link },
  { id: "dash", labelKey: "alisio.settings.appearance.themes.dash", icon: icons.barChart },
];

export type AppearanceControlsProps = {
  theme: ThemeName;
  themeMode: ThemeMode;
  onThemeChange: (theme: ThemeName, context?: ThemeTransitionContext) => void;
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
          const active = option.id === props.theme;
          return html`
            <button
              type="button"
              class="settings-theme-card settings-theme-card--${option.id} ${active
                ? "settings-theme-card--active"
                : ""}"
              role="radio"
              aria-checked=${active}
              data-theme-option=${option.id}
              @click=${(event: Event) => {
                if (active) {
                  return;
                }
                const context: ThemeTransitionContext = {
                  element: event.currentTarget as HTMLElement,
                };
                props.onThemeChange(option.id, context);
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
