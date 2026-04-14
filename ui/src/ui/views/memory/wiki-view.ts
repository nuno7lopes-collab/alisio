import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { t } from "../../../i18n/index.ts";
import type {
  MemoryClaimItem,
  MemoryEvidenceItem,
  MemoryReasonTag,
  MemoryWikiBacklink,
  MemoryWikiHistoryEntry,
  MemoryWikiListResult,
  MemoryWikiPage,
  MemoryWikiRelatedFile,
} from "../../controllers/memory-runtime.ts";
import {
  asWikiPageModel,
  buildWikiHistorySummary,
  buildWikiPortalModel,
  type MemoryWikiHeading,
  type MemoryWikiPageModel,
  type MemoryWikiPortalGroup,
} from "../../controllers/memory-wiki-model.ts";
import { formatRelativeTimestamp } from "../../format.ts";
import { toSanitizedMarkdownHtml } from "../../markdown.ts";

type MemoryText = {
  na: string;
  none: string;
  unsaved: string;
  saving: string;
  save: string;
  reset: string;
  wikiListTitle: string;
  wikiEmpty: string;
  wikiCreate: string;
  wikiCreatePlaceholder: string;
  wikiCreateConfirm: string;
  wikiEditorTitle: string;
  wikiBacklinks: string;
  wikiClaims: string;
  wikiEvidence: string;
  wikiProvenance: string;
  wikiHistory: string;
  wikiContext: string;
  wikiRevision: string;
  wikiNoSelection: string;
  wikiHistoryEmpty: string;
  wikiBacklinksEmpty: string;
  wikiClaimsEmpty: string;
  wikiEvidenceEmpty: string;
  wikiProvenanceEmpty: string;
  wikiPath: string;
  preview: string;
  previewEmpty: string;
  traceTitle: string;
  viewTrace: string;
  traceUnavailable: string;
  whySurfaced: string;
  confidenceLabel: string;
  filesTitle: string;
};

type OpenTraceParams = {
  label: string;
  traceId?: string | null;
  trace?: unknown;
  summary?: string[] | null;
  reasonTags?: MemoryReasonTag[] | null;
};

export type RenderMemoryWikiViewParams = {
  text: MemoryText;
  searchQuery: string;
  wikiLoading: boolean;
  wikiError: string | null;
  wikiList: MemoryWikiListResult | null;
  selectedPageId: string | null;
  pageLoading: boolean;
  pageError: string | null;
  page: MemoryWikiPage | null;
  historyLoading: boolean;
  historyError: string | null;
  history: MemoryWikiHistoryEntry[];
  tracesEnabled: boolean;
  createOpen: boolean;
  createTitle: string;
  pageSaving: boolean;
  pageDirty: boolean;
  currentPageDraft: string;
  currentPageTitleDraft: string;
  editorOpen: boolean;
  onGoHome: () => void;
  onSelectPage: (pageId: string) => void;
  onSelectFile: (fileId: string) => void;
  onOpenTrace: (params: OpenTraceParams) => void;
  onOpenWikiTarget: (target: string) => void;
  onToggleCreate: (open: boolean) => void;
  onCreateTitle: (value: string) => void;
  onCreatePage: () => void;
  onToggleEditor: (open: boolean) => void;
  onSetPageDraft: (value: string) => void;
  onSetPageTitleDraft: (value: string) => void;
  onResetPage: () => void;
  onSavePage: () => void;
};

function translateWithFallback(key: string, fallback: string) {
  const translated = t(key);
  return translated === key ? fallback : translated;
}

function formatReasonLabel(tag: MemoryReasonTag) {
  const localized = t(`alisio.memory.trace.codes.${tag.code}`);
  if (localized && localized !== `alisio.memory.trace.codes.${tag.code}`) {
    return localized;
  }
  return tag.label?.trim() || tag.code.trim();
}

function translatePortalGroupName(name: string) {
  switch (name) {
    case "Recent updates":
      return translateWithFallback("alisio.memory.wiki.synthetic.recentUpdates", name);
    case "Evidence desk":
      return translateWithFallback("alisio.memory.wiki.synthetic.evidenceDesk", name);
    case "Well linked":
      return translateWithFallback("alisio.memory.wiki.synthetic.wellLinked", name);
    default:
      return name;
  }
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? formatRelativeTimestamp(parsed) : value;
}

function renderReasonTags(tags: MemoryReasonTag[] | null | undefined) {
  const entries = tags?.filter((tag) => tag.code.trim()) ?? [];
  if (entries.length === 0) {
    return nothing;
  }
  return html`
    <span class="alisio-memory-native__chips">
      ${entries.map(
        (tag) => html`<span class="alisio-memory-badge">${formatReasonLabel(tag)}</span>`,
      )}
    </span>
  `;
}

function renderStat(label: string, value: string | number) {
  return html`
    <article class="memory-wiki__stat">
      <span>${label}</span>
      <strong>${String(value)}</strong>
    </article>
  `;
}

function renderCompactStat(label: string, value: string | number) {
  return html`
    <article class="memory-wiki__compact-stat">
      <strong>${String(value)}</strong>
      <span>${label}</span>
    </article>
  `;
}

function buildPortalMonogram(title: string | null | undefined) {
  const normalized = title?.trim() || "Memory";
  return normalized.slice(0, 1).toUpperCase();
}

function renderPortalGroup(params: {
  group: MemoryWikiPortalGroup;
  onSelectPage: (pageId: string) => void;
}) {
  const lead = params.group.pages[0] ?? null;
  const secondaryPages = lead ? params.group.pages.slice(1) : params.group.pages;
  return html`
    <article class="memory-wiki__portal-cluster">
      <div class="memory-wiki__cluster-header">
        <div class="memory-wiki__stack">
          <span class="memory-wiki__cluster-label"
            >${params.group.kind === "category"
              ? translateWithFallback("alisio.memory.wiki.categories", "Categories")
              : translateWithFallback("alisio.memory.wiki.collections", "Collections")}</span
          >
          <h5>${translatePortalGroupName(params.group.name)}</h5>
        </div>
        <span class="memory-wiki__count-pill">${params.group.pages.length}</span>
      </div>
      ${lead
        ? html`
            <button
              type="button"
              class="memory-wiki__cluster-lead"
              @click=${() => params.onSelectPage(lead.id)}
            >
              <strong>${lead.title}</strong>
              <p>${lead.summary}</p>
              <div class="memory-wiki__meta-row">
                <span>${lead.path?.trim() || lead.title}</span>
                <span
                  >${formatTimestamp(lead.updatedAt) ??
                  (typeof lead.backlinks === "number" ? `${lead.backlinks} ↩` : lead.title)}</span
                >
              </div>
            </button>
          `
        : nothing}
      <div class="memory-wiki__stack">
        ${secondaryPages.map(
          (page) => html`
            <button
              type="button"
              class="memory-wiki__mini-link"
              @click=${() => params.onSelectPage(page.id)}
            >
              <strong>${page.title}</strong>
              <span>${page.summary}</span>
            </button>
          `,
        )}
      </div>
    </article>
  `;
}

