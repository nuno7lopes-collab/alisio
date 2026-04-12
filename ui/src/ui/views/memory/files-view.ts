import { html, nothing, type TemplateResult } from "lit";
import {
  buildMemoryFileActionModel,
  buildMemoryFilePreviewModel,
  formatMemoryFilePreviewKind,
} from "../../controllers/memory-files-preview.ts";
import type {
  MemoryFileDetail,
  MemoryFilesListResult,
  MemoryReasonTag,
} from "../../controllers/memory-runtime.ts";
import { renderSkeletonLines, renderSkeletonListItem } from "../loading-skeleton.ts";
import { renderMemoryFilePreview } from "./files-preview.ts";

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
  return html`
    <div class="alisio-memory-file-list">
      ${files.map(
        (file) => html`
          <article class="alisio-memory-native__result-card">
            <button
              type="button"
              class="alisio-memory-file ${params.selectedFileId === file.id ? "is-active" : ""}"
              @click=${() => params.onSelectFile(file.id)}
            >
              <span class="alisio-memory-file__copy">
                <span class="alisio-memory-file__title">${file.name}</span>
                <span class="alisio-memory-file__meta">${file.summary?.trim() || text.na}</span>
                <span class="alisio-memory-file__meta">
                  ${formatMemoryFilePreviewKind(file.previewKind)} ·
                  ${params.formatBytes(file.size) ?? text.na} ·
                  ${params.formatTimestamp(file.updatedAt) ?? text.na}
                </span>
                ${file.primaryPage
                  ? html`<span class="alisio-memory-file__meta">${file.primaryPage.title}</span>`
                  : nothing}
                ${params.renderReasonTags(file.reasonTags)}
              </span>
            </button>
            ${params.renderTraceAction({
              label: file.name,
              traceId: file.traceId,
              trace: file.trace,
              summary: file.traceSummary,
              reasonTags: file.reasonTags,
            })}
          </article>
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
          <article class="alisio-memory-runtime">
            <div class="alisio-memory-runtime__header">
              <div class="alisio-memory-runtime__copy">
                <h3>${page.title}</h3>
                <p>${page.path?.trim() || text.na}</p>
                <span class="alisio-memory-file__meta">${page.pageId}</span>
                <span class="alisio-memory-file__meta">${page.entityId}</span>
              </div>
              <div class="alisio-memory-runtime__actions">
                <button class="btn btn--sm" @click=${() => params.onOpenWikiPage(page.pageId)}>
                  ${text.filesOpenPage}
                </button>
                <button class="btn btn--sm" @click=${() => params.onFocusGraphPage(page.pageId)}>
                  ${text.filesFocusGraph}
                </button>
              </div>
            </div>
          </article>
        `,
      )}
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
    return html`<div class="alisio-memory-panel alisio-memory-panel--empty">
      ${text.filesNoSelection}
    </div>`;
  }
  const file = params.fileDetail;
  const preview = buildMemoryFilePreviewModel(file);
  const actions = buildMemoryFileActionModel(file);
  return html`
    <section class="alisio-memory-runtime">
      <div class="alisio-memory-runtime__header">
        <div class="alisio-memory-runtime__copy">
          <h3>${file.name}</h3>
          <p>${file.summary?.trim() || file.provenanceSummary?.trim() || text.na}</p>
        </div>
        <div class="alisio-memory-runtime__actions">
          ${actions.openHref
            ? html`
                <button class="btn btn--sm" @click=${() => params.onOpenAttachment()}>
                  ${text.filesOpen}
                </button>
              `
            : nothing}
          ${actions.download
            ? html`
                <button class="btn btn--sm primary" @click=${() => params.onDownloadAttachment()}>
                  ${text.filesDownload}
                </button>
              `
            : nothing}
          ${params.renderTraceAction({
            label: file.name,
            traceId: file.traceId,
            trace: file.trace,
            summary: file.traceSummary,
            reasonTags: file.reasonTags,
          })}
        </div>
      </div>
      ${params.renderReasonTags(file.reasonTags)}
      <div class="alisio-memory-runtime__meta">
        <div class="alisio-memory-runtime__meta-item">
          <span class="alisio-memory-runtime__meta-label">${text.filesMediaType}</span>
          <strong class="alisio-memory-runtime__meta-value">
            ${file.mediaType?.trim() || text.na}
          </strong>
        </div>
        <div class="alisio-memory-runtime__meta-item">
          <span class="alisio-memory-runtime__meta-label">${text.filesSize}</span>
          <strong class="alisio-memory-runtime__meta-value">
            ${params.formatBytes(file.size) ?? text.na}
          </strong>
        </div>
        <div class="alisio-memory-runtime__meta-item">
          <span class="alisio-memory-runtime__meta-label">${text.filesUpdated}</span>
          <strong class="alisio-memory-runtime__meta-value">
            ${params.formatTimestamp(file.updatedAt) ?? text.na}
          </strong>
        </div>
        <div class="alisio-memory-runtime__meta-item">
          <span class="alisio-memory-runtime__meta-label">${text.filesPreviewKind}</span>
          <strong class="alisio-memory-runtime__meta-value">
            ${formatMemoryFilePreviewKind(file.previewKind)}
          </strong>
        </div>
        <div class="alisio-memory-runtime__meta-item">
          <span class="alisio-memory-runtime__meta-label">${text.filesHash}</span>
          <strong class="alisio-memory-runtime__meta-value">${file.sha256}</strong>
        </div>
        <div class="alisio-memory-runtime__meta-item">
          <span class="alisio-memory-runtime__meta-label">${text.filesSummary}</span>
          <strong class="alisio-memory-runtime__meta-value">${file.summary || text.na}</strong>
        </div>
      </div>
    </section>
    <section class="alisio-memory-preview">
      <div class="alisio-memory-preview__label">${text.preview}</div>
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
    <div class="alisio-memory-native__panels">
      <section class="alisio-memory-group">
        <div class="alisio-memory-group__header"><h2>${text.filesProvenance}</h2></div>
        ${params.renderProvenance(file.provenance, text.na)}
      </section>
      <section class="alisio-memory-group">
        <div class="alisio-memory-group__header"><h2>${text.filesRelatedPages}</h2></div>
        ${renderRelatedPages(params, file)}
      </section>
    </div>
  `;
}

export function renderMemoryFilesView(params: RenderMemoryFilesViewParams) {
  return html`
    <div class="alisio-memory-shell">
      <aside class="alisio-memory-sidebar">
        <section class="alisio-memory-group">
          <div class="alisio-memory-group__header"><h2>${params.text.filesTitle}</h2></div>
          ${renderSidebarList(params)}
        </section>
      </aside>
      <div class="alisio-memory-main">${renderDetail(params)}</div>
    </div>
  `;
}
