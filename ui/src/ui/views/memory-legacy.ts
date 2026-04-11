import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { t } from "../../i18n/index.ts";
import { formatRelativeTimestamp } from "../format.ts";
import { icons } from "../icons.ts";
import { toSanitizedMarkdownHtml } from "../markdown.ts";
import {
  humanizeMemoryNoteTitle,
  isLongTermMemoryFileName,
  PRIMARY_MEMORY_FILE_NAME,
} from "../memory-files.ts";

type MemoryHubProps = import("./memory.ts").MemoryHubProps;

type LegacyOptions = {
  compact?: boolean;
};

function text() {
  return {
    refresh: t("common.refresh"),
    searchPlaceholder: t("alisio.memory.searchPlaceholder"),
    mainMemory: t("alisio.memory.mainMemory"),
    longTerm: t("alisio.memory.longTerm"),
    note: t("alisio.memory.note"),
    missing: t("alisio.memory.missing"),
    unsaved: t("alisio.memory.unsaved"),
    preview: t("alisio.memory.preview"),
    previewEmpty: t("alisio.memory.previewEmpty"),
    save: t("alisio.memory.save"),
    saving: t("alisio.memory.saving"),
    reset: t("alisio.memory.reset"),
    delete: t("alisio.memory.delete"),
    deleting: t("alisio.memory.deleting"),
    noNotes: t("alisio.memory.noNotes"),
    noMatches: t("alisio.memory.noMatches"),
    legacyTitle: t("alisio.memory.legacy.title"),
    legacyBody: t("alisio.memory.legacy.body"),
  };
}

function resolveFileLabel(name: string, labels: ReturnType<typeof text>) {
  if (name === PRIMARY_MEMORY_FILE_NAME) {
    return labels.mainMemory;
  }
  if (isLongTermMemoryFileName(name)) {
    return labels.longTerm;
  }
  return humanizeMemoryNoteTitle(name);
}

