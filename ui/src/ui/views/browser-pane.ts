import { html } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { t } from "../../i18n/index.ts";
import {
  getBrowserPaneAvailableSurfaces,
  resolveBrowserPaneSurface,
  type BrowserPaneMarkdownState,
  type BrowserPaneObserver,
  type BrowserPaneSurfaceKind,
} from "../controllers/browser-pane.ts";
import { icons } from "../icons.ts";
import { toSanitizedMarkdownHtml } from "../markdown.ts";

const chatText = (key: string) => t(`alisio.chat.${key}`);

export type BrowserPaneProps = {
  observer?: BrowserPaneObserver | null;
  markdown?: BrowserPaneMarkdownState | null;
  selectedSurface?: BrowserPaneSurfaceKind;
  onSelectSurface?: (surface: BrowserPaneSurfaceKind) => void;
  onClose: () => void;
  onViewRawText?: () => void;
};

function getBrowserPaneLabel(kind: BrowserPaneSurfaceKind): string {
  switch (kind) {
    case "observer":
      return chatText("browserPane.surfaces.observer");
    case "markdown":
      return chatText("browserPane.surfaces.markdown");
  }
}

export function renderBrowserPane(props: BrowserPaneProps) {
  const available = getBrowserPaneAvailableSurfaces({
    observer: props.observer ?? null,
    markdown: props.markdown ?? null,
  });
  const surface = resolveBrowserPaneSurface({
    preferredSurface: props.selectedSurface ?? "observer",
    observer: props.observer ?? null,
    markdown: props.markdown ?? null,
  });
  const selectedSurface = surface?.kind ?? null;
  const title =
    selectedSurface && available.length <= 1
      ? getBrowserPaneLabel(selectedSurface)
      : chatText("browserPane.title");

  return html`
    <div class="browser-pane browser-pane__panel">
      <div class="browser-pane__header">
        <div class="browser-pane__header-main">
          <div class="browser-pane__title">${title}</div>
          ${available.length > 1 && props.onSelectSurface
            ? html`
                <div
                  class="browser-pane__switch"
                  role="tablist"
                  aria-label=${chatText("browserPane.surfacePicker")}
                >
                  ${available.map((kind) => {
                    const active = selectedSurface === kind;
                    return html`
                      <button
                        class="btn btn--sm browser-pane__switch-button ${active
                          ? "browser-pane__switch-button--active"
                          : ""}"
                        type="button"
                        role="tab"
                        aria-selected=${active ? "true" : "false"}
                        @click=${() => props.onSelectSurface?.(kind)}
                      >
                        ${getBrowserPaneLabel(kind)}
                      </button>
                    `;
                  })}
                </div>
              `
            : null}
        </div>
        <button
          @click=${props.onClose}
          class="btn browser-pane__close"
          title=${chatText("browserPane.close")}
          aria-label=${chatText("browserPane.close")}
        >
          ${icons.x}
        </button>
      </div>
      <div
        class="browser-pane__content ${surface?.kind === "observer"
          ? "browser-pane__content--observer"
          : ""}"
      >
        ${surface?.kind === "observer"
          ? html`
              <iframe
                class="browser-pane__iframe"
                title=${surface.observer.label ?? chatText("browserPane.observerTitle")}
                src=${surface.observer.url}
                referrerpolicy="no-referrer"
              ></iframe>
            `
          : surface?.kind === "markdown"
            ? surface.error
              ? html`
                  <div class="callout danger">${surface.error}</div>
                  ${props.onViewRawText
                    ? html`
                        <button @click=${props.onViewRawText} class="btn browser-pane__raw-action">
                          ${chatText("browserPane.viewRawText")}
                        </button>
                      `
                    : null}
                `
              : surface.content
                ? html`<div class="sidebar-markdown">
                    ${unsafeHTML(toSanitizedMarkdownHtml(surface.content))}
                  </div>`
                : html`<div class="muted browser-pane__empty">
                    ${chatText("browserPane.noContent")}
                  </div>`
            : html`<div class="muted browser-pane__empty">
                ${chatText("browserPane.unavailable")}
              </div>`}
      </div>
    </div>
  `;
}
