import { estimateBase64DecodedBytes } from "../media/base64.js";
import { kindFromMime, normalizeMimeType } from "../media/mime.js";
import { sniffMimeFromBase64 } from "../media/sniff-mime-from-base64.js";

export type ChatAttachment = {
  type?: string;
  mimeType?: string;
  fileName?: string;
  content?: unknown;
};

export type ChatImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};

export type ParsedChatAttachment = {
  label: string;
  fileName?: string;
  mimeType: string;
  base64: string;
  sizeBytes: number;
  kind: "image" | "audio" | "video" | "document" | "unknown";
};

export type ParsedMessageWithImages = {
  message: string;
  images: ChatImageContent[];
};

type AttachmentLog = {
  warn: (message: string) => void;
};

type NormalizedAttachment = {
  label: string;
  fileName?: string;
  mime: string;
  base64: string;
};

function isValidBase64(value: string): boolean {
  // Minimal validation; avoid full decode allocations for large payloads.
  return value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function normalizeAttachment(
  att: ChatAttachment,
  idx: number,
  opts: { stripDataUrlPrefix: boolean; requireImageMime: boolean },
): NormalizedAttachment {
  const mime = att.mimeType ?? "";
  const content = att.content;
  const label = att.fileName || att.type || `attachment-${idx + 1}`;

  if (typeof content !== "string") {
    throw new Error(`attachment ${label}: content must be base64 string`);
  }
  if (opts.requireImageMime && !mime.startsWith("image/")) {
    throw new Error(`attachment ${label}: only image/* supported`);
  }

  let base64 = content.trim();
  if (opts.stripDataUrlPrefix) {
    // Strip data URL prefix if present (e.g., "data:image/jpeg;base64,...").
    const dataUrlMatch = /^data:[^;]+;base64,(.*)$/.exec(base64);
    if (dataUrlMatch) {
      base64 = dataUrlMatch[1];
    }
  }
  return {
    label,
    fileName:
      typeof att.fileName === "string" && att.fileName.trim() ? att.fileName.trim() : undefined,
    mime,
    base64,
  };
}

function validateAttachmentBase64OrThrow(
  normalized: NormalizedAttachment,
  opts: { maxBytes: number },
): number {
  if (!isValidBase64(normalized.base64)) {
    throw new Error(`attachment ${normalized.label}: invalid base64 content`);
  }
  const sizeBytes = estimateBase64DecodedBytes(normalized.base64);
  if (sizeBytes <= 0 || sizeBytes > opts.maxBytes) {
    throw new Error(
      `attachment ${normalized.label}: exceeds size limit (${sizeBytes} > ${opts.maxBytes} bytes)`,
    );
  }
  return sizeBytes;
}

function resolveParsedAttachmentKind(mimeType: string): ParsedChatAttachment["kind"] {
  const kind = kindFromMime(mimeType);
  if (kind === "image" || kind === "audio" || kind === "video") {
    return kind;
  }
  if (mimeType === "application/octet-stream") {
    return "unknown";
  }
  return "document";
}

export async function parseChatAttachments(
  attachments: ChatAttachment[] | undefined,
  opts?: { maxBytes?: number; log?: AttachmentLog },
): Promise<ParsedChatAttachment[]> {
  const maxBytes = opts?.maxBytes ?? 5_000_000;
  const log = opts?.log;
  if (!attachments || attachments.length === 0) {
    return [];
  }

  const parsed: ParsedChatAttachment[] = [];

  for (const [idx, att] of attachments.entries()) {
    if (!att) {
      continue;
    }
    const normalized = normalizeAttachment(att, idx, {
      stripDataUrlPrefix: true,
      requireImageMime: false,
    });
    const sizeBytes = validateAttachmentBase64OrThrow(normalized, { maxBytes });
    const providedMime = normalizeMimeType(normalized.mime);
    const sniffedMime = normalizeMimeType(await sniffMimeFromBase64(normalized.base64));
    if (sniffedMime && providedMime && sniffedMime !== providedMime) {
      log?.warn(
        `attachment ${normalized.label}: mime mismatch (${providedMime} -> ${sniffedMime}), using sniffed`,
      );
    } else if (!sniffedMime && !providedMime) {
      log?.warn(
        `attachment ${normalized.label}: unable to detect mime type, defaulting to application/octet-stream`,
      );
    }
    const mimeType = sniffedMime ?? providedMime ?? "application/octet-stream";
    parsed.push({
      label: normalized.label,
      ...(normalized.fileName ? { fileName: normalized.fileName } : {}),
      mimeType,
      base64: normalized.base64,
      sizeBytes,
      kind: resolveParsedAttachmentKind(mimeType),
    });
  }

  return parsed;
}

/**
 * Parse attachments and extract images as structured content blocks.
 * Returns the message text and an array of image content blocks
 * compatible with Claude API's image format.
 */
export async function parseMessageWithAttachments(
  message: string,
  attachments: ChatAttachment[] | undefined,
  opts?: { maxBytes?: number; log?: AttachmentLog },
): Promise<ParsedMessageWithImages> {
  const parsedAttachments = await parseChatAttachments(attachments, opts);
  if (parsedAttachments.length === 0) {
    return { message, images: [] };
  }

  const images = parsedAttachments
    .filter((attachment) => {
      if (attachment.kind === "image") {
        return true;
      }
      opts?.log?.warn(
        `attachment ${attachment.label}: detected non-image (${attachment.mimeType}), dropping from image blocks`,
      );
      return false;
    })
    .map((attachment) => ({
      type: "image" as const,
      data: attachment.base64,
      mimeType: attachment.mimeType,
    }));

  return { message, images };
}