export function renderLegacyMemoryEditor(props: MemoryHubProps, options: LegacyOptions = {}) {
  const labels = text();
  const files = props.memoryList?.files ?? [];
  const filtered = props.searchQuery.trim()
    ? files.filter((entry) => {
        const query = props.searchQuery.trim().toLowerCase();
        return (
          entry.name.toLowerCase().includes(query) ||
          resolveFileLabel(entry.name, labels).toLowerCase().includes(query)
        );
      })
    : files;
  const activeName =
    props.memoryActive && files.some((entry) => entry.name === props.memoryActive)
      ? props.memoryActive
      : (files[0]?.name ?? null);
  const activeEntry = activeName
    ? (files.find((entry) => entry.name === activeName) ?? null)
    : null;
  const baseContent = activeName ? (props.memoryContents[activeName] ?? "") : "";
  const draft = activeName ? (props.memoryDrafts[activeName] ?? baseContent) : "";
  const isDirty = activeName ? draft !== baseContent : false;
  const deletable = Boolean(activeName && activeName !== PRIMARY_MEMORY_FILE_NAME);

  return html`
    <section class="alisio-memory-runtime">
      <div class="alisio-memory-runtime__header">
        <div class="alisio-memory-runtime__copy">
          <h3>${labels.legacyTitle}</h3>
          <p>${labels.legacyBody}</p>
        </div>
        ${!options.compact
          ? html`
              <div class="alisio-memory-runtime__actions">
                <label class="field field--with-icon alisio-memory-search">
                  <span class="sr-only">${labels.searchPlaceholder}</span>
                  <span class="field__icon" aria-hidden="true">${icons.search}</span>
                  <input
                    .value=${props.searchQuery}
                    placeholder=${labels.searchPlaceholder}
                    @input=${(event: Event) =>
                      props.onSearchChange((event.target as HTMLInputElement).value)}
                  />
                </label>
                <button
                  class="btn btn--icon btn--ghost alisio-memory-refresh"
                  title=${labels.refresh}
                  aria-label=${labels.refresh}
                  @click=${props.onRefresh}
                >
                  ${icons.refresh}
                </button>
              </div>
            `
          : nothing}
      </div>
      ${props.memoryError ? html`<div class="callout danger">${props.memoryError}</div>` : nothing}
      <div class="alisio-memory-shell">
        <aside class="alisio-memory-sidebar">
          <section class="alisio-memory-group">
            <div class="alisio-memory-group__header"><h2>${labels.longTerm}</h2></div>
            ${filtered.length === 0
              ? html`
                  <div class="alisio-memory-empty">
                    ${props.searchQuery.trim() ? labels.noMatches : labels.noNotes}
                  </div>
                `
              : html`
                  <div class="alisio-memory-file-list">
                    ${filtered.map(
                      (entry) => html`
                        <button
                          type="button"
                          class="alisio-memory-file ${entry.name === activeName ? "is-active" : ""}"
                          @click=${() => props.onSelectFile(entry.name)}
                        >
                          <span class="alisio-memory-file__copy">
                            <span class="alisio-memory-file__title">
                              ${resolveFileLabel(entry.name, labels)}
                            </span>
                            <span class="alisio-memory-file__meta">${entry.name}</span>
                          </span>
                          <span class="alisio-memory-file__status">
                            ${entry.missing
                              ? html`<span class="alisio-memory-badge">${labels.missing}</span>`
                              : entry.updatedAtMs
                                ? formatRelativeTimestamp(entry.updatedAtMs)
                                : labels.note}
                          </span>
                        </button>
                      `,
                    )}
                  </div>
                `}
          </section>
        </aside>
        <div class="alisio-memory-main">
          ${!activeEntry
            ? html`<div class="alisio-memory-panel alisio-memory-panel--empty">
                ${labels.noNotes}
              </div>`
            : html`
                <section class="alisio-memory-runtime">
                  <div class="alisio-memory-runtime__header">
                    <div class="alisio-memory-runtime__copy">
                      <h3>${resolveFileLabel(activeEntry.name, labels)}</h3>
                      <p>${activeEntry.name}</p>
                    </div>
                    <div class="alisio-memory-runtime__actions">
                      ${activeEntry.missing
                        ? html`<span class="alisio-memory-badge">${labels.missing}</span>`
                        : nothing}
                      ${isDirty
                        ? html`<span class="alisio-memory-badge">${labels.unsaved}</span>`
                        : nothing}
                      <button
                        class="btn btn--sm"
                        ?disabled=${!isDirty}
                        @click=${() => props.onResetFile(activeEntry.name)}
                      >
                        ${labels.reset}
                      </button>
                      <button
                        class="btn btn--sm primary"
                        ?disabled=${props.memorySaving || !isDirty}
                        @click=${() => props.onSaveFile(activeEntry.name)}
                      >
                        ${props.memorySaving ? labels.saving : labels.save}
                      </button>
                      ${deletable
                        ? html`
                            <button
                              class="btn btn--sm danger"
                              ?disabled=${props.memoryDeleting}
                              @click=${() => props.onDeleteFile(activeEntry.name)}
                            >
                              ${props.memoryDeleting ? labels.deleting : labels.delete}
                            </button>
                          `
                        : nothing}
                    </div>
                  </div>
                  <div class="alisio-memory-editor">
                    <label class="field alisio-memory-editor__pane">
                      <span>${activeEntry.name}</span>
                      <textarea
                        class="alisio-memory-textarea"
                        .value=${draft}
                        @input=${(event: Event) =>
                          props.onDraftChange(
                            activeEntry.name,
                            (event.target as HTMLTextAreaElement).value,
                          )}
                      ></textarea>
                    </label>
                    <section class="alisio-memory-preview">
                      <div class="alisio-memory-preview__label">${labels.preview}</div>
                      ${draft.trim()
                        ? html`
                            <div class="alisio-memory-preview__body sidebar-markdown">
                              ${unsafeHTML(toSanitizedMarkdownHtml(draft))}
                            </div>
                          `
                        : html`<div class="alisio-memory-preview__empty">
                            ${labels.previewEmpty}
                          </div>`}
                    </section>
                  </div>
                </section>
              `}
        </div>
      </div>
    </section>
  `;
}