function renderBacklinks(
  text: MemoryText,
  backlinks: MemoryWikiBacklink[] | null | undefined,
  onSelectPage: (pageId: string) => void,
  onOpenWikiTarget: (target: string) => void,
) {
  const items = backlinks ?? [];
  return html`
    <section class="memory-wiki__rail-card">
      <div class="memory-wiki__rail-header">
        <h4>${text.wikiBacklinks}</h4>
        <span>${items.length}</span>
      </div>
      ${items.length === 0
        ? html`<div class="alisio-memory-empty">${text.wikiBacklinksEmpty}</div>`
        : html`
            <div class="memory-wiki__stack">
              ${items.map(
                (item) => html`
                  <button
                    type="button"
                    class="memory-wiki__mini-link"
                    @click=${() =>
                      item.id ? onSelectPage(item.id) : onOpenWikiTarget(item.path ?? item.title)}
                  >
                    <strong>${item.title}</strong>
                    <span>${item.excerpt?.trim() || item.path?.trim() || text.na}</span>
                  </button>
                `,
              )}
            </div>
          `}
    </section>
  `;
}

function renderClaims(text: MemoryText, claims: MemoryClaimItem[] | null | undefined) {
  const items = claims ?? [];
  return html`
    <section class="memory-wiki__rail-card">
      <div class="memory-wiki__rail-header">
        <h4>${text.wikiClaims}</h4>
        <span>${items.length}</span>
      </div>
      ${items.length === 0
        ? html`<div class="alisio-memory-empty">${text.wikiClaimsEmpty}</div>`
        : html`
            <div class="memory-wiki__stack">
              ${items.map(
                (claim) => html`
                  <article class="memory-wiki__detail-card">
                    <strong>${claim.claim}</strong>
                    ${claim.confidence != null
                      ? html`<span>${text.confidenceLabel}: ${String(claim.confidence)}</span>`
                      : nothing}
                    ${(claim.evidence ?? [])
                      .slice(0, 2)
                      .map(
                        (evidence) =>
                          html`<span
                            >${evidence.excerpt?.trim() || evidence.title?.trim() || text.na}</span
                          >`,
                      )}
                  </article>
                `,
              )}
            </div>
          `}
    </section>
  `;
}

function renderEvidence(text: MemoryText, evidence: MemoryEvidenceItem[] | null | undefined) {
  const items = evidence ?? [];
  return html`
    <section class="memory-wiki__rail-card">
      <div class="memory-wiki__rail-header">
        <h4>${text.wikiEvidence}</h4>
        <span>${items.length}</span>
      </div>
      ${items.length === 0
        ? html`<div class="alisio-memory-empty">${text.wikiEvidenceEmpty}</div>`
        : html`
            <div class="memory-wiki__stack">
              ${items.map(
                (item) => html`
                  <article class="memory-wiki__detail-card">
                    <strong
                      >${item.title?.trim() || item.source?.trim() || text.wikiEvidence}</strong
                    >
                    <span>${item.excerpt?.trim() || text.na}</span>
                    ${item.source?.trim() ? html`<span>${item.source}</span>` : nothing}
                  </article>
                `,
              )}
            </div>
          `}
    </section>
  `;
}

function renderRelatedFiles(
  label: string,
  files: MemoryWikiRelatedFile[],
  text: MemoryText,
  onSelectFile: (fileId: string) => void,
) {
  return html`
    <section class="memory-wiki__rail-card">
      <div class="memory-wiki__rail-header">
        <h4>${label}</h4>
        <span>${files.length}</span>
      </div>
      ${files.length === 0
        ? html`<div class="alisio-memory-empty">${text.none}</div>`
        : html`
            <div class="memory-wiki__stack">
              ${files.map(
                (file) => html`
                  <button
                    type="button"
                    class="memory-wiki__mini-link"
                    ?disabled=${!file.id}
                    @click=${() => (file.id ? onSelectFile(file.id) : undefined)}
                  >
                    <strong>${file.name}</strong>
                    <span
                      >${file.provenanceSummary?.trim() || file.mediaType?.trim() || text.na}</span
                    >
                  </button>
                `,
              )}
            </div>
          `}
    </section>
  `;
}

function renderProvenance(
  text: MemoryText,
  rows: Array<{ label: string; value: string }> | null | undefined,
) {
  const entries =
    rows?.filter((row) => row.label.trim() && row.value.trim()).map((row) => ({ ...row })) ?? [];
  return html`
    <section class="memory-wiki__rail-card">
      <div class="memory-wiki__rail-header">
        <h4>${text.wikiProvenance}</h4>
      </div>
      ${entries.length === 0
        ? html`<div class="alisio-memory-empty">${text.wikiProvenanceEmpty}</div>`
        : html`
            <div class="memory-wiki__stack">
              ${entries.map(
                (row) => html`
                  <div class="memory-wiki__kv">
                    <span>${row.label}</span>
                    <strong>${row.value}</strong>
                  </div>
                `,
              )}
            </div>
          `}
    </section>
  `;
}

function renderRevision(text: MemoryText, page: MemoryWikiPage | null) {
  const revision = page?.revision ?? null;
  return html`
    <section class="memory-wiki__rail-card">
      <div class="memory-wiki__rail-header">
        <h4>${text.wikiRevision}</h4>
      </div>
      ${!revision
        ? html`<div class="alisio-memory-empty">${text.na}</div>`
        : html`
            <div class="memory-wiki__stack">
              <strong>${revision.summary?.trim() || revision.eventId || text.wikiRevision}</strong>
              <span>${String(revision.lamport ?? text.na)}</span>
              <span
                >${[formatTimestamp(revision.updatedAt), revision.author]
                  .filter(Boolean)
                  .join(" · ") || text.na}</span
              >
              ${revision.eventId ? html`<span>${revision.eventId}</span>` : nothing}
            </div>
          `}
    </section>
  `;
}

