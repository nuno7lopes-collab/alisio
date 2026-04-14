import { html, nothing, type TemplateResult } from "lit";
import {
  buildMemoryFileActionModel,
  buildMemoryFilePreviewModel,
  formatMemoryFilePreviewKind,
} from "../../controllers/memory-files-preview.ts";
import type {
  MemoryFileDetail,
  MemoryFileLink,
  MemoryFilesListResult,
  MemoryReasonTag,
} from "../../controllers/memory-runtime.ts";
import { icons } from "../../icons.ts";
import { renderSkeletonLines, renderSkeletonListItem } from "../loading-skeleton.ts";
import { renderMemoryFilePreview } from "./files-preview.ts";

type MemoryFileListEntry = MemoryFilesListResult["files"][number];

type MemoryText = {
  none: string;
  na: string;
  preview: string;
  previewEmpty: string;
  viewTrace: string;
  traceTitle: string;
  filesTitle: string;
  filesEmpty: string;
  filesProvenance: string;
  filesRelatedPages: string;
  filesMediaType: string;
  filesSize: string;
  filesUpdated: string;
  filesSummary: string;
  filesHash: string;
  filesPreviewKind: string;
  filesOpen: string;
  filesDownload: string;
  filesOpenPage: string;
  filesFocusGraph: string;
  filesPreviewUnavailable: string;
  filesPreviewTruncated: string;
  filesNoSelection: string;
  filesAttached: string;
  filesMentioned: string;
  filesUnlinked: string;
};

type OpenTraceParams = {
  label: string;
  traceId?: string | null;
  trace?: unknown;
  summary?: string[] | null;
  reasonTags?: MemoryReasonTag[] | null;
};

export type RenderMemoryFilesViewParams = {
  text: MemoryText;
  filesLoading: boolean;
  filesError: string | null;
  filesList: MemoryFilesListResult | null;
  selectedFileId: string | null;
  fileLoading: boolean;
  fileError: string | null;
  fileDetail: MemoryFileDetail | null;
  renderReasonTags: (
    tags: readonly MemoryReasonTag[] | null | undefined,
  ) => TemplateResult | typeof nothing;
  renderProvenance: (
    rows: Array<{ label: string; value: string }> | null | undefined,
    emptyLabel: string,
  ) => TemplateResult;
  renderTraceAction: (params: OpenTraceParams) => TemplateResult | typeof nothing;
  formatBytes: (value: number | null | undefined) => string | null;
  formatTimestamp: (value: string | null | undefined) => string | null;
  onSelectFile: (fileId: string) => void;
  onOpenAttachment: () => void;
  onDownloadAttachment: () => void;
  onOpenWikiPage: (pageId: string) => void;
  onFocusGraphPage: (pageId: string) => void;
};

type FilesGroup = {
  id: "attached" | "mentioned" | "unlinked";
  label: string;
  items: MemoryFileListEntry[];
};

function resolveRelationLabel(
  text: Pick<MemoryText, "filesAttached" | "filesMentioned" | "filesUnlinked">,
  relation: MemoryFileLink["relation"] | null | undefined,
) {
  switch (relation) {
    case "attached":
      return text.filesAttached;
    case "mentioned":
      return text.filesMentioned;
    default:
      return text.filesUnlinked;
  }
}

function resolvePreviewIcon(kind: MemoryFileListEntry["previewKind"]) {
  switch (kind) {
    case "markdown":
      return icons.scrollText;
    case "json":
      return icons.fileCode;
    case "image":
      return icons.image;
    case "audio":
      return icons.volume2;
    case "pdf":
      return icons.book;
    case "text":
      return icons.fileText;
    default:
      return icons.paperclip;
  }
}

function countRelatedPages(files: readonly MemoryFileListEntry[]) {
  return files.reduce((total, file) => total + Math.max(0, file.relatedPagesCount ?? 0), 0);
}

function countPreviewKinds(files: readonly MemoryFileListEntry[]) {
  return new Set(files.map((file) => file.previewKind)).size;
}

