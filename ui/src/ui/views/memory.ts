import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { t } from "../../i18n/index.ts";
import { formatRelativeTimestamp } from "../format.ts";
import { icons } from "../icons.ts";
import { toSanitizedMarkdownHtml } from "../markdown.ts";
import {
  humanizeMemoryNoteTitle,
  isLongTermMemoryFileName,
  isMemoryNoteFileName,
  LEGACY_MEMORY_FILE_NAME,
  parseMemoryNoteFileName,
  PRIMARY_MEMORY_FILE_NAME,
  buildMemoryNoteName,
} from "../memory-files.ts";
import type { AgentFileEntry, AgentsFilesListResult, AgentsListResult } from "../types.ts";
import { normalizeAgentLabel } from "./agents-utils.ts";
import {
  renderSkeletonButton,
  renderSkeletonLines,
  renderSkeletonListItem,
} from "./loading-skeleton.ts";

type MemoryHubProps = {
  agentsLoading: boolean;
  agentsError: string | null;
  agentsList: AgentsListResult | null;
  selectedAgentId: string | null;
  memoryLoading: boolean;
  memoryError: string | null;
  memoryList: AgentsFilesListResult | null;
  memoryActive: string | null;
  memoryContents: Record<string, string>;
  memoryDrafts: Record<string, string>;
  memorySaving: boolean;
  memoryDeleting: boolean;
  searchQuery: string;
  composerOpen: boolean;
  composerDate: string;
  composerTitle: string;
  onSelectAgent: (agentId: string) => void;
  onRefresh: () => void;
  onSearchChange: (value: string) => void;
  onSelectFile: (name: string) => void;
  onDraftChange: (name: string, content: string) => void;
  onResetFile: (name: string) => void;
  onSaveFile: (name: string) => void;
  onDeleteFile: (name: string) => void;
  onComposerOpenChange: (open: boolean) => void;
  onComposerDateChange: (value: string) => void;
  onComposerTitleChange: (value: string) => void;
  onCreateNote: () => void;
};

function memoryText() {
  return {
    agent: t("alisio.memory.agent"),
    loading: t("alisio.memory.loading"),
    workspace: t("alisio.memory.workspace"),
    longTerm: t("alisio.memory.longTerm"),
    notes: t("alisio.memory.notes"),
    noteCount: t("alisio.memory.noteCount"),
    longTermCount: t("alisio.memory.longTermCount"),
    lastUpdated: t("alisio.memory.lastUpdated"),
    updatedNever: t("alisio.memory.updatedNever"),
    searchPlaceholder: t("alisio.memory.searchPlaceholder"),
    mainMemory: t("alisio.memory.mainMemory"),
    legacyMemory: t("alisio.memory.legacyMemory"),
    note: t("alisio.memory.note"),
    missing: t("alisio.memory.missing"),
    unsaved: t("alisio.memory.unsaved"),
    refresh: t("common.refresh"),
    newNote: t("alisio.memory.newNote"),
    noteDate: t("alisio.memory.noteDate"),
    noteTitle: t("alisio.memory.noteTitle"),
    noteTitlePlaceholder: t("alisio.memory.noteTitlePlaceholder"),
    notePath: t("alisio.memory.notePath"),
    createNote: t("alisio.memory.createNote"),
    cancelCreate: t("alisio.memory.cancelCreate"),
    content: t("alisio.memory.content"),
    preview: t("alisio.memory.preview"),
    reset: t("alisio.memory.reset"),
    save: t("alisio.memory.save"),
    saving: t("alisio.memory.saving"),
    delete: t("alisio.memory.delete"),
    deleting: t("alisio.memory.deleting"),
    previewEmpty: t("alisio.memory.previewEmpty"),
    missingHint: t("alisio.memory.missingHint"),
    noNotes: t("alisio.memory.noNotes"),
    noMatches: t("alisio.memory.noMatches"),
    emptyAgents: t("alisio.memory.emptyAgents"),
    deleteConfirm: t("alisio.memory.deleteConfirm"),
  };
}

