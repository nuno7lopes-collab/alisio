import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { MemoryFilePreviewModel } from "../../controllers/memory-files-preview.ts";
import { toSanitizedMarkdownHtml } from "../../markdown.ts";

export type MemoryFilesPreviewText = {
  previewLabel: string;
  previewEmpty: string;
  previewUnavailable: string;
  previewTruncated: string;
};

export function renderMemoryFilePreview(params: {
  preview: MemoryFilePreviewModel | null;
  text: MemoryFilesPreviewText;
}) {
  const preview = params.preview;
  if (!preview) {
    return html`<div class="alisio-memory-preview__empty">${params.text.previewEmpty}</div>`;
  }
  if (preview.kind === "markdown") {
    return preview.text.trim()
      ? html`
          <div class="alisio-memory-preview__body sidebar-markdown">
            ${unsafeHTML(toSanitizedMarkdownHtml(preview.text))}
          </div>
          ${preview.truncated
            ? html`<div class="alisio-memory-preview__hint">${params.text.previewTruncated}</div>`
            : nothing}
        `
      : html`<div class="alisio-memory-preview__empty">${params.text.previewEmpty}</div>`;
  }
  if (preview.kind === "text" || preview.kind === "json") {
    return preview.text.trim()
      ? html`
          <pre class="alisio-memory-files-preview__code">${preview.text}</pre>
          ${preview.truncated
            ? html`<div class="alisio-memory-preview__hint">${params.text.previewTruncated}</div>`
            : nothing}
        `
      : html`<div class="alisio-memory-preview__empty">${params.text.previewEmpty}</div>`;
  }
  if (preview.kind === "image" && preview.src) {
    return html`<img
      class="alisio-memory-files-preview__image"
      src=${preview.src}
      alt=""
      loading="lazy"
    />`;
  }
  if (preview.kind === "audio" && preview.src) {
    return html`<audio class="alisio-memory-files-preview__audio" controls src=${preview.src}></audio>`;
  }
  if (preview.kind === "pdf" && preview.src) {
    return html`<iframe
      class="alisio-memory-files-preview__frame"
      src=${preview.src}
      title=${params.text.previewLabel}
    ></iframe>`;
  }
  return html`<div class="alisio-memory-preview__empty">
    ${preview.fallbackLabel || params.text.previewUnavailable}
  </div>`;
}
