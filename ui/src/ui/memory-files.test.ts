/* @vitest-environment jsdom */

import { html, render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildMemoryFileActionModel,
  buildMemoryFileDataUrl,
  buildMemoryFilePreviewModel,
} from "./controllers/memory-files-preview.ts";
import type { MemoryFileDetail, MemoryFilesListResult } from "./controllers/memory-runtime.ts";
import {
  buildMemoryNoteName,
  humanizeMemoryNoteTitle,
  isLongTermMemoryFileName,
  isMemoryNoteFileName,
  todayMemoryDate,
} from "./memory-files.ts";
import { renderMemoryFilePreview } from "./views/memory/files-preview.ts";
import { renderMemoryFilesView } from "./views/memory/files-view.ts";

describe("memory-files", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("uses the local calendar date for new notes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 6, 23, 59, 0));

    expect(todayMemoryDate()).toBe("2026-04-06");
  });

  it("builds dated note paths and avoids duplicates", () => {
    expect(
      buildMemoryNoteName("2026-04-06", "Trip planning", [
        "memory/2026-04-06-trip-planning.md",
        "memory/2026-04-06-trip-planning-2.md",
      ]),
    ).toBe("memory/2026-04-06-trip-planning-3.md");
  });

  it("humanizes dated note names for the UI", () => {
    expect(humanizeMemoryNoteTitle("memory/2026-04-06-trip-planning.md")).toBe("Trip Planning");
    expect(humanizeMemoryNoteTitle("memory/2026-04-06.md")).toBe("2026-04-06");
  });

  it("distinguishes durable memory files from note files", () => {
    expect(isLongTermMemoryFileName("MEMORY.md")).toBe(true);
    expect(isLongTermMemoryFileName("memory.md")).toBe(false);
    expect(isMemoryNoteFileName("memory/2026-04-06.md")).toBe(true);
    expect(isMemoryNoteFileName("AGENTS.md")).toBe(false);
  });
});

const filesViewText = {
  none: "None",
  na: "N/A",
  preview: "Preview",
  previewEmpty: "No preview",
  viewTrace: "View trace",
  traceTitle: "Retrieval trace",
  filesTitle: "Files",
  filesEmpty: "No attachments",
  filesProvenance: "Provenance",
  filesRelatedPages: "Related pages",
  filesMediaType: "Media type",
  filesSize: "Size",
  filesUpdated: "Updated",
  filesSummary: "Summary",
  filesHash: "SHA-256",
  filesPreviewKind: "Preview type",
  filesOpen: "Open",
  filesDownload: "Download",
  filesOpenPage: "Open page",
  filesFocusGraph: "Focus graph",
  filesPreviewUnavailable: "Preview unavailable",
  filesPreviewTruncated: "Preview truncated",
  filesNoSelection: "Choose an attachment",
};

function createFilesList(): MemoryFilesListResult {
  return {
    agentId: "main",
    files: [
      {
        id: "brief",
        name: "product-brief.pdf",
        mediaType: "application/pdf",
        previewKind: "pdf",
        size: 1024,
        sha256: "sha-product-brief",
        updatedAt: "2026-04-11T10:10:00Z",
        summary: "Product brief for Project Atlas",
        provenanceSummary: "Imported from project-atlas.md",
        relatedPagesCount: 1,
        primaryPage: {
          pageId: "atlas",
          entityId: "atlas",
          title: "Project Atlas",
          path: "memory/project-atlas.md",
          relation: "mentioned",
        },
        provenance: [{ label: "Source", value: "project-atlas.md" }],
        reasonTags: [{ code: "attachment", label: "Attachment" }],
        trace: { query: "brief" },
      },
    ],
  };
}