function resolveEntryTitle(entry: AgentFileEntry, text: ReturnType<typeof memoryText>) {
  if (entry.name === PRIMARY_MEMORY_FILE_NAME) {
    return text.mainMemory;
  }
  if (entry.name === LEGACY_MEMORY_FILE_NAME) {
    return text.legacyMemory;
  }
  return humanizeMemoryNoteTitle(entry.name);
}

function resolveEntryMeta(entry: AgentFileEntry, text: ReturnType<typeof memoryText>) {
  if (isLongTermMemoryFileName(entry.name)) {
    return entry.name;
  }
  const parsed = parseMemoryNoteFileName(entry.name);
  if (parsed.date) {
    return parsed.date;
  }
  return text.note;
}

function renderStatsCard(label: string, value: string, detail?: string) {
  return html`
    <div class="alisio-memory-stat">
      <span class="alisio-memory-stat__label">${label}</span>
      <strong class="alisio-memory-stat__value">${value}</strong>
      ${detail ? html`<span class="alisio-memory-stat__detail">${detail}</span>` : nothing}
    </div>
  `;
}

function renderFileList(params: {
  title: string;
  files: AgentFileEntry[];
  activeName: string | null;
  text: ReturnType<typeof memoryText>;
  emptyLabel: string;
  onSelectFile: (name: string) => void;
}) {
  return html`
    <section class="alisio-memory-group">
      <div class="alisio-memory-group__header">
        <h2>${params.title}</h2>
      </div>
      ${params.files.length === 0
        ? html`<div class="alisio-memory-empty">${params.emptyLabel}</div>`
        : html`
            <div class="alisio-memory-file-list">
              ${params.files.map((entry) => {
                const active = params.activeName === entry.name;
                return html`
                  <button
                    type="button"
                    class="alisio-memory-file ${active ? "is-active" : ""}"
                    @click=${() => params.onSelectFile(entry.name)}
                  >
                    <span class="alisio-memory-file__copy">
                      <span class="alisio-memory-file__title">
                        ${resolveEntryTitle(entry, params.text)}
                      </span>
                      <span class="alisio-memory-file__meta">
                        ${resolveEntryMeta(entry, params.text)}
                      </span>
                    </span>
                    <span class="alisio-memory-file__status">
                      ${entry.missing
                        ? html`<span class="alisio-memory-badge">${params.text.missing}</span>`
                        : entry.updatedAtMs
                          ? formatRelativeTimestamp(entry.updatedAtMs)
                          : params.text.updatedNever}
                    </span>
                  </button>
                `;
              })}
            </div>
          `}
    </section>
  `;
}

