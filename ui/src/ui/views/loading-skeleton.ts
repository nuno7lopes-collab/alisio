import { html, nothing, type TemplateResult } from "lit";

export type SkeletonLineLength = "short" | "medium" | "long" | "full";
export type SkeletonAside = "none" | "pill" | "button";

function skeletonLineClass(length: SkeletonLineLength): string {
  return length === "full" ? "loading-state__line--full" : `skeleton-line--${length}`;
}

export function renderSkeletonLines(
  lengths: readonly SkeletonLineLength[],
  opts: { className?: string; compact?: boolean } = {},
): TemplateResult {
  const classes = ["loading-state__lines"];
  if (opts.compact) {
    classes.push("loading-state__lines--compact");
  }
  if (opts.className) {
    classes.push(opts.className);
  }
  return html`
    <div class=${classes.join(" ")} aria-hidden="true">
      ${lengths.map(
        (length) => html`<div class="skeleton skeleton-line ${skeletonLineClass(length)}"></div>`,
      )}
    </div>
  `;
}

export function renderSkeletonPill(opts: { className?: string; small?: boolean } = {}) {
  return html`
    <div
      class="skeleton loading-state__pill ${opts.small
        ? "loading-state__pill--small"
        : ""} ${opts.className ?? ""}"
      aria-hidden="true"
    ></div>
  `;
}

export function renderSkeletonButton(
  opts: {
    className?: string;
    small?: boolean;
    wide?: boolean;
  } = {},
) {
  return html`
    <div
      class="skeleton loading-state__button ${opts.small
        ? "loading-state__button--small"
        : ""} ${opts.wide ? "loading-state__button--wide" : ""} ${opts.className ?? ""}"
      aria-hidden="true"
    ></div>
  `;
}

export function renderSkeletonInput(
  opts: {
    className?: string;
    compact?: boolean;
  } = {},
) {
  return html`
    <div
      class="skeleton loading-state__input ${opts.compact
        ? "loading-state__input--compact"
        : ""} ${opts.className ?? ""}"
      aria-hidden="true"
    ></div>
  `;
}

export function renderSkeletonStatCard() {
  return html`
    <article class="loading-state__stat-card" aria-hidden="true">
      ${renderSkeletonPill({ small: true })}
      ${renderSkeletonLines(["short", "medium"], { compact: true })}
    </article>
  `;
}

export function renderSkeletonStatCards(count: number): TemplateResult[] {
  return Array.from({ length: count }, () => renderSkeletonStatCard());
}

export function renderSkeletonListItem(
  opts: {
    lines?: readonly SkeletonLineLength[];
    aside?: SkeletonAside;
    compact?: boolean;
  } = {},
) {
  const aside = opts.aside ?? "none";
  return html`
    <div
      class="loading-state__list-item ${opts.compact ? "loading-state__list-item--compact" : ""}"
      aria-hidden="true"
    >
      <div class="loading-state__list-item-main">
        ${renderSkeletonLines(opts.lines ?? ["long", "medium"])}
      </div>
      ${aside === "pill"
        ? renderSkeletonPill()
        : aside === "button"
          ? renderSkeletonButton({ small: true })
          : nothing}
    </div>
  `;
}

export function renderSkeletonTable(opts: {
  rows?: number;
  columns?: readonly SkeletonLineLength[];
}) {
  const rows = opts.rows ?? 5;
  const columns = opts.columns ?? ["long", "medium", "short", "short", "short", "short"];
  const gridTemplate = `grid-template-columns: ${columns.map(() => "minmax(0, 1fr)").join(" ")};`;

  return html`
    <div class="loading-state__table" aria-hidden="true">
      <div class="loading-state__table-row loading-state__table-row--header" style=${gridTemplate}>
        ${columns.map(
          (length) => html`<div class="skeleton skeleton-line ${skeletonLineClass(length)}"></div>`,
        )}
      </div>
      ${Array.from(
        { length: rows },
        () => html`
          <div class="loading-state__table-row" style=${gridTemplate}>
            ${columns.map(
              (length) =>
                html`<div class="skeleton skeleton-line ${skeletonLineClass(length)}"></div>`,
            )}
          </div>
        `,
      )}
    </div>
  `;
}

export function renderSurfaceEmptyState(opts: {
  icon?: unknown;
  title?: unknown;
  body: unknown;
  meta?: unknown;
  actions?: TemplateResult | readonly TemplateResult[] | null;
  className?: string;
  compact?: boolean;
  centered?: boolean;
}) {
  const actions =
    opts.actions == null ? [] : Array.isArray(opts.actions) ? opts.actions : [opts.actions];

  return html`
    <div
      class="empty-state empty-state--surface ${opts.compact
        ? "empty-state--compact"
        : ""} ${opts.centered ? "empty-state--centered" : ""} ${opts.className ?? ""}"
    >
      ${opts.icon != null ? html`<div class="empty-state__icon">${opts.icon}</div>` : nothing}
      ${opts.title != null ? html`<div class="empty-state__title">${opts.title}</div>` : nothing}
      <div class="empty-state__body">${opts.body}</div>
      ${opts.meta != null ? html`<div class="empty-state__meta">${opts.meta}</div>` : nothing}
      ${actions.length > 0 ? html`<div class="empty-state__actions">${actions}</div>` : nothing}
    </div>
  `;
}