function renderHistory(
  text: MemoryText,
  historyLoading: boolean,
  historyError: string | null,
  history: MemoryWikiHistoryEntry[],
) {
  const entries = buildWikiHistorySummary(history);
  return html`
    <section class="memory-wiki__rail-card">
      <div class="memory-wiki__rail-header">
        <h4>${text.wikiHistory}</h4>
        <span>${history.length}</span>
      </div>
      ${historyLoading && entries.length === 0
        ? html`<div class="alisio-memory-empty">${text.preview}</div>`
        : historyError
          ? html`<div class="callout info">${historyError}</div>`
          : entries.length === 0
            ? html`<div class="alisio-memory-empty">${text.wikiHistoryEmpty}</div>`
            : html`
                <div class="memory-wiki__stack">
                  ${entries.map(
                    (entry) => html`
                      <article class="memory-wiki__detail-card">
                        <strong
                          >${entry.summary?.trim() ||
                          entry.operation?.trim() ||
                          entry.eventId}</strong
                        >
                        <span
                          >${[formatTimestamp(entry.at), entry.author]
                            .filter(Boolean)
                            .join(" · ") || text.na}</span
                        >
                        ${entry.diffSummary ? html`<span>${entry.diffSummary}</span>` : nothing}
                      </article>
                    `,
                  )}
                </div>
              `}
    </section>
  `;
}

function buildArticleMarkdown(markdown: string) {
  const body = markdown.replace(/(?<bang>!?)\[\[([^\]]+)\]\]/g, (match, bang, rawTarget) => {
    if (bang === "!") {
      return match;
    }
    const [target, label] = String(rawTarget).split("|", 2);
    const safeLabel = (label?.trim() || target?.trim() || "")
      .replace(/\[/g, "\\[")
      .replace(/\]/g, "\\]");
    const encodedTarget = encodeURIComponent((target ?? "").trim());
    return `[${safeLabel}](#wiki:${encodedTarget})`;
  });
  return toSanitizedMarkdownHtml(body);
}

function handleArticleClick(event: Event, onOpenWikiTarget: (target: string) => void) {
  const target = event.target instanceof Element ? event.target : null;
  const anchor = target?.closest("a");
  if (!anchor) {
    return;
  }
  const href = anchor.getAttribute("href") ?? "";
  if (href.startsWith("#wiki:")) {
    event.preventDefault();
    onOpenWikiTarget(decodeURIComponent(href.slice("#wiki:".length)));
    return;
  }
  if (
    href.endsWith(".md") ||
    href.startsWith("memory/") ||
    href.startsWith("./memory/") ||
    href.startsWith("../memory/")
  ) {
    event.preventDefault();
    onOpenWikiTarget(href);
  }
}

function renderCreateComposer(params: RenderMemoryWikiViewParams) {
  const text = params.text;
  return html`
    <div class="memory-wiki__create">
      <label class="field">
        <span>${text.wikiCreate}</span>
        <input
          .value=${params.createTitle}
          placeholder=${text.wikiCreatePlaceholder}
          @input=${(event: Event) => params.onCreateTitle((event.target as HTMLInputElement).value)}
        />
      </label>
      <div class="alisio-memory-runtime__actions">
        <button class="btn btn--sm" @click=${() => params.onToggleCreate(false)}>
          ${translateWithFallback("alisio.memory.wiki.cancel", "Cancel")}
        </button>
        <button
          class="btn btn--sm primary"
          ?disabled=${!params.createTitle.trim() || params.pageSaving}
          @click=${() => params.onCreatePage()}
        >
          ${text.wikiCreateConfirm}
        </button>
      </div>
    </div>
  `;
}

function renderSidebarBrand(text: MemoryText, portal: ReturnType<typeof buildWikiPortalModel>) {
  return html`
    <section class="memory-wiki__brand-card">
      <div class="memory-wiki__brand-mark">
        ${buildPortalMonogram(portal.featured?.title ?? portal.pages[0]?.title)}
      </div>
      <div class="memory-wiki__stack">
        <p class="memory-wiki__eyebrow">
          ${translateWithFallback("alisio.memory.wiki.portalEyebrow", "Personal encyclopedia")}
        </p>
        <h3 class="memory-wiki__brand-title">
          ${translateWithFallback("alisio.memory.wiki.portalTitle", "Memory portal")}
        </h3>
        <p class="memory-wiki__brand-body">
          ${translateWithFallback(
            "alisio.memory.wiki.portalBody",
            "Browse ledger-backed pages, follow links, and inspect the evidence behind every article.",
          )}
        </p>
      </div>
      <div class="memory-wiki__brand-grid">
        ${renderCompactStat(
          translateWithFallback("alisio.memory.wiki.pages", "Pages"),
          portal.stats.pages,
        )}
        ${renderCompactStat(text.wikiBacklinks, portal.stats.backlinks)}
        ${renderCompactStat(text.wikiClaims, portal.stats.claims)}
        ${renderCompactStat(text.wikiEvidence, portal.stats.evidence)}
      </div>
    </section>
  `;
}

function renderSidebarPageCard(params: {
  page: ReturnType<typeof buildWikiPortalModel>["pages"][number];
  text: MemoryText;
  selectedPageId: string | null;
  tracesEnabled: boolean;
  onSelectPage: (pageId: string) => void;
  onOpenTrace: (params: OpenTraceParams) => void;
}) {
  const taxonomy = [...params.page.categories, ...params.page.collections].slice(0, 3);
  const metaLeft = params.page.path?.trim() || params.text.na;
  const metaRight =
    typeof params.page.backlinks === "number" && params.page.backlinks > 0
      ? `${params.page.backlinks} ↩`
      : (formatTimestamp(params.page.updatedAt) ?? params.text.na);
  return html`
    <article class="memory-wiki__index-card">
      <button
        type="button"
        class="memory-wiki__index-link ${params.selectedPageId === params.page.id ? "is-active" : ""}"
        aria-current=${params.selectedPageId === params.page.id ? "true" : "false"}
        @click=${() => params.onSelectPage(params.page.id)}
      >
        <div class="memory-wiki__index-meta">
          <span>${metaLeft}</span>
          <span>${metaRight}</span>
        </div>
        <strong>${params.page.title}</strong>
        <p>${params.page.summary}</p>
        <div class="memory-wiki__chip-row">
          ${taxonomy.map((entry) => html`<span class="memory-wiki__chip">${entry}</span>`)}
        </div>
        ${renderReasonTags(params.page.reasonTags)}
      </button>
      ${params.tracesEnabled && (params.page.traceId || params.page.trace)
        ? html`
            <div class="alisio-memory-native__result-actions">
              <button
                type="button"
                class="btn btn--sm"
                @click=${(event: Event) => {
                  event.stopPropagation();
                  params.onOpenTrace({
                    label: params.page.title,
                    traceId: params.page.traceId,
                    trace: params.page.trace,
                    summary: params.page.traceSummary,
                    reasonTags: params.page.reasonTags,
                  });
                }}
              >
                ${params.text.viewTrace}
              </button>
            </div>
          `
        : nothing}
    </article>
  `;
}