export function renderMemoryHub(props: MemoryHubProps) {
  const text = memoryText();
  const agents = props.agentsList?.agents ?? [];
  const selectedAgentId = props.selectedAgentId;
  const list = props.memoryList?.agentId === selectedAgentId ? props.memoryList : null;
  const activeName = props.memoryActive;
  const files = list?.files ?? [];
  const activeEntry = activeName ? (files.find((file) => file.name === activeName) ?? null) : null;
  const baseContent = activeName ? (props.memoryContents[activeName] ?? "") : "";
  const draft = activeName ? (props.memoryDrafts[activeName] ?? baseContent) : "";
  const isDirty = activeName ? draft !== baseContent : false;
  const longTermFiles = files.filter((entry) => isLongTermMemoryFileName(entry.name));
  const noteFiles = files.filter((entry) => isMemoryNoteFileName(entry.name));
  const filteredNoteFiles = props.searchQuery.trim()
    ? noteFiles.filter((entry) => {
        const query = props.searchQuery.trim().toLowerCase();
        return (
          entry.name.toLowerCase().includes(query) ||
          humanizeMemoryNoteTitle(entry.name).toLowerCase().includes(query)
        );
      })
    : noteFiles;
  const updatedAtValues = files
    .map((entry) => entry.updatedAtMs ?? 0)
    .filter((value) => value > 0)
    .toSorted((left, right) => right - left);
  const latestUpdatedAt = updatedAtValues[0] ?? null;
  const composerPath = buildMemoryNoteName(
    props.composerDate,
    props.composerTitle,
    files.map((entry) => entry.name),
  );

  if (props.agentsLoading && agents.length === 0) {
    return html`
      <section class="alisio-page alisio-memory-page" aria-label=${text.loading}>
        <div class="alisio-memory-skeleton">
          <div class="loading-state__header">
            <div class="loading-state__header-copy">
              <div class="skeleton loading-state__title"></div>
              <div class="skeleton skeleton-line loading-state__subtitle"></div>
            </div>
            ${renderSkeletonButton()}
          </div>
          <div class="loading-state__list" style="margin-top: 18px;">
            ${renderSkeletonListItem({ lines: ["short", "medium"] })}
            ${renderSkeletonListItem({ lines: ["short", "medium"] })}
            ${renderSkeletonListItem({ lines: ["short", "medium"] })}
          </div>
        </div>
      </section>
    `;
  }

  return html`
    <section class="alisio-page alisio-memory-page">
      <div class="alisio-memory-shell">
        <aside class="alisio-memory-sidebar">
          <div class="alisio-memory-sidebar__top">
            <label class="field">
              <span>${text.agent}</span>
              <select
                .value=${selectedAgentId ?? ""}
                ?disabled=${agents.length === 0}
                @change=${(event: Event) =>
                  props.onSelectAgent((event.target as HTMLSelectElement).value)}
              >
                ${agents.length === 0
                  ? html`<option value="">${text.emptyAgents}</option>`
                  : agents.map(
                      (agent) =>
                        html`<option value=${agent.id}>${normalizeAgentLabel(agent)}</option>`,
                    )}
              </select>
            </label>
            <div class="alisio-memory-toolbar">
              <label class="field field--with-icon alisio-memory-search">
                <span class="sr-only">${t("common.search")}</span>
                <span class="field__icon" aria-hidden="true">${icons.search}</span>
                <input
                  .value=${props.searchQuery}
                  placeholder=${text.searchPlaceholder}
                  @input=${(event: Event) =>
                    props.onSearchChange((event.target as HTMLInputElement).value)}
                />
              </label>
              <button class="btn btn--sm" @click=${props.onRefresh}>${text.refresh}</button>
              <button
                class="btn btn--sm primary"
                ?disabled=${!selectedAgentId}
                @click=${() => props.onComposerOpenChange(!props.composerOpen)}
              >
                ${icons.plus} ${text.newNote}
              </button>
            </div>
            ${props.agentsError
              ? html`<div class="callout danger">${props.agentsError}</div>`
              : nothing}
            ${props.memoryError
              ? html`<div class="callout danger">${props.memoryError}</div>`
              : nothing}
            ${props.composerOpen
              ? html`
                  <div class="alisio-memory-composer">
                    <label class="field">
                      <span>${text.noteDate}</span>
                      <input
                        type="date"
                        .value=${props.composerDate}
                        @input=${(event: Event) =>
                          props.onComposerDateChange((event.target as HTMLInputElement).value)}
                      />
                    </label>
                    <label class="field">
                      <span>${text.noteTitle}</span>
                      <input
                        .value=${props.composerTitle}
                        placeholder=${text.noteTitlePlaceholder}
                        @input=${(event: Event) =>
                          props.onComposerTitleChange((event.target as HTMLInputElement).value)}
                      />
                    </label>
                    <div class="alisio-memory-composer__path">
                      <span>${text.notePath}</span>
                      <code>${composerPath}</code>
                    </div>
                    <div class="alisio-memory-composer__actions">
                      <button class="btn btn--sm" @click=${() => props.onComposerOpenChange(false)}>
                        ${text.cancelCreate}
                      </button>
                      <button
                        class="btn btn--sm primary"
                        ?disabled=${!selectedAgentId}
                        @click=${props.onCreateNote}
                      >
                        ${text.createNote}
                      </button>
                    </div>
                  </div>
                `
              : nothing}
          </div>

          <div class="alisio-memory-stats">
            ${renderStatsCard(
              text.longTermCount,
              String(longTermFiles.filter((file) => !file.missing).length),
            )}
            ${renderStatsCard(text.noteCount, String(noteFiles.length))}
            ${renderStatsCard(
              text.lastUpdated,
              latestUpdatedAt ? formatRelativeTimestamp(latestUpdatedAt) : text.updatedNever,
            )}
          </div>

          ${renderFileList({
            title: text.longTerm,
            files: longTermFiles,
            activeName,
            text,
            emptyLabel: text.missing,
            onSelectFile: props.onSelectFile,
          })}
          ${renderFileList({
            title: text.notes,
            files: filteredNoteFiles,
            activeName,
            text,
            emptyLabel: props.searchQuery.trim() ? text.noMatches : text.noNotes,
            onSelectFile: props.onSelectFile,
          })}
        </aside>

        <div class="alisio-memory-main">
          ${!selectedAgentId
            ? html`
                <div class="alisio-memory-panel alisio-memory-panel--empty">
                  <div class="card-title">${text.emptyAgents}</div>
                </div>
              `
            : !activeEntry
              ? html`
                  <div class="alisio-memory-panel alisio-memory-panel--empty">
                    <div class="card-title">${text.longTerm}</div>
                    <div class="card-sub">${text.noNotes}</div>
                  </div>
                `
              : html`
                  <header class="alisio-memory-header">
                    <div class="alisio-memory-header__copy">
                      <div class="alisio-memory-header__eyebrow">
                        ${isLongTermMemoryFileName(activeEntry.name) ? text.longTerm : text.note}
                        ${isDirty
                          ? html`<span class="alisio-memory-badge">${text.unsaved}</span>`
                          : nothing}
                      </div>
                      <h2>${resolveEntryTitle(activeEntry, text)}</h2>
                      <p>
                        <span>${text.workspace}: ${list?.workspace ?? "—"}</span>
                        <span>${activeEntry.name}</span>
                        <span>
                          ${activeEntry.updatedAtMs
                            ? formatRelativeTimestamp(activeEntry.updatedAtMs)
                            : text.updatedNever}
                        </span>
                      </p>
                    </div>
                    <div class="alisio-memory-header__actions">
                      ${isMemoryNoteFileName(activeEntry.name)
                        ? html`
                            <button
                              class="btn btn--sm danger"
                              ?disabled=${props.memoryDeleting}
                              @click=${() => {
                                if (window.confirm(text.deleteConfirm)) {
                                  props.onDeleteFile(activeEntry.name);
                                }
                              }}
                            >
                              ${props.memoryDeleting ? text.deleting : text.delete}
                            </button>
                          `
                        : nothing}
                      <button
                        class="btn btn--sm"
                        ?disabled=${!isDirty}
                        @click=${() => props.onResetFile(activeEntry.name)}
                      >
                        ${text.reset}
                      </button>
                      <button
                        class="btn btn--sm primary"
                        ?disabled=${props.memorySaving || !isDirty}
                        @click=${() => props.onSaveFile(activeEntry.name)}
                      >
                        ${props.memorySaving ? text.saving : text.save}
                      </button>
                    </div>
                  </header>

                  ${activeEntry.missing
                    ? html`<div class="callout info">${text.missingHint}</div>`
                    : nothing}

                  <div class="alisio-memory-editor">
                    <label class="field alisio-memory-editor__pane">
                      <span>${text.content}</span>
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
                      <div class="alisio-memory-preview__label">${text.preview}</div>
                      ${draft.trim()
                        ? html`
                            <div class="alisio-memory-preview__body sidebar-markdown">
                              ${unsafeHTML(toSanitizedMarkdownHtml(draft))}
                            </div>
                          `
                        : html`
                            <div class="alisio-memory-preview__empty">
                              ${renderSkeletonLines(["medium"], { compact: true })}
                              <span>${text.previewEmpty}</span>
                            </div>
                          `}
                    </section>
                  </div>
                `}
        </div>
      </div>
    </section>
  `;
}
