import { stripInboundMetadata } from "../../../../src/auto-reply/reply/strip-inbound-meta.js";
import { stripEnvelope } from "../../../../src/shared/chat-envelope.js";
import { stripThinkingTags } from "../format.ts";

const textCache = new WeakMap<object, string | null>();
const thinkingCache = new WeakMap<object, string | null>();

type ThinkingBlockInfo = {
  text: string;
  signatureType: string | null;
};

export type ThinkingSummary = {
  source: "summary" | "raw";
  label: string;
  meta: string;
  preview: string | null;
  lineCount: number;
};

function extractStructuredThinkingBlocks(message: unknown): ThinkingBlockInfo[] {
  const m = message as Record<string, unknown>;
  const content = m.content;
  const blocks: ThinkingBlockInfo[] = [];
  if (!Array.isArray(content)) {
    return blocks;
  }
  for (const p of content) {
    const item = p as Record<string, unknown>;
    if (item.type !== "thinking" || typeof item.thinking !== "string") {
      continue;
    }
    const cleaned = item.thinking.trim();
    if (!cleaned) {
      continue;
    }
    blocks.push({
      text: cleaned,
      signatureType: extractThinkingBlockSignatureType(item),
    });
  }
  return blocks;
}

function processMessageText(text: string, role: string): string {
  const shouldStripInboundMetadata = role.toLowerCase() === "user";
  if (role === "assistant") {
    return stripThinkingTags(text);
  }
  return shouldStripInboundMetadata
    ? stripInboundMetadata(stripEnvelope(text))
    : stripEnvelope(text);
}

export function extractText(message: unknown): string | null {
  const m = message as Record<string, unknown>;
  const role = typeof m.role === "string" ? m.role : "";
  const raw = extractRawText(message);
  if (!raw) {
    return null;
  }
  return processMessageText(raw, role);
}

export function extractTextCached(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return extractText(message);
  }
  const obj = message;
  if (textCache.has(obj)) {
    return textCache.get(obj) ?? null;
  }
  const value = extractText(message);
  textCache.set(obj, value);
  return value;
}

export function extractThinking(message: unknown): string | null {
  const parts = extractStructuredThinkingBlocks(message).map((block) => block.text);
  if (parts.length > 0) {
    return parts.join("\n");
  }

  // Back-compat: older logs may still have <think> tags inside text blocks.
  const rawText = extractRawText(message);
  if (!rawText) {
    return null;
  }
  const matches = [
    ...rawText.matchAll(/<\s*think(?:ing)?\s*>([\s\S]*?)<\s*\/\s*think(?:ing)?\s*>/gi),
  ];
  const extracted = matches.map((m) => (m[1] ?? "").trim()).filter(Boolean);
  return extracted.length > 0 ? extracted.join("\n") : null;
}

export function extractThinkingCached(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return extractThinking(message);
  }
  const obj = message;
  if (thinkingCache.has(obj)) {
    return thinkingCache.get(obj) ?? null;
  }
  const value = extractThinking(message);
  thinkingCache.set(obj, value);
  return value;
}

function normalizeThinkingLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function truncatePreview(text: string, max = 140): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function extractThinkingBlockSignatureType(item: Record<string, unknown>): string | null {
  const signature = item.thinkingSignature;
  if (signature && typeof signature === "object") {
    const type = (signature as { type?: unknown }).type;
    return typeof type === "string" && type.trim() ? type : null;
  }
  if (typeof signature === "string") {
    try {
      const parsed = JSON.parse(signature) as { type?: unknown };
      return typeof parsed.type === "string" && parsed.type.trim() ? parsed.type : null;
    } catch {
      const trimmed = signature.trim();
      return trimmed ? trimmed : null;
    }
  }
  return null;
}

export function extractThinkingSummaryText(message: unknown): string | null {
  const summaryBlocks = extractStructuredThinkingBlocks(message)
    .filter((block) => block.signatureType === "reasoning.summary")
    .map((block) => block.text);
  if (summaryBlocks.length === 0) {
    return null;
  }
  return summaryBlocks.join("\n");
}

export function extractThinkingSummary(message: unknown): ThinkingSummary | null {
  const summaryText = extractThinkingSummaryText(message);
  if (summaryText) {
    const lines = normalizeThinkingLines(summaryText);
    return {
      source: "summary",
      label: "Reasoning summary",
      meta: lines.length === 1 ? "1 note" : `${lines.length} notes`,
      preview: truncatePreview(lines.slice(0, 2).join(" ")),
      lineCount: lines.length,
    };
  }

  const thinking = extractThinkingCached(message);
  if (!thinking) {
    return null;
  }
  const lines = normalizeThinkingLines(thinking);
  if (lines.length === 0) {
    return null;
  }

  return {
    source: "raw",
    label: "Internal reasoning",
    meta: lines.length === 1 ? "1 block" : `${lines.length} blocks`,
    preview: null,
    lineCount: lines.length,
  };
}

export function extractRawText(message: unknown): string | null {
  const m = message as Record<string, unknown>;
  const content = m.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = content
      .map((p) => {
        const item = p as Record<string, unknown>;
        if (item.type === "text" && typeof item.text === "string") {
          return item.text;
        }
        return null;
      })
      .filter((v): v is string => typeof v === "string");
    if (parts.length > 0) {
      return parts.join("\n");
    }
  }
  if (typeof m.text === "string") {
    return m.text;
  }
  return null;
}

export function formatReasoningMarkdown(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `_${line}_`);
  return lines.length ? ["_Reasoning:_", ...lines].join("\n") : "";
}