function buildFilesGroups(
  text: Pick<MemoryText, "filesAttached" | "filesMentioned" | "filesUnlinked">,
  files: readonly MemoryFileListEntry[],
): FilesGroup[] {
  const groups: FilesGroup[] = [
    {
      id: "attached",
      label: text.filesAttached,
      items: files.filter((file) => file.primaryPage?.relation === "attached"),
    },
    {
      id: "mentioned",
      label: text.filesMentioned,
      items: files.filter((file) => file.primaryPage?.relation === "mentioned"),
    },
    {
      id: "unlinked",
      label: text.filesUnlinked,
      items: files.filter((file) => !file.primaryPage?.relation),
    },
  ];
  return groups.filter((group) => group.items.length > 0);
}

function renderMetricTile(params: { label: string; value: string | number; detail?: string | null }) {
  return html`
    <article class="alisio-memory-files__metric-tile">
      <span class="alisio-memory-files__metric-label">${params.label}</span>
      <strong class="alisio-memory-files__metric-value">${String(params.value)}</strong>
      ${params.detail?.trim()
        ? html`<span class="alisio-memory-files__metric-detail">${params.detail}</span>`
        : nothing}
    </article>
  `;
}

function renderVaultOverview(params: RenderMemoryFilesViewParams) {
  const files = params.filesList?.files ?? [];
  return html`
    <section class="alisio-memory-group alisio-memory-files__vault">
      <div class="alisio-memory-files__vault-head">
        <span class="alisio-memory-files__vault-icon" aria-hidden="true">${icons.folder}</span>
        <div class="alisio-memory-files__vault-copy">
          <span class="alisio-memory-files__vault-eyebrow">${params.text.filesTitle}</span>
          <h3>${params.text.filesTitle}</h3>
          <p>${params.filesList?.agentId ?? params.text.na}</p>
        </div>
      </div>
      <div class="alisio-memory-files__metric-grid">
        ${renderMetricTile({
          label: params.text.filesTitle,
          value: files.length,
        })}
        ${renderMetricTile({
          label: params.text.filesRelatedPages,
          value: countRelatedPages(files),
        })}
        ${renderMetricTile({
          label: params.text.filesPreviewKind,
          value: countPreviewKinds(files),
        })}
      </div>
    </section>
  `;
}

function renderExplorerItem(params: RenderMemoryFilesViewParams, file: MemoryFileListEntry) {
  const text = params.text;
  const summary = file.summary?.trim() || file.provenanceSummary?.trim() || text.na;
  const relationLabel = resolveRelationLabel(text, file.primaryPage?.relation);
  const secondaryMeta = [params.formatTimestamp(file.updatedAt), params.formatBytes(file.size)]
    .filter(Boolean)
    .join(" · ");

  return html`
    <article class="alisio-memory-native__result-card alisio-memory-files__result-card">
      <button
        type="button"
        class="alisio-memory-file alisio-memory-files__item ${params.selectedFileId === file.id
          ? "is-active"
          : ""}"
        aria-current=${params.selectedFileId === file.id ? "true" : "false"}
        @click=${() => params.onSelectFile(file.id)}
      >
        <span class="alisio-memory-files__item-icon" aria-hidden="true">
          ${resolvePreviewIcon(file.previewKind)}
        </span>
        <span class="alisio-memory-file__copy">
          <span class="alisio-memory-files__item-row">
            <span class="alisio-memory-file__title">${file.name}</span>
            <span class="alisio-memory-files__item-kind">
              ${formatMemoryFilePreviewKind(file.previewKind)}
            </span>
          </span>
          <span class="alisio-memory-file__meta">${summary}</span>
          <span class="alisio-memory-files__item-footer">
            <span class="alisio-memory-files__relation">${relationLabel}</span>
            <span class="alisio-memory-files__item-context">
              ${file.primaryPage?.title || text.none}
            </span>
          </span>
          ${secondaryMeta
            ? html`<span class="alisio-memory-file__meta">${secondaryMeta}</span>`
            : nothing}
          ${params.renderReasonTags(file.reasonTags)}
        </span>
      </button>
      ${params.renderTraceAction({
        label: file.name,
        trace: file.trace,
        summary: file.traceSummary,
        reasonTags: file.reasonTags,
      })}
    </article>
  `;
}