function renderSidebar(params: RenderMemoryWikiViewParams) {
  const text = params.text;
  const portal = buildWikiPortalModel(params.wikiList);
  return html`
    <section class="alisio-memory-group memory-wiki__sidebar-group">
      ${renderSidebarBrand(text, portal)}
      <div class="memory-wiki__sidebar-toolbar">
        <div class="alisio-memory-group__header">
          <h2>${text.wikiListTitle}</h2>
          <div class="alisio-memory-runtime__actions">
            <button class="btn btn--sm" @click=${() => params.onGoHome()}>
              ${translateWithFallback("alisio.memory.wiki.portalHome", "Portal")}
            </button>
            <button
              class="btn btn--sm primary"
              @click=${() => params.onToggleCreate(!params.createOpen)}
            >
              ${text.wikiCreate}
            </button>
          </div>
        </div>
      </div>
      ${params.createOpen ? renderCreateComposer(params) : nothing}
      ${portal.featured
        ? html`
            <button
              type="button"
              class="memory-wiki__featured-teaser"
              @click=${() => params.onSelectPage(portal.featured!.id)}
            >
              <span
                >${translateWithFallback("alisio.memory.wiki.featured", "Featured article")}</span
              >
              <strong>${portal.featured.title}</strong>
              <p>${portal.featured.summary}</p>
            </button>
          `
        : nothing}
      ${params.wikiError
        ? html`<div class="callout info">${params.wikiError}</div>`
        : params.wikiLoading && !params.wikiList
          ? html`<div class="alisio-memory-empty">
              ${translateWithFallback("alisio.memory.loading", "Loading")}
            </div>`
          : portal.pages.length === 0
            ? html`<div class="alisio-memory-empty">${text.wikiEmpty}</div>`
            : html`
                <div class="memory-wiki__page-list">
                  ${portal.pages.map((page) =>
                    renderSidebarPageCard({
                      page,
                      text,
                      selectedPageId: params.selectedPageId,
                      tracesEnabled: params.tracesEnabled,
                      onSelectPage: params.onSelectPage,
                      onOpenTrace: params.onOpenTrace,
                    }),
                  )}
                </div>
              `}
    </section>
  `;
}

function renderPortal(params: RenderMemoryWikiViewParams) {
  const portal = buildWikiPortalModel(params.wikiList);
  const text = params.text;
  const labels = {
    portalEyebrow: translateWithFallback(
      "alisio.memory.wiki.portalEyebrow",
      "Personal encyclopedia",
    ),
    portalTitle: translateWithFallback("alisio.memory.wiki.portalTitle", "Memory portal"),
    portalBody: translateWithFallback(
      "alisio.memory.wiki.portalBody",
      "Browse ledger-backed pages, follow links, and inspect the evidence behind every article.",
    ),
    featured: translateWithFallback("alisio.memory.wiki.featured", "Featured article"),
    recent: translateWithFallback("alisio.memory.wiki.recent", "Recent updates"),
    categories: translateWithFallback("alisio.memory.wiki.categories", "Categories"),
    collections: translateWithFallback("alisio.memory.wiki.collections", "Collections"),
  };
  const portalSnapshot =
    portal.stats.pages > 0
      ? `${portal.stats.pages} ${translateWithFallback(
          "alisio.memory.wiki.pages",
          "Pages",
        ).toLowerCase()}`
      : translateWithFallback("alisio.memory.wiki.portalEyebrow", labels.portalEyebrow);

  return html`
    <section class="memory-wiki__portal">
      <header class="memory-wiki__hero">
        <div class="memory-wiki__hero-copy">
          <div class="memory-wiki__article-tabs">
            <span class="memory-wiki__article-tab is-active">
              ${translateWithFallback("alisio.memory.wiki.portalHome", "Portal")}
            </span>
            <span class="memory-wiki__article-tab">${params.text.wikiListTitle}</span>
          </div>
          <p class="memory-wiki__eyebrow">${labels.portalEyebrow}</p>
          <h3>${labels.portalTitle}</h3>
          <p class="memory-wiki__hero-body">${labels.portalBody}</p>
          <div class="memory-wiki__meta-row">
            <span>${portalSnapshot}</span>
            <span>${portal.categories.length} ${labels.categories.toLowerCase()}</span>
            <span>${portal.collections.length} ${labels.collections.toLowerCase()}</span>
          </div>
        </div>
        <div class="memory-wiki__hero-panel">
          <div class="memory-wiki__stats">
            ${renderStat(
              translateWithFallback("alisio.memory.wiki.pages", "Pages"),
              portal.stats.pages,
            )}
            ${renderStat(text.wikiBacklinks, portal.stats.backlinks)}
            ${renderStat(text.wikiClaims, portal.stats.claims)}
            ${renderStat(text.wikiEvidence, portal.stats.evidence)}
          </div>
          <div class="memory-wiki__context">
            <strong>${labels.featured}</strong>
            <span>${portal.featured?.summary || labels.portalBody}</span>
          </div>
        </div>
      </header>

      <div class="memory-wiki__portal-grid memory-wiki__portal-grid--feature">
        <section class="memory-wiki__paper memory-wiki__spotlight">
          <div class="memory-wiki__rail-header">
            <h4>${labels.featured}</h4>
          </div>
          ${portal.featured
            ? html`
                <div class="memory-wiki__spotlight-copy">
                  <span class="memory-wiki__cluster-label">${portal.featured.path?.trim()}</span>
                  <strong class="memory-wiki__feature-title">${portal.featured.title}</strong>
                  <p class="memory-wiki__spotlight-body">${portal.featured.summary}</p>
                  <div class="memory-wiki__chip-row">
                    ${portal.featured.categories
                      .slice(0, 2)
                      .map((entry) => html`<span class="memory-wiki__chip">${entry}</span>`)}
                    ${portal.featured.collections
                      .slice(0, 2)
                      .map((entry) => html`<span class="memory-wiki__chip">${entry}</span>`)}
                  </div>
                  <div class="memory-wiki__meta-row">
                    <span>${portal.featured.path?.trim() || params.text.na}</span>
                    <span>${formatTimestamp(portal.featured.updatedAt) ?? params.text.na}</span>
                  </div>
                  <button
                    class="btn btn--sm primary"
                    @click=${() => params.onSelectPage(portal.featured!.id)}
                  >
                    ${translateWithFallback("alisio.memory.wiki.readArticle", "Read article")}
                  </button>
                </div>
              `
            : html`<div class="alisio-memory-empty">${params.text.wikiNoSelection}</div>`}
        </section>

        <section class="memory-wiki__paper memory-wiki__newsdesk">
          <div class="memory-wiki__rail-header">
            <h4>${labels.recent}</h4>
            <span class="memory-wiki__count-pill">${portal.recentUpdates.length}</span>
          </div>
          <div class="memory-wiki__news-list">
            ${portal.recentUpdates.map(
              (page) => html`
                <button
                  type="button"
                  class="memory-wiki__news-item"
                  @click=${() => params.onSelectPage(page.id)}
                >
                  <div class="memory-wiki__stack">
                    <strong>${page.title}</strong>
                    <span>${page.summary}</span>
                  </div>
                  <span>${formatTimestamp(page.updatedAt) ?? params.text.na}</span>
                </button>
              `,
            )}
          </div>
        </section>
      </div>

      <div class="memory-wiki__portal-grid memory-wiki__portal-grid--discovery">
        <section class="memory-wiki__paper">
          <div class="memory-wiki__rail-header">
            <h4>${labels.categories}</h4>
            <span class="memory-wiki__count-pill">${portal.categories.length}</span>
          </div>
          ${portal.categories.length === 0
            ? html`<div class="alisio-memory-empty">${params.text.none}</div>`
            : html`${portal.categories.map((group) =>
                renderPortalGroup({ group, onSelectPage: params.onSelectPage }),
              )}`}
        </section>
        <section class="memory-wiki__paper">
          <div class="memory-wiki__rail-header">
            <h4>${labels.collections}</h4>
            <span class="memory-wiki__count-pill">${portal.collections.length}</span>
          </div>
          ${portal.collections.length === 0
            ? html`<div class="alisio-memory-empty">${params.text.none}</div>`
            : html`${portal.collections.map((group) =>
                renderPortalGroup({ group, onSelectPage: params.onSelectPage }),
              )}`}
        </section>
      </div>
    </section>
  `;
}

