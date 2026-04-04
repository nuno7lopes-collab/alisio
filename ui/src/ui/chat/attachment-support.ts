const SUPPORTED_CHAT_ATTACHMENT_EXTENSIONS = new Set([
  ".aac",
  ".csv",
  ".doc",
  ".docx",
  ".flac",
  ".gif",
  ".heic",
  ".heif",
  ".jpeg",
  ".jpg",
  ".json",
  ".m4a",
  ".md",
  ".mov",
  ".mp3",
  ".mp4",
  ".ogg",
  ".opus",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".txt",
  ".wav",
  ".webm",
  ".webp",
  ".xls",
  ".xlsx",
  ".zip",
]);

const SUPPORTED_CHAT_ATTACHMENT_MIME_TYPES = new Set([
  "application/gzip",
  "application/json",
  "application/msword",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/x-7z-compressed",
  "application/x-tar",
  "application/zip",
  "text/csv",
  "text/markdown",
  "text/plain",
]);

export const CHAT_ATTACHMENT_ACCEPT = [
  "image/*",
  "audio/*",
  "video/*",
  ".pdf",
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".zip",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
].join(",");

function normalizeAttachmentExtension(fileName: string | null | undefined): string | null {
  if (typeof fileName !== "string") {
    return null;
  }
  const trimmed = fileName.trim().toLowerCase();
  const dotIndex = trimmed.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === trimmed.length - 1) {
    return null;
  }
  return trimmed.slice(dotIndex);
}

export function isImageChatAttachmentMimeType(mimeType: string | null | undefined): boolean {
  return typeof mimeType === "string" && mimeType.trim().toLowerCase().startsWith("image/");
}

export function isSupportedChatAttachmentMimeType(mimeType: string | null | undefined): boolean {
  if (typeof mimeType !== "string") {
    return false;
  }
  const normalized = mimeType.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.startsWith("image/") ||
    normalized.startsWith("audio/") ||
    normalized.startsWith("video/") ||
    SUPPORTED_CHAT_ATTACHMENT_MIME_TYPES.has(normalized)
  );
}

export function isSupportedChatAttachmentFile(file: {
  type?: string | null;
  name?: string | null;
}): boolean {
  return (
    isSupportedChatAttachmentMimeType(file.type) ||
    SUPPORTED_CHAT_ATTACHMENT_EXTENSIONS.has(normalizeAttachmentExtension(file.name) ?? "")
  );
}
