import { html, nothing, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { t } from "../../../i18n/index.ts";
import { formatRelativeTimestamp } from "../../format.ts";
import { toSanitizedMarkdownHtml } from "../../markdown.ts";
import type {
  MemoryClaimItem,
  MemoryEvidenceItem,
  MemoryReasonTag,
  MemoryWikiBacklink,
  MemoryWikiHistoryEntry,
  MemoryWikiListResult,
  MemoryWikiPage,
} from "../../controllers/memory-runtime.ts";
import {
  asWikiPageModel,
  buildWikiHistorySummary,
  buildWikiPortalModel,
  type MemoryWikiHeading,
  type MemoryWikiPageModel,
  type MemoryWikiPortalGroup,
  type MemoryWikiRelatedFile,
} from "../../controllers/memory-wiki-model.ts";

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
  legacyTitle: string;
  legacyBody: string;
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
  searchResultsVisible: boolean;
  createOpen: boolean;
  createTitle: string;
  pageSaving: boolean;
  pageDirty: boolean;
  currentPageDraft: string;
  currentPageTitleDraft: string;
  editorOpen: boolean;
  legacyEditorEnabled: boolean;
  legacyEditor?: TemplateResult;
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

function renderPortalGroup(params: {
  group: MemoryWikiPortalGroup;
  onSelectPage: (pageId: string) => void;
}) {
  return html`
    <section class="memory-wiki__rail-card">
      <div class="memory-wiki__rail-header">
        <h4>${translatePortalGroupName(params.group.name)}</h4>
        <span>${params.group.pages.length}</span>
      </div>
      <div class="memory-wiki__stack">
        ${params.group.pages.map(
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
    </section>
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
                      ? html`<span
                          >${text.confidenceLabel}: ${String(claim.confidence)}</span
                        >`
                      : nothing}
                    ${(claim.evidence ?? []).slice(0, 2).map(
                      (evidence) =>
                        html`<span>${evidence.excerpt?.trim() || evidence.title?.trim() || text.na}</span>`,
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
                    <strong>${item.title?.trim() || item.source?.trim() || text.wikiEvidence}</strong>
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
                    <span>${file.provenanceSummary?.trim() || file.mediaType?.trim() || text.na}</span>
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
              <span>${[formatTimestamp(revision.updatedAt), revision.author].filter(Boolean).join(" · ") || text.na}</span>
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
                        <strong>${entry.summary?.trim() || entry.operation?.trim() || entry.eventId}</strong>
                        <span>${[formatTimestamp(entry.at), entry.author].filter(Boolean).join(" · ") || text.na}</span>
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
    const safeLabel = (label?.trim() || target?.trim() || "").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
    const encodedTarget = encodeURIComponent((target ?? "").trim());
    return `[${safeLabel}](#wiki:${encodedTarget})`;
  });
  return toSanitizedMarkdownHtml(body);
}