function renderSidebarList(params: RenderMemoryFilesViewParams) {
  const files = params.filesList?.files ?? [];
  const text = params.text;
  if (params.filesLoading && files.length === 0) {
    return html`${renderSkeletonListItem({
      lines: ["short", "medium"],
    })}${renderSkeletonListItem({ lines: ["short", "medium"] })}`;
  }
  if (params.filesError) {
    return html`<div class="callout info">${params.filesError}</div>`;
  }
  if (files.length === 0) {
    return html`<div class="alisio-memory-empty">${text.filesEmpty}</div>`;
  }
  const groups = buildFilesGroups(text, files);
  return html`
    <div class="alisio-memory-files__explorer">
      ${(groups.length > 0 ? groups : [{ id: "attached", label: text.filesTitle, items: files }]).map(
        (group) => html`
          <section class="alisio-memory-files__section">
            <div class="alisio-memory-files__section-header">
              <span>${group.label}</span>
              <span>${group.items.length}</span>
            </div>
            <div class="alisio-memory-file-list alisio-memory-file-list--vault">
              ${group.items.map((file) => renderExplorerItem(params, file))}
            </div>
          </section>
        `,
      )}
    </div>
  `;
}

function renderRelatedPages(params: RenderMemoryFilesViewParams, file: MemoryFileDetail) {
  const text = params.text;
  if ((file.relatedPages?.length ?? 0) === 0) {
    return html`<div class="alisio-memory-empty">${text.none}</div>`;
  }
  return html`
    <div class="alisio-memory-native__stack">
      ${file.relatedPages.map(
        (page) => html`
          <article class="alisio-memory-files__link-card">
            <div class="alisio-memory-files__link-main">
              <span class="alisio-memory-files__link-icon" aria-hidden="true">
                ${page.relation === "attached" ? icons.paperclip : icons.link}
              </span>
              <div class="alisio-memory-files__link-copy">
                <div class="alisio-memory-files__link-row">
                  <h3>${page.title}</h3>
                  <span class="alisio-memory-files__relation">
                    ${resolveRelationLabel(text, page.relation)}
                  </span>
                </div>
                <p>${page.path?.trim() || text.na}</p>
                <span class="alisio-memory-file__meta">${page.pageId}</span>
              </div>
            </div>
            <div class="alisio-memory-runtime__actions">
              <button class="btn btn--sm" @click=${() => params.onOpenWikiPage(page.pageId)}>
                ${icons.book} ${text.filesOpenPage}
              </button>
              <button class="btn btn--sm" @click=${() => params.onFocusGraphPage(page.pageId)}>
                ${icons.link} ${text.filesFocusGraph}
              </button>
            </div>
          </article>
        `,
      )}
    </div>
  `;
}