function renderContext(params: RenderMemoryWikiViewParams, page: MemoryWikiPageModel) {
  const preview = page.contextPreview ?? null;
  if (!preview) {
    return nothing;
  }
  return html`
    <section class="memory-wiki__context">
      <strong>${params.text.whySurfaced}</strong>
      <span>${preview.summary?.trim() || params.text.na}</span>
      ${renderReasonTags(preview.reasonTags)}
      ${params.tracesEnabled && (preview.traceId || preview.trace)
        ? html`
            <button
              class="btn btn--sm"
              @click=${() =>
                params.onOpenTrace({
                  label: page.title,
                  traceId: preview.traceId,
                  trace: preview.trace,
                  summary: preview.traceSummary,
                  reasonTags: preview.reasonTags,
                })}
            >
              ${params.text.viewTrace}
            </button>
          `
        : nothing}
    </section>
  `;
}

function renderArticleHighlights(text: MemoryText, page: MemoryWikiPageModel) {
  return html`
    <div class="memory-wiki__article-highlights">
      ${renderCompactStat(text.wikiBacklinks, page.backlinks?.length ?? 0)}
      ${renderCompactStat(text.wikiClaims, page.claims?.length ?? 0)}
      ${renderCompactStat(text.wikiEvidence, page.evidence?.length ?? 0)}
      ${renderCompactStat(
        translateWithFallback("alisio.memory.wiki.relatedFiles", "Related files"),
        page.relatedFiles.length,
      )}
    </div>
  `;
}