function createFileDetail(): MemoryFileDetail {
  return {
    ...createFilesList().files[0],
    preview: {
      kind: "pdf",
      mediaType: "application/pdf",
      bytesBase64: "YnJpZWY=",
    },
    download: {
      fileName: "product-brief.pdf",
      mediaType: "application/pdf",
      bytesBase64: "YnJpZWY=",
    },
    relatedPages: [
      {
        pageId: "atlas",
        entityId: "atlas",
        title: "Project Atlas",
        path: "memory/project-atlas.md",
        relation: "mentioned",
      },
      {
        pageId: "roadmap",
        entityId: "roadmap",
        title: "Roadmap",
        path: "memory/roadmap.md",
        relation: "attached",
      },
    ],
  };
}

describe("memory files preview helpers", () => {
  it("builds data urls for inline previews and open actions", () => {
    expect(buildMemoryFileDataUrl("application/pdf", "YnJpZWYtcGRm")).toBe(
      "data:application/pdf;base64,YnJpZWYtcGRm",
    );
  });

  it("normalizes text previews for markdown attachments", () => {
    const preview = buildMemoryFilePreviewModel({
      ...createFileDetail(),
      name: "atlas.md",
      mediaType: "text/markdown",
      previewKind: "markdown",
      preview: {
        kind: "markdown",
        mediaType: "text/markdown",
        text: "# Atlas\n\nLaunch blockers remain.",
        truncated: false,
        lineCount: 3,
      },
    });

    expect(preview).toEqual({
      kind: "markdown",
      mediaType: "text/markdown",
      text: "# Atlas\n\nLaunch blockers remain.",
      truncated: false,
      lineCount: 3,
      fallbackLabel: null,
      src: null,
    });
  });

  it("keeps binary previews on a safe fallback path", () => {
    const preview = buildMemoryFilePreviewModel({
      ...createFileDetail(),
      name: "archive.bin",
      mediaType: "application/octet-stream",
      previewKind: "binary",
      preview: {
        kind: "binary",
        mediaType: "application/octet-stream",
        fallbackLabel: "No safe inline preview is available for this attachment type.",
      },
    });

    expect(preview).toEqual({
      kind: "binary",
      mediaType: "application/octet-stream",
      text: null,
      truncated: false,
      lineCount: null,
      fallbackLabel: "No safe inline preview is available for this attachment type.",
      src: null,
    });
  });

  it("exposes open/download actions from the file detail payload", () => {
    const actions = buildMemoryFileActionModel(createFileDetail());

    expect(actions.openHref).toBe("data:application/pdf;base64,YnJpZWY=");
    expect(actions.download?.fileName).toBe("product-brief.pdf");
    expect(actions.primaryPage?.pageId).toBe("atlas");
  });
});

describe("memory files preview view", () => {
  it("renders markdown previews as sanitized html", () => {
    const container = document.createElement("div");
    render(
      renderMemoryFilePreview({
        text: {
          previewLabel: "Preview",
          previewEmpty: "No preview",
          previewUnavailable: "Preview unavailable",
          previewTruncated: "Preview truncated",
        },
        preview: {
          kind: "markdown",
          mediaType: "text/markdown",
          text: "# Atlas\n\nLaunch blockers remain.",
          truncated: false,
          lineCount: 3,
          fallbackLabel: null,
          src: null,
        },
      }),
      container,
    );

    expect(container.querySelector(".sidebar-markdown")?.textContent).toContain("Atlas");
  });

  it("renders iframe previews for pdf attachments", () => {
    const container = document.createElement("div");
    render(
      renderMemoryFilePreview({
        text: {
          previewLabel: "Preview",
          previewEmpty: "No preview",
          previewUnavailable: "Preview unavailable",
          previewTruncated: "Preview truncated",
        },
        preview: {
          kind: "pdf",
          mediaType: "application/pdf",
          text: null,
          truncated: false,
          lineCount: null,
          fallbackLabel: null,
          src: "data:application/pdf;base64,YnJpZWYtcGRm",
        },
      }),
      container,
    );

    expect(container.querySelector("iframe")?.getAttribute("src")).toContain("application/pdf");
  });

  it("falls back safely for binary attachments", () => {
    const container = document.createElement("div");
    render(
      renderMemoryFilePreview({
        text: {
          previewLabel: "Preview",
          previewEmpty: "No preview",
          previewUnavailable: "Preview unavailable",
          previewTruncated: "Preview truncated",
        },
        preview: {
          kind: "binary",
          mediaType: "application/octet-stream",
          text: null,
          truncated: false,
          lineCount: null,
          fallbackLabel: "No safe inline preview is available for this attachment type.",
          src: null,
        },
      }),
      container,
    );

    expect(container.textContent).toContain("No safe inline preview");
  });
});