function handleArticleClick(
  event: Event,
  onOpenWikiTarget: (target: string) => void,
) {
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
          @input=${(event: Event) =>
            params.onCreateTitle((event.target as HTMLInputElement).value)}
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

function renderSidebar(params: RenderMemoryWikiViewParams) {
  const text = params.text;
  const portal = buildWikiPortalModel(params.wikiList);
  return html`
    <section class="alisio-memory-group memory-wiki__sidebar-group">
      <div class="alisio-memory-group__header">
        <h2>${text.wikiListTitle}</h2>
        <div class="alisio-memory-runtime__actions">
          <button class="btn btn--sm" @click=${() => params.onGoHome()}>
            ${translateWithFallback("alisio.memory.wiki.portalHome", "Portal")}
          </button>
          <button class="btn btn--sm primary" @click=${() => params.onToggleCreate(!params.createOpen)}>
            ${text.wikiCreate}
          </button>
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
              <span>${translateWithFallback("alisio.memory.wiki.featured", "Featured article")}</span>
              <strong>${portal.featured.title}</strong>
              <p>${portal.featured.summary}</p>
            </button>
          `
        : nothing}
      ${params.wikiError
        ? html`<div class="callout info">${params.wikiError}</div>`
        : params.wikiLoading && !params.wikiList
          ? html`<div class="alisio-memory-empty">${translateWithFallback("alisio.memory.loading", "Loading")}</div>`
          : portal.pages.length === 0
            ? html`<div class="alisio-memory-empty">${text.wikiEmpty}</div>`
            : html`
                <div class="alisio-memory-file-list">
                  ${portal.pages.map(
                    (page) => html`
                      <article class="alisio-memory-native__result-card">
                        <button
                          type="button"
                          class="alisio-memory-file ${params.selectedPageId === page.id ? "is-active" : ""}"
                          aria-current=${params.selectedPageId === page.id ? "true" : "false"}
                          @click=${() => params.onSelectPage(page.id)}
                        >
                          <span class="alisio-memory-file__copy">
                            <span class="alisio-memory-file__title">${page.title}</span>
                            <span class="alisio-memory-file__meta">${page.summary}</span>
                            ${renderReasonTags(page.reasonTags)}
                          </span>
                          <span class="alisio-memory-file__status">
                            ${typeof page.backlinks === "number"
                              ? `${page.backlinks} ↩`
                              : (formatTimestamp(page.updatedAt) ?? text.na)}
                          </span>
                        </button>
                        ${params.tracesEnabled &&
                        params.searchResultsVisible &&
                        (page.traceId || page.trace)
                          ? html`
                              <div class="alisio-memory-native__result-actions">
                                <button
                                  type="button"
                                  class="btn btn--sm"
                                  @click=${(event: Event) => {
                                    event.stopPropagation();
                                    params.onOpenTrace({
                                      label: page.title,
                                      traceId: page.traceId,
                                      trace: page.trace,
                                      summary: page.traceSummary,
                                      reasonTags: page.reasonTags,
                                    });
                                  }}
                                >
                                  ${text.viewTrace}
                                </button>
                              </div>
                            `
                          : nothing}
                      </article>
                    `,
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
    portalEyebrow: translateWithFallback("alisio.memory.wiki.portalEyebrow", "Personal encyclopedia"),
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

  return html`
    <section class="memory-wiki__portal">
      <header class="memory-wiki__hero">
        <div>
          <p class="memory-wiki__eyebrow">${labels.portalEyebrow}</p>
          <h3>${labels.portalTitle}</h3>
          <p>${labels.portalBody}</p>
        </div>
        <div class="memory-wiki__stats">
          ${renderStat(translateWithFallback("alisio.memory.wiki.pages", "Pages"), portal.stats.pages)}
          ${renderStat(text.wikiBacklinks, portal.stats.backlinks)}
          ${renderStat(text.wikiClaims, portal.stats.claims)}
          ${renderStat(text.wikiEvidence, portal.stats.evidence)}
        </div>
      </header>

      <div class="memory-wiki__portal-grid">
        <section class="memory-wiki__paper">
          <div class="memory-wiki__rail-header">
            <h4>${labels.featured}</h4>
          </div>
          ${portal.featured
            ? html`
                <div class="memory-wiki__stack">
                  <strong class="memory-wiki__feature-title">${portal.featured.title}</strong>
                  <p>${portal.featured.summary}</p>
                  <div class="memory-wiki__meta-row">
                    <span>${portal.featured.path?.trim() || params.text.na}</span>
                    <span>${formatTimestamp(portal.featured.updatedAt) ?? params.text.na}</span>
                  </div>
                  <button class="btn btn--sm primary" @click=${() => params.onSelectPage(portal.featured!.id)}>
                    ${translateWithFallback("alisio.memory.wiki.readArticle", "Read article")}
                  </button>
                </div>
              `
            : html`<div class="alisio-memory-empty">${params.text.wikiNoSelection}</div>`}
        </section>

        <section class="memory-wiki__paper">
          <div class="memory-wiki__rail-header">
            <h4>${labels.recent}</h4>
          </div>
          <div class="memory-wiki__stack">
            ${portal.recentUpdates.map(
              (page) => html`
                <button
                  type="button"
                  class="memory-wiki__mini-link"
                  @click=${() => params.onSelectPage(page.id)}
                >
                  <strong>${page.title}</strong>
                  <span>${formatTimestamp(page.updatedAt) ?? params.text.na}</span>
                </button>
              `,
            )}
          </div>
        </section>
      </div>

      <div class="memory-wiki__portal-grid">
        <section class="memory-wiki__paper">
          <div class="memory-wiki__rail-header">
            <h4>${labels.categories}</h4>
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
        <div class="memory-wiki__article-copy">
          <div class="memory-wiki__breadcrumbs">
            <button type="button" @click=${() => params.onGoHome()}>${labels.home}</button>
            <span>/</span>
            <span>${page.title}</span>
          </div>
          <h3>${page.title}</h3>
          <p class="memory-wiki__lede">${page.summary || page.lead || page.path?.trim() || params.text.na}</p>
          <div class="memory-wiki__meta-row">
            <span>${page.path?.trim() || params.text.na}</span>
            ${page.revision?.updatedAt
              ? html`<span>${formatTimestamp(page.revision.updatedAt) ?? params.text.na}</span>`
              : nothing}
          </div>
          ${renderReasonTags(page.reasonTags)}
          ${renderReasonTags(
            [...page.categories, ...page.collections].map((entry) => ({
              code: entry.toLowerCase().replace(/\s+/g, "-"),
              label: entry,
            })),
          )}
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
          <button class="btn btn--sm primary" @click=${() => params.onToggleEditor(!params.editorOpen)}>
            ${params.editorOpen ? labels.hideEditor : labels.edit}
          </button>
        </div>
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
                            @click=${(event: Event) => handleArticleClick(event, params.onOpenWikiTarget)}
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
          ${renderRelatedFiles(labels.relatedFiles, page.relatedFiles, params.text, params.onSelectFile)}
          ${renderClaims(params.text, page.claims)}
          ${renderEvidence(params.text, page.evidence)}
          ${renderProvenance(params.text, page.provenance)}
          ${renderHistory(params.text, params.historyLoading, params.historyError, params.history)}
          ${params.legacyEditorEnabled && params.legacyEditor
            ? html`
                <details class="memory-wiki__rail-card">
                  <summary>${params.text.legacyTitle}</summary>
                  <p>${params.text.legacyBody}</p>
                  ${params.legacyEditor}
                </details>
              `
            : nothing}
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
        border: 1px solid color-mix(in srgb, var(--border-subtle) 82%, transparent);
        border-radius: 22px;
        background:
          linear-gradient(
            180deg,
            color-mix(in srgb, var(--surface-elevated) 82%, rgba(255, 255, 255, 0.02)),
            color-mix(in srgb, var(--surface-panel) 88%, rgba(255, 255, 255, 0.01))
          );
        box-shadow: 0 18px 48px rgba(7, 11, 22, 0.12);
      }
      .memory-wiki__portal,
      .memory-wiki__article,
      .memory-wiki__editor,
      .memory-wiki__paper,
      .memory-wiki__rail-card,
      .memory-wiki__sidebar-group {
        padding: 20px;
      }
      .memory-wiki__hero,
      .memory-wiki__article-header {
        display: grid;
        gap: 18px;
      }
      .memory-wiki__eyebrow,
      .memory-wiki__breadcrumbs {
        margin: 0;
        color: color-mix(in srgb, currentColor 58%, transparent);
        font-size: 0.8rem;
        letter-spacing: 0.08em;
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
      .memory-wiki__stats,
      .memory-wiki__portal-grid,
      .memory-wiki__article-layout {
        display: grid;
        gap: 18px;
      }
      .memory-wiki__stats {
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      }
      .memory-wiki__stat {
        display: grid;
        gap: 6px;
        border-radius: 18px;
        padding: 14px;
        background: color-mix(in srgb, var(--accent-primary) 9%, var(--surface-elevated));
      }
      .memory-wiki__stat span {
        font-size: 0.82rem;
        color: color-mix(in srgb, currentColor 60%, transparent);
      }
      .memory-wiki__stat strong {
        font-size: 1.3rem;
      }
      .memory-wiki__portal-grid {
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        margin-top: 18px;
      }
      .memory-wiki__featured-teaser,
      .memory-wiki__mini-link {
        display: grid;
        gap: 6px;
        width: 100%;
        border: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);
        border-radius: 18px;
        padding: 14px 16px;
        background: color-mix(in srgb, var(--surface-elevated) 76%, transparent);
        text-align: left;
      }
      .memory-wiki__featured-teaser span,
      .memory-wiki__mini-link span,
      .memory-wiki__meta-row,
      .memory-wiki__detail-card span {
        color: color-mix(in srgb, currentColor 68%, transparent);
      }
      .memory-wiki__featured-teaser p {
        margin: 0;
      }
      .memory-wiki__meta-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        font-size: 0.9rem;
      }
      .memory-wiki__feature-title,
      .memory-wiki__article h3 {
        margin: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif;
      }
      .memory-wiki__article h3 {
        font-size: clamp(2rem, 3vw, 2.7rem);
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
      .memory-wiki__article-layout {
        grid-template-columns: minmax(0, 1.75fr) minmax(280px, 0.95fr);
        align-items: start;
        margin-top: 20px;
      }
      .memory-wiki__article-body {
        display: grid;
        gap: 18px;
      }
      .memory-wiki__article-markdown {
        line-height: 1.72;
      }
      .memory-wiki__article-markdown h1,
      .memory-wiki__article-markdown h2,
      .memory-wiki__article-markdown h3,
      .memory-wiki__article-markdown h4 {
        scroll-margin-top: 84px;
      }
      .memory-wiki__article-markdown a {
        color: var(--accent-primary);
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
      }
      .memory-wiki__detail-card,
      .memory-wiki__context,
      .memory-wiki__kv,
      .memory-wiki__create {
        border-radius: 16px;
        padding: 14px;
        background: color-mix(in srgb, var(--surface-elevated) 78%, transparent);
      }
      .memory-wiki__context {
        margin-top: 16px;
      }
      .memory-wiki__textarea {
        min-height: 280px;
      }
      .memory-wiki__draft-preview summary {
        cursor: pointer;
      }
      .memory-wiki__lede {
        margin: 0;
        font-size: 1.05rem;
      }
      @media (max-width: 1080px) {
        .memory-wiki__article-layout {
          grid-template-columns: 1fr;
        }
      }
    </style>
    <div class="alisio-memory-shell">
      <aside class="alisio-memory-sidebar">${renderSidebar(params)}</aside>
      <div class="alisio-memory-main">
        ${params.pageError ? html`<div class="callout info">${params.pageError}</div>` : nothing}
        ${params.pageLoading && !page
          ? html`<section class="memory-wiki__paper">${translateWithFallback("alisio.memory.loading", "Loading")}</section>`
          : page
            ? renderArticle(params, page)
            : renderPortal(params)}
      </div>
    </div>
  `;
}