function renderArticle(params: RenderMemoryWikiViewParams, page: MemoryWikiPageModel) {
  const labels = {
    home: translateWithFallback("alisio.memory.wiki.portalHome", "Portal"),
    edit: translateWithFallback("alisio.memory.wiki.editSource", "Edit source"),
    hideEditor: translateWithFallback("alisio.memory.wiki.hideEditor", "Hide editor"),
    readMode: translateWithFallback("alisio.memory.wiki.readMode", "Reading view"),
    source: translateWithFallback("alisio.memory.wiki.source", "Source"),
    draftPreview: translateWithFallback("alisio.memory.wiki.draftPreview", "Draft preview"),
    relatedFiles: translateWithFallback("alisio.memory.wiki.relatedFiles", "Related files"),
    overview: translateWithFallback("alisio.memory.wiki.overview", "Overview"),
  };
  return html`
    <article class="memory-wiki__article">
      <header class="memory-wiki__article-header">
        <div class="memory-wiki__article-shell">
          <div class="memory-wiki__article-copy">
            <div class="memory-wiki__breadcrumbs">
              <button type="button" @click=${() => params.onGoHome()}>${labels.home}</button>
              <span>/</span>
              <span>${page.title}</span>
            </div>
            <p class="memory-wiki__eyebrow">${page.path?.trim() || params.text.na}</p>
            <h3>${page.title}</h3>
            <p class="memory-wiki__lede">
              ${page.summary || page.lead || page.path?.trim() || params.text.na}
            </p>
            <div class="memory-wiki__meta-row">
              <span>${page.path?.trim() || params.text.na}</span>
              ${page.revision?.updatedAt
                ? html`<span>${formatTimestamp(page.revision.updatedAt) ?? params.text.na}</span>`
                : nothing}
              ${page.revision?.author ? html`<span>${page.revision.author}</span>` : nothing}
            </div>
            <div class="memory-wiki__chip-row">
              ${[...page.categories, ...page.collections].map(
                (entry) => html`<span class="memory-wiki__chip">${entry}</span>`,
              )}
            </div>
            ${renderReasonTags(page.reasonTags)}
          </div>
          <aside class="memory-wiki__article-facts">
            <div class="memory-wiki__detail-card">
              <span>${labels.source}</span>
              <strong>${page.path?.trim() || params.text.na}</strong>
            </div>
            <div class="memory-wiki__detail-card">
              <span>${params.text.wikiRevision}</span>
              <strong>${page.revision?.eventId || params.text.na}</strong>
            </div>
            <div class="memory-wiki__detail-card">
              <span>${labels.relatedFiles}</span>
              <strong>${String(page.relatedFiles.length)}</strong>
            </div>
            <div class="alisio-memory-runtime__actions">
              <button class="btn btn--sm" @click=${() => params.onGoHome()}>${labels.home}</button>
              ${params.tracesEnabled && (page.traceId || page.trace)
                ? html`
                    <button
                      class="btn btn--sm"
                      @click=${() =>
                        params.onOpenTrace({
                          label: page.title,
                          traceId: page.traceId,
                          trace: page.trace,
                          summary: page.traceSummary,
                          reasonTags: page.reasonTags,
                        })}
                    >
                      ${params.text.viewTrace}
                    </button>
                  `
                : nothing}
              <button
                class="btn btn--sm primary"
                @click=${() => params.onToggleEditor(!params.editorOpen)}
              >
                ${params.editorOpen ? labels.hideEditor : labels.edit}
              </button>
            </div>
          </aside>
        </div>
        <div class="memory-wiki__article-tabs">
          <span class="memory-wiki__article-tab is-active">${labels.readMode}</span>
          <button
            type="button"
            class="memory-wiki__article-tab ${params.editorOpen ? "is-active" : ""}"
            @click=${() => params.onToggleEditor(!params.editorOpen)}
          >
            ${params.editorOpen ? labels.hideEditor : labels.edit}
          </button>
        </div>
        ${renderArticleHighlights(params.text, page)}
      </header>

      ${renderContext(params, page)}

      <div class="memory-wiki__article-layout">
        <section class="memory-wiki__article-body">
          ${page.headings.length > 0
            ? html`
                <nav class="memory-wiki__toc">
                  <strong>${labels.overview}</strong>
                  <div class="memory-wiki__toc-links">
                    ${page.headings.map(
                      (heading: MemoryWikiHeading) =>
                        html`<a href=${`#${heading.anchor}`}>${heading.label}</a>`,
                    )}
                  </div>
                </nav>
              `
            : nothing}

          <section
            class="memory-wiki__paper memory-wiki__article-markdown sidebar-markdown"
            @click=${(event: Event) => handleArticleClick(event, params.onOpenWikiTarget)}
          >
            ${unsafeHTML(buildArticleMarkdown(page.body))}
          </section>

          ${params.editorOpen
            ? html`
                <section class="memory-wiki__editor">
                  <div class="memory-wiki__rail-header">
                    <h4>${params.text.wikiEditorTitle}</h4>
                    ${params.pageDirty
                      ? html`<span class="alisio-memory-badge">${params.text.unsaved}</span>`
                      : html`<span>${labels.readMode}</span>`}
                  </div>
                  <label class="field">
                    <span>${params.text.wikiEditorTitle}</span>
                    <input
                      .value=${params.currentPageTitleDraft}
                      @input=${(event: Event) =>
                        params.onSetPageTitleDraft((event.target as HTMLInputElement).value)}
                    />
                  </label>
                  <label class="field">
                    <span>${labels.source}</span>
                    <textarea
                      class="alisio-memory-textarea memory-wiki__textarea"
                      .value=${params.currentPageDraft}
                      @input=${(event: Event) =>
                        params.onSetPageDraft((event.target as HTMLTextAreaElement).value)}
                    ></textarea>
                  </label>
                  <div class="alisio-memory-runtime__actions">
                    <button
                      class="btn btn--sm"
                      ?disabled=${!params.pageDirty || params.pageSaving}
                      @click=${() => params.onResetPage()}
                    >
                      ${params.text.reset}
                    </button>
                    <button
                      class="btn btn--sm primary"
                      ?disabled=${!params.pageDirty || params.pageSaving}
                      @click=${() => params.onSavePage()}
                    >
                      ${params.pageSaving ? params.text.saving : params.text.save}
                    </button>
                  </div>
                  <details class="memory-wiki__draft-preview">
                    <summary>${labels.draftPreview}</summary>
                    ${params.currentPageDraft.trim()
                      ? html`
                          <div
                            class="memory-wiki__paper sidebar-markdown"
                            @click=${(event: Event) =>
                              handleArticleClick(event, params.onOpenWikiTarget)}
                          >
                            ${unsafeHTML(buildArticleMarkdown(params.currentPageDraft))}
                          </div>
                        `
                      : html`<div class="alisio-memory-empty">${params.text.previewEmpty}</div>`}
                  </details>
                </section>
              `
            : nothing}
        </section>

        <aside class="memory-wiki__rail">
          ${renderRevision(params.text, page)}
          ${renderBacklinks(
            params.text,
            page.backlinks,
            params.onSelectPage,
            params.onOpenWikiTarget,
          )}
          ${renderRelatedFiles(
            labels.relatedFiles,
            page.relatedFiles,
            params.text,
            params.onSelectFile,
          )}
          ${renderClaims(params.text, page.claims)} ${renderEvidence(params.text, page.evidence)}
          ${renderProvenance(params.text, page.provenance)}
          ${renderHistory(params.text, params.historyLoading, params.historyError, params.history)}
        </aside>
      </div>
    </article>
  `;
}