describe("memory files view", () => {
  it("renders rich metadata, preview actions, and canonical related page actions", () => {
    const onSelectFile = vi.fn();
    const onOpenAttachment = vi.fn();
    const onDownloadAttachment = vi.fn();
    const onOpenWikiPage = vi.fn();
    const onFocusGraphPage = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    render(
      renderMemoryFilesView({
        text: filesViewText,
        filesLoading: false,
        filesError: null,
        filesList: createFilesList(),
        selectedFileId: "brief",
        fileLoading: false,
        fileError: null,
        fileDetail: createFileDetail(),
        renderReasonTags: (tags) =>
          html`${tags?.map((tag) => html`<span>${tag.label}</span>`) ?? html``}`,
        renderProvenance: (rows) =>
          html`${rows?.map((row) => html`<div>${row.label}: ${row.value}</div>`) ?? html``}`,
        renderTraceAction: ({ traceId }) =>
          traceId ? html`<button type="button">View trace</button>` : html``,
        formatBytes: (value) => (typeof value === "number" ? `${value} B` : null),
        formatTimestamp: (value) => value ?? null,
        onSelectFile,
        onOpenAttachment,
        onDownloadAttachment,
        onOpenWikiPage,
        onFocusGraphPage,
      }),
      container,
    );

    expect(container.textContent).toContain("product-brief.pdf");
    expect(container.textContent).toContain("Product brief for Project Atlas");
    expect(container.textContent).toContain("SHA-256");
    expect(container.textContent).toContain("sha-product-brief");
    expect(container.textContent).toContain("Project Atlas");
    expect(container.textContent).toContain("Roadmap");

    const fileButton = container.querySelector(".alisio-memory-file") as HTMLButtonElement | null;
    fileButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSelectFile).toHaveBeenCalledWith("brief");

    const buttons = Array.from(container.querySelectorAll("button"));
    buttons.find((entry) => entry.textContent?.includes("Open"))?.click();
    buttons.find((entry) => entry.textContent?.includes("Download"))?.click();

    const openPageButtons = buttons.filter((entry) => entry.textContent?.includes("Open page"));
    const focusGraphButtons = buttons.filter((entry) => entry.textContent?.includes("Focus graph"));
    openPageButtons[0]?.click();
    focusGraphButtons[1]?.click();

    expect(onOpenAttachment).toHaveBeenCalledTimes(1);
    expect(onDownloadAttachment).toHaveBeenCalledTimes(1);
    expect(onOpenWikiPage).toHaveBeenCalledWith("atlas");
    expect(onFocusGraphPage).toHaveBeenCalledWith("roadmap");
  });

  it("shows the empty detail state when no file is selected", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    render(
      renderMemoryFilesView({
        text: filesViewText,
        filesLoading: false,
        filesError: null,
        filesList: { agentId: "main", files: [] },
        selectedFileId: null,
        fileLoading: false,
        fileError: null,
        fileDetail: null,
        renderReasonTags: () => html``,
        renderProvenance: () => html``,
        renderTraceAction: () => html``,
        formatBytes: () => null,
        formatTimestamp: () => null,
        onSelectFile: vi.fn(),
        onOpenAttachment: vi.fn(),
        onDownloadAttachment: vi.fn(),
        onOpenWikiPage: vi.fn(),
        onFocusGraphPage: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toContain("No attachments");
    expect(container.textContent).toContain("Choose an attachment");
  });
});
