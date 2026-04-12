import type {
  MemoryFileDetail,
  MemoryFileDownload,
  MemoryFileLink,
  MemoryFilePreview,
  MemoryFilePreviewKind,
} from "./memory-runtime.ts";

export type MemoryFilePreviewModel =
  | {
      kind: "markdown" | "text" | "json";
      mediaType: string;
      text: string;
      truncated: boolean;
      lineCount: number | null;
      fallbackLabel: null;
      src: null;
    }
  | {
      kind: "image" | "audio" | "pdf";
      mediaType: string;
      text: null;
      truncated: false;
      lineCount: null;
      fallbackLabel: string | null;
      src: string | null;
    }
  | {
      kind: "binary";
      mediaType: string;
      text: null;
      truncated: false;
      lineCount: null;
      fallbackLabel: string;
      src: null;
    };

export type MemoryFileActionModel = {
  openHref: string | null;
  download: MemoryFileDownload | null;
  primaryPage: MemoryFileLink | null;
};

export function formatMemoryFilePreviewKind(kind: MemoryFilePreviewKind) {
  switch (kind) {
    case "markdown":
      return "Markdown";
    case "text":
      return "Text";
    case "json":
      return "JSON";
    case "image":
      return "Image";
    case "audio":
      return "Audio";
    case "pdf":
      return "PDF";
    default:
      return "Binary";
  }
}

export function buildMemoryFileDataUrl(
  mediaType: string | null | undefined,
  bytesBase64: string | null | undefined,
) {
  const resolvedMediaType = mediaType?.trim() || "application/octet-stream";
  const resolvedBytes = bytesBase64?.trim() || "";
  if (!resolvedBytes) {
    return null;
  }
  return `data:${resolvedMediaType};base64,${resolvedBytes}`;
}

function normalizePreview(
  preview: MemoryFilePreview | null | undefined,
): MemoryFilePreview & { kind: MemoryFilePreviewKind } {
  return {
    kind: preview?.kind ?? "binary",
    mediaType: preview?.mediaType?.trim() || "application/octet-stream",
    ...(typeof preview?.text === "string" ? { text: preview.text } : {}),
    ...(typeof preview?.bytesBase64 === "string" ? { bytesBase64: preview.bytesBase64 } : {}),
    ...(typeof preview?.truncated === "boolean" ? { truncated: preview.truncated } : {}),
    ...(typeof preview?.lineCount === "number" ? { lineCount: preview.lineCount } : {}),
    ...(typeof preview?.fallbackLabel === "string"
      ? { fallbackLabel: preview.fallbackLabel }
      : {}),
  };
}

export function buildMemoryFilePreviewModel(
  file: MemoryFileDetail | null | undefined,
): MemoryFilePreviewModel | null {
  if (!file) {
    return null;
  }
  const preview = normalizePreview(file.preview);
  if (preview.kind === "markdown" || preview.kind === "text" || preview.kind === "json") {
    return {
      kind: preview.kind,
      mediaType: preview.mediaType,
      text: preview.text ?? "",
      truncated: preview.truncated === true,
      lineCount: typeof preview.lineCount === "number" ? preview.lineCount : null,
      fallbackLabel: null,
      src: null,
    };
  }
  if (preview.kind === "image" || preview.kind === "audio" || preview.kind === "pdf") {
    return {
      kind: preview.kind,
      mediaType: preview.mediaType,
      text: null,
      truncated: false,
      lineCount: null,
      fallbackLabel: preview.fallbackLabel ?? null,
      src: buildMemoryFileDataUrl(preview.mediaType, preview.bytesBase64),
    };
  }
  return {
    kind: "binary",
    mediaType: preview.mediaType,
    text: null,
    truncated: false,
    lineCount: null,
    fallbackLabel:
      preview.fallbackLabel ?? "No safe inline preview is available for this attachment type.",
    src: null,
  };
}

export function buildMemoryFileActionModel(
  file: MemoryFileDetail | null | undefined,
): MemoryFileActionModel {
  if (!file) {
    return {
      openHref: null,
      download: null,
      primaryPage: null,
    };
  }
  return {
    openHref: buildMemoryFileDataUrl(file.download.mediaType, file.download.bytesBase64),
    download: file.download ?? null,
    primaryPage: file.primaryPage ?? file.relatedPages?.[0] ?? null,
  };
}