function renderInspector(params: RenderMemoryFilesViewParams, file: MemoryFileDetail) {
  const text = params.text;
  const summary = file.summary?.trim() || file.provenanceSummary?.trim() || text.na;
  const primaryPage = file.primaryPage ?? file.relatedPages?.[0] ?? null;
  return html`
    <aside class="alisio-memory-files__inspector">
      <section class="alisio-memory-group alisio-memory-files__inspector-card">
        <div class="alisio-memory-group__header"><h2>${text.filesSummary}</h2></div>
        <p class="alisio-memory-files__summary">${summary}</p>
        ${primaryPage
          ? html`
              <button
                type="button"
                class="alisio-memory-files__primary-page"
                @click=${() => params.onOpenWikiPage(primaryPage.pageId)}
              >
                <span class="alisio-memory-files__primary-page-icon" aria-hidden="true">
                  ${primaryPage.relation === "attached" ? icons.paperclip : icons.link}
                </span>
                <span class="alisio-memory-files__primary-page-copy">
                  <strong>${primaryPage.title}</strong>
                  <span>
                    ${resolveRelationLabel(text, primaryPage.relation)} ·
                    ${primaryPage.path?.trim() || text.na}
                  </span>
                </span>
              </button>
            `
          : nothing}
      </section>

      <section class="alisio-memory-group alisio-memory-files__inspector-card">
        <div class="alisio-memory-files__metric-grid alisio-memory-files__metric-grid--compact">
          ${renderMetricTile({
            label: text.filesPreviewKind,
            value: formatMemoryFilePreviewKind(file.previewKind),
          })}
          ${renderMetricTile({
            label: text.filesMediaType,
            value: file.mediaType?.trim() || text.na,
          })}
          ${renderMetricTile({
            label: text.filesSize,
            value: params.formatBytes(file.size) ?? text.na,
          })}
          ${renderMetricTile({
            label: text.filesUpdated,
            value: params.formatTimestamp(file.updatedAt) ?? text.na,
          })}
          ${renderMetricTile({
            label: text.filesRelatedPages,
            value: file.relatedPages.length,
          })}
          ${renderMetricTile({
            label: text.filesTitle,
            value: file.name,
          })}
        </div>
      </section>

      <section class="alisio-memory-group alisio-memory-files__inspector-card">
        <div class="alisio-memory-group__header"><h2>${text.filesHash}</h2></div>
        <code class="alisio-memory-files__hash" title=${file.sha256}>${file.sha256}</code>
        <span class="alisio-memory-file__meta">${file.provenanceSummary?.trim() || text.na}</span>
      </section>
    </aside>
  `;
}

function renderEmptyDetail(params: RenderMemoryFilesViewParams) {
  const files = params.filesList?.files ?? [];
  return html`
    <div class="alisio-memory-panel alisio-memory-panel--empty alisio-memory-files__empty-state">
      <span class="alisio-memory-files__empty-icon" aria-hidden="true">${icons.folder}</span>
      <strong>${params.text.filesNoSelection}</strong>
      <div class="alisio-memory-files__metric-grid alisio-memory-files__metric-grid--compact">
        ${renderMetricTile({
          label: params.text.filesTitle,
          value: files.length,
        })}
        ${renderMetricTile({
          label: params.text.filesRelatedPages,
          value: countRelatedPages(files),
        })}
        ${renderMetricTile({
          label: params.text.filesPreviewKind,
          value: countPreviewKinds(files),
        })}
      </div>
    </div>
  `;
}

