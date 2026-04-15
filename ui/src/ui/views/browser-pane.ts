import { html } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import {
  getBrowserPaneAvailableSurfaces,
  resolveBrowserPaneSurface,
  type BrowserPaneMarkdownState,
  type BrowserPaneObserver,
  type BrowserPaneSurfaceKind,
} from "../controllers/browser-pane.ts";
import { icons } from "../icons.ts";
import { toSanitizedMarkdownHtml } from "../markdown.ts";

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
      return "Browser";
    case "markdown":
      return "Tool Output";
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
    selectedSurface && available.length <= 1 ? getBrowserPaneLabel(selectedSurface) : "Right Pane";

  return html`
    <div class="sidebar-panel browser-pane">
      <div class="sidebar-header">
        <div style="display: flex; min-width: 0; align-items: center; gap: 10px;">
          <div class="sidebar-title">${title}</div>
          ${available.length > 1 && props.onSelectSurface
            ? html`
                <div
                  class="browser-pane__switch"
                  role="tablist"
                  aria-label="Pane surface"
                  style="display: inline-flex; gap: 6px;"
                >
                  ${available.map((kind) => {
                    const active = selectedSurface === kind;
                    return html`
                      <button
                        class="btn btn--sm"
                        type="button"
                        role="tab"
                        aria-selected=${active ? "true" : "false"}
                        @click=${() => props.onSelectSurface?.(kind)}
                        style=${active
                          ? "background: color-mix(in srgb, var(--accent) 18%, var(--panel));"
                          : ""}
                      >
                        ${getBrowserPaneLabel(kind)}
                      </button>
                    `;
                  })}
                </div>
              `
            : null}
        </div>
        <button @click=${props.onClose} class="btn" title="Close pane" aria-label="Close pane">
          ${icons.x}
        </button>
      </div>
      <div
        class="sidebar-content"
        style=${surface?.kind === "observer"
          ? "display: flex; min-height: 0; flex-direction: column;"
          : ""}
      >
        ${surface?.kind === "observer"
          ? html`
              <iframe
                class="browser-pane__iframe"
                title=${surface.observer.label ?? "Browser observer"}
                src=${surface.observer.url}
                referrerpolicy="no-referrer"
                style="width: 100%; min-height: 420px; flex: 1 1 0; border: 0; border-radius: 16px; background: #05070b;"
              ></iframe>
            `
          : surface?.kind === "markdown"
            ? surface.error
              ? html`
                  <div class="callout danger">${surface.error}</div>
                  ${props.onViewRawText
                    ? html`
                        <button @click=${props.onViewRawText} class="btn" style="margin-top: 12px;">
                          View Raw Text
                        </button>
                      `
                    : null}
                `
              : surface.content
                ? html`<div class="sidebar-markdown">
                    ${unsafeHTML(toSanitizedMarkdownHtml(surface.content))}
                  </div>`
                : html`<div class="muted">No content available</div>`
            : html`<div class="muted">No pane surface available</div>`}
      </div>
    </div>
  `;
}