export function renderMemoryWikiView(params: RenderMemoryWikiViewParams) {
  const portal = buildWikiPortalModel(params.wikiList);
  const page =
    params.page && params.selectedPageId ? asWikiPageModel(params.page, portal.pages) : null;

  return html`
    <style>
      .memory-wiki__sidebar-group,
      .memory-wiki__paper,
      .memory-wiki__article,
      .memory-wiki__rail-card,
      .memory-wiki__editor,
      .memory-wiki__portal {
        position: relative;
        display: grid;
        align-content: start;
        gap: 16px;
        min-width: 0;
        overflow: hidden;
        padding: 22px;
        color: var(--text);
        border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
        border-radius: 20px;
        background:
          radial-gradient(
            circle at top right,
            color-mix(in srgb, var(--accent) 10%, transparent),
            transparent 34%
          ),
          linear-gradient(
            180deg,
            color-mix(in srgb, var(--card) 94%, transparent),
            color-mix(in srgb, var(--panel) 98%, transparent)
          );
        box-shadow: var(--shadow-md);
      }
      .memory-wiki__sidebar-group::before,
      .memory-wiki__paper::before,
      .memory-wiki__article::before,
      .memory-wiki__rail-card::before,
      .memory-wiki__editor::before,
      .memory-wiki__portal::before {
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(
          180deg,
          rgba(255, 255, 255, 0.02),
          transparent 72%
        );
        pointer-events: none;
      }
      .memory-wiki__hero,
      .memory-wiki__article-header {
        display: grid;
        gap: 20px;
      }
      .memory-wiki__eyebrow,
      .memory-wiki__breadcrumbs {
        margin: 0;
        color: var(--muted);
        font-size: 0.76rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .memory-wiki__breadcrumbs {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .memory-wiki__breadcrumbs button {
        border: none;
        padding: 0;
        background: transparent;
        color: inherit;
        cursor: pointer;
      }
      .memory-wiki__hero-copy,
      .memory-wiki__hero-panel,
      .memory-wiki__spotlight-copy,
      .memory-wiki__article-shell,
      .memory-wiki__article-facts,
      .memory-wiki__brand-card,
      .memory-wiki__brand-grid,
      .memory-wiki__page-list,
      .memory-wiki__news-list,
      .memory-wiki__article-highlights,
      .memory-wiki__sidebar-toolbar {
        display: grid;
        gap: 14px;
      }
      .memory-wiki__brand-card {
        background:
          radial-gradient(
            circle at top right,
            color-mix(in srgb, var(--accent) 16%, transparent),
            transparent 42%
          ),
          linear-gradient(
            180deg,
            color-mix(in srgb, var(--accent) 7%, var(--card)),
            color-mix(in srgb, var(--panel) 96%, transparent)
          );
        border-color: color-mix(in srgb, var(--accent) 18%, var(--border));
      }
      .memory-wiki__brand-mark {
        display: inline-grid;
        place-items: center;
        width: 68px;
        height: 68px;
        border-radius: 999px;
        border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--border));
        background: color-mix(in srgb, var(--accent) 12%, var(--card));
        color: color-mix(in srgb, var(--accent) 72%, var(--text));
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif;
        font-size: 2rem;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
      }
      .memory-wiki__brand-title,
      .memory-wiki__hero h3,
      .memory-wiki__article h3,
      .memory-wiki__cluster-header h5 {
        margin: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif;
        line-height: 1.08;
      }
      .memory-wiki__brand-title {
        font-size: 1.65rem;
      }
      .memory-wiki__brand-body,
      .memory-wiki__hero-body,
      .memory-wiki__spotlight-body {
        margin: 0;
        color: var(--muted);
        line-height: 1.65;
      }
      .memory-wiki__stats,
      .memory-wiki__portal-grid,
      .memory-wiki__article-layout {
        display: grid;
        gap: 18px;
      }
      .memory-wiki__stats {
        grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
      }
      .memory-wiki__stat {
        display: grid;
        gap: 8px;
        min-width: 0;
        padding: 16px;
        border-radius: 16px;
        background: color-mix(in srgb, var(--card) 92%, transparent);
        border: 1px solid color-mix(in srgb, var(--border) 90%, transparent);
      }
      .memory-wiki__stat span {
        font-size: 0.78rem;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .memory-wiki__stat strong {
        font-size: 1.5rem;
        color: var(--text-strong);
      }
      .memory-wiki__compact-stat {
        display: grid;
        gap: 4px;
        padding: 14px 16px;
        border-radius: 14px;
        border: 1px solid color-mix(in srgb, var(--border) 90%, transparent);
        background: color-mix(in srgb, var(--bg-hover) 66%, var(--card));
      }
      .memory-wiki__compact-stat strong {
        font-size: 1.15rem;
        color: var(--text-strong);
      }
      .memory-wiki__compact-stat span {
        color: var(--muted);
        font-size: 0.78rem;
      }
      .memory-wiki__portal-grid {
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 16px;
      }
      .memory-wiki__portal-grid--feature {
        grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.9fr);
      }
      .memory-wiki__portal-grid--discovery {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: start;
      }
      .memory-wiki__featured-teaser,
      .memory-wiki__mini-link,
      .memory-wiki__cluster-lead,
      .memory-wiki__news-item,
      .memory-wiki__index-link {
        display: grid;
        gap: 8px;
        width: 100%;
        border: 1px solid color-mix(in srgb, var(--border) 92%, transparent);
        border-radius: 16px;
        padding: 16px 18px;
        background: color-mix(in srgb, var(--bg-hover) 72%, var(--card));
        color: var(--text);
        text-align: left;
        transition:
          transform 160ms ease,
          border-color 160ms ease,
          background 160ms ease;
        cursor: pointer;
      }
      .memory-wiki__featured-teaser:hover,
      .memory-wiki__mini-link:hover,
      .memory-wiki__cluster-lead:hover,
      .memory-wiki__news-item:hover,
      .memory-wiki__index-link:hover {
        transform: translateY(-1px);
        border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
        background: color-mix(in srgb, var(--accent) 7%, var(--card));
      }
      .memory-wiki__featured-teaser span,
      .memory-wiki__mini-link span,
      .memory-wiki__meta-row,
      .memory-wiki__detail-card span,
      .memory-wiki__news-item > span,
      .memory-wiki__index-link p,
      .memory-wiki__cluster-label {
        color: var(--muted);
      }
      .memory-wiki__featured-teaser p {
        margin: 0;
      }
      .memory-wiki__featured-teaser {
        background:
          linear-gradient(
            180deg,
            color-mix(in srgb, var(--accent) 11%, var(--card)),
            color-mix(in srgb, var(--accent) 4%, var(--panel))
          );
        border-color: color-mix(in srgb, var(--accent) 22%, var(--border));
      }
      .memory-wiki__meta-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        color: var(--muted);
        font-size: 0.82rem;
        line-height: 1.45;
      }
      .memory-wiki__article h3 {
        font-size: clamp(2.2rem, 3vw, 3rem);
        color: var(--text-strong);
      }
      .memory-wiki__hero h3 {
        font-size: clamp(2.3rem, 3.4vw, 3.15rem);
        color: var(--text-strong);
      }
      .memory-wiki__article-copy,
      .memory-wiki__stack,
      .memory-wiki__detail-card,
      .memory-wiki__kv,
      .memory-wiki__context,
      .memory-wiki__toc {
        display: grid;
        gap: 10px;
      }
      .memory-wiki__hero {
        grid-template-columns: minmax(0, 1.18fr) minmax(300px, 0.82fr);
        align-items: start;
      }
      .memory-wiki__article-shell {
        grid-template-columns: minmax(0, 1.5fr) minmax(240px, 0.82fr);
        align-items: start;
      }
      .memory-wiki__article-layout {
        grid-template-columns: minmax(0, 1.75fr) minmax(280px, 0.95fr);
        align-items: start;
        gap: 16px;
      }
      .memory-wiki__article-body {
        display: grid;
        gap: 16px;
      }
      .memory-wiki__article-highlights {
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      }
      .memory-wiki__article-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .memory-wiki__article-tab {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 36px;
        padding: 0 14px;
        border-radius: 999px;
        border: 1px solid color-mix(in srgb, var(--border) 90%, transparent);
        background: color-mix(in srgb, var(--bg-hover) 72%, var(--card));
        color: var(--muted);
        font-size: 0.86rem;
      }
      .memory-wiki__article-tab.is-active {
        background: color-mix(in srgb, var(--accent) 12%, var(--card));
        border-color: color-mix(in srgb, var(--accent) 28%, var(--border));
        color: var(--text-strong);
      }
      .memory-wiki__article-markdown {
        line-height: 1.72;
        position: relative;
        background:
          linear-gradient(
            180deg,
            color-mix(in srgb, var(--card) 96%, transparent),
            color-mix(in srgb, var(--panel) 98%, transparent)
          );
        border-color: color-mix(in srgb, var(--border) 92%, transparent);
      }
      .memory-wiki__article-markdown > p:first-of-type::first-letter {
        float: left;
        margin: 0.02em 0.12em 0 0;
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif;
        font-size: 3.4rem;
        line-height: 0.9;
        color: color-mix(in srgb, var(--accent) 74%, var(--text-strong));
      }
      .memory-wiki__article-markdown h1,
      .memory-wiki__article-markdown h2,
      .memory-wiki__article-markdown h3,
      .memory-wiki__article-markdown h4 {
        scroll-margin-top: 84px;
        color: var(--text-strong);
      }
      .memory-wiki__article-markdown a {
        color: var(--accent);
      }
      .memory-wiki__toc-links {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .memory-wiki__toc-links a {
        color: inherit;
        text-decoration: none;
        border-bottom: 1px solid color-mix(in srgb, currentColor 30%, transparent);
      }
      .memory-wiki__rail {
        display: grid;
        gap: 14px;
      }
      .memory-wiki__rail-header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
      }
      .memory-wiki__rail-header h4 {
        margin: 0;
        color: var(--text-strong);
      }
      .memory-wiki__detail-card,
      .memory-wiki__context,
      .memory-wiki__kv,
      .memory-wiki__create,
      .memory-wiki__portal-cluster,
      .memory-wiki__article-facts {
        border-radius: 16px;
        padding: 14px;
        background: color-mix(in srgb, var(--bg-hover) 66%, var(--card));
        border: 1px solid color-mix(in srgb, var(--border) 90%, transparent);
      }
      .memory-wiki__context {
        margin-top: 0;
      }
      .memory-wiki__cluster-header {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: 16px;
      }
      .memory-wiki__cluster-header h5 {
        font-size: 1.22rem;
        color: var(--text-strong);
      }
      .memory-wiki__cluster-label {
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .memory-wiki__count-pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 36px;
        height: 32px;
        padding: 0 10px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--accent) 12%, var(--card));
        color: color-mix(in srgb, var(--accent) 64%, var(--text));
        font-size: 0.8rem;
        border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--border));
      }
      .memory-wiki__chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .memory-wiki__chip {
        display: inline-flex;
        align-items: center;
        padding: 0 10px;
        min-height: 28px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--accent) 10%, var(--card));
        color: color-mix(in srgb, var(--accent) 62%, var(--text));
        font-size: 0.78rem;
        border: 1px solid color-mix(in srgb, var(--accent) 16%, var(--border));
      }
      .memory-wiki__spotlight {
        background:
          radial-gradient(
            circle at top right,
            color-mix(in srgb, var(--accent) 14%, transparent),
            transparent 42%
          ),
          linear-gradient(
            180deg,
            color-mix(in srgb, var(--accent) 9%, var(--card)),
            color-mix(in srgb, var(--panel) 96%, transparent)
          );
        border-color: color-mix(in srgb, var(--accent) 20%, var(--border));
      }
      .memory-wiki__news-item {
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: start;
      }
      .memory-wiki__index-card {
        display: grid;
        gap: 10px;
      }
      .memory-wiki__index-link {
        padding: 18px;
      }
      .memory-wiki__index-link.is-active {
        border-color: color-mix(in srgb, var(--accent) 34%, var(--border));
        background: color-mix(in srgb, var(--accent) 10%, var(--card));
        box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 16%, transparent);
      }
      .memory-wiki__index-link p {
        margin: 0;
        line-height: 1.58;
        color: var(--muted);
      }
      .memory-wiki__index-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        color: var(--muted);
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .memory-wiki__featured-teaser strong,
      .memory-wiki__cluster-lead strong,
      .memory-wiki__news-item strong,
      .memory-wiki__index-link strong,
      .memory-wiki__detail-card strong {
        line-height: 1.25;
        color: var(--text-strong);
      }
      .memory-wiki__textarea {
        min-height: 280px;
      }
      .memory-wiki__draft-preview summary {
        cursor: pointer;
        color: var(--text-strong);
      }
      .memory-wiki__lede {
        margin: 0;
        font-size: 1.08rem;
        line-height: 1.7;
        color: color-mix(in srgb, var(--text) 94%, transparent);
      }
      .memory-wiki__toc {
        padding: 16px 18px;
        border-radius: 18px;
        border: 1px solid color-mix(in srgb, var(--border) 90%, transparent);
        background: color-mix(in srgb, var(--bg-hover) 68%, var(--card));
      }
      .memory-wiki__sidebar-group {
        gap: 18px;
      }
      @media (max-width: 1280px) {
        .memory-wiki__hero,
        .memory-wiki__article-shell,
        .memory-wiki__portal-grid--feature,
        .memory-wiki__portal-grid--discovery {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 1080px) {
        .memory-wiki__article-layout {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 720px) {
        .memory-wiki__sidebar-group,
        .memory-wiki__paper,
        .memory-wiki__article,
        .memory-wiki__rail-card,
        .memory-wiki__editor,
        .memory-wiki__portal {
          padding: 18px;
        }
        .memory-wiki__stats,
        .memory-wiki__article-highlights {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .memory-wiki__news-item,
        .memory-wiki__news-item {
          grid-template-columns: 1fr;
        }
        .memory-wiki__index-meta {
          flex-direction: column;
          align-items: flex-start;
        }
      }
    </style>
    <div class="alisio-memory-shell">
      <aside class="alisio-memory-sidebar">${renderSidebar(params)}</aside>
      <div class="alisio-memory-main">
        ${params.pageError ? html`<div class="callout info">${params.pageError}</div>` : nothing}
        ${params.pageLoading && !page
          ? html`<section class="memory-wiki__paper">
              ${translateWithFallback("alisio.memory.loading", "Loading")}
            </section>`
          : page
            ? renderArticle(params, page)
            : renderPortal(params)}
      </div>
    </div>
  `;
}