function renderDetail(params: RenderMemoryFilesViewParams) {
  const text = params.text;
  if (params.fileLoading && !params.fileDetail) {
    return html`
      <section class="alisio-memory-runtime">
        ${renderSkeletonLines(["short", "medium", "long"], { compact: true })}
      </section>
    `;
  }
  if (params.fileError) {
    return html`<div class="callout info">${params.fileError}</div>`;
  }
  if (!params.fileDetail) {
    return renderEmptyDetail(params);
  }
  const file = params.fileDetail;
  const preview = buildMemoryFilePreviewModel(file);
  const actions = buildMemoryFileActionModel(file);
  const summary = file.summary?.trim() || file.provenanceSummary?.trim() || text.na;
  const relationLabel = resolveRelationLabel(text, file.primaryPage?.relation ?? file.relatedPages[0]?.relation);
  return html`
    <div class="alisio-memory-files__stage">
      <div class="alisio-memory-files__canvas">
        <section class="alisio-memory-runtime alisio-memory-files__hero-card">
          <div class="alisio-memory-files__hero">
            <span class="alisio-memory-files__hero-icon" aria-hidden="true">
              ${resolvePreviewIcon(file.previewKind)}
            </span>
            <div class="alisio-memory-files__hero-copy">
              <span class="alisio-memory-files__hero-eyebrow">
                ${text.filesTitle} · ${relationLabel}
              </span>
              <div class="alisio-memory-runtime__header">
                <div class="alisio-memory-runtime__copy">
                  <h3>${file.name}</h3>
                  <p>${summary}</p>
                </div>
                <div class="alisio-memory-runtime__actions">
                  ${actions.openHref
                    ? html`
                        <button class="btn btn--sm" @click=${() => params.onOpenAttachment()}>
                          ${icons.eye} ${text.filesOpen}
                        </button>
                      `
                    : nothing}
                  ${actions.download
                    ? html`
                        <button
                          class="btn btn--sm primary"
                          @click=${() => params.onDownloadAttachment()}
                        >
                          ${icons.download} ${text.filesDownload}
                        </button>
                      `
                    : nothing}
                  ${params.renderTraceAction({
                    label: file.name,
                    trace: file.trace,
                    summary: file.traceSummary,
                    reasonTags: file.reasonTags,
                  })}
                </div>
              </div>
              <div class="alisio-memory-files__hero-chips">
                <span class="alisio-memory-files__relation">
                  ${formatMemoryFilePreviewKind(file.previewKind)}
                </span>
                <span class="alisio-memory-files__relation">
                  ${file.mediaType?.trim() || text.na}
                </span>
                <span class="alisio-memory-files__relation">
                  ${params.formatBytes(file.size) ?? text.na}
                </span>
                <span class="alisio-memory-files__relation">
                  ${params.formatTimestamp(file.updatedAt) ?? text.na}
                </span>
              </div>
              ${params.renderReasonTags(file.reasonTags)}
            </div>
          </div>
        </section>

        <section class="alisio-memory-preview alisio-memory-files__preview-card">
          <div class="alisio-memory-files__preview-head">
            <div class="alisio-memory-files__preview-copy">
              <span class="alisio-memory-preview__label">${text.preview}</span>
              <strong>${formatMemoryFilePreviewKind(file.previewKind)}</strong>
              <span>${file.mediaType?.trim() || text.na}</span>
            </div>
            <span class="alisio-memory-files__preview-badge">${file.name}</span>
          </div>
          ${renderMemoryFilePreview({
            preview,
            text: {
              previewLabel: text.preview,
              previewEmpty: text.previewEmpty,
              previewUnavailable: text.filesPreviewUnavailable,
              previewTruncated: text.filesPreviewTruncated,
            },
          })}
        </section>

        <div class="alisio-memory-files__details-grid">
          <section class="alisio-memory-group alisio-memory-files__detail-card">
            <div class="alisio-memory-group__header"><h2>${text.filesRelatedPages}</h2></div>
            ${renderRelatedPages(params, file)}
          </section>
          <section class="alisio-memory-group alisio-memory-files__detail-card">
            <div class="alisio-memory-group__header"><h2>${text.filesProvenance}</h2></div>
            <div class="alisio-memory-files__provenance">
              ${params.renderProvenance(file.provenance, text.na)}
            </div>
          </section>
        </div>
      </div>

      ${renderInspector(params, file)}
    </div>
  `;
}

export function renderMemoryFilesView(params: RenderMemoryFilesViewParams) {
  return html`
    <div class="alisio-memory-shell alisio-memory-shell--files">
      <aside class="alisio-memory-sidebar alisio-memory-sidebar--files">
        ${renderVaultOverview(params)}
        <section class="alisio-memory-group alisio-memory-files__explorer-card">
          <div class="alisio-memory-group__header">
            <h2>${params.text.filesTitle}</h2>
            <span class="alisio-memory-files__section-count">
              ${params.filesList?.files.length ?? 0}
            </span>
          </div>
          ${renderSidebarList(params)}
        </section>
      </aside>
      <div class="alisio-memory-main alisio-memory-main--files">${renderDetail(params)}</div>
    </div>
  `;
}
