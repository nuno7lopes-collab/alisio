import type { ChatChannelMeta } from "./chat-meta.js";
import { listChannelPlugins } from "./plugins/index.js";
import type { ChannelPlugin } from "./plugins/types.js";
import { listChatChannels } from "./registry.js";

export const PRODUCT_CHAT_CHANNEL_IDS = ["telegram", "whatsapp", "discord"] as const;
export const CHANNEL_SURFACE_MODE_ENV = "OPENCLAW_CHANNEL_SURFACE";
export const EXPERIMENTAL_CHANNELS_ENV = "OPENCLAW_EXPERIMENTAL_CHANNELS";

export type ProductChatChannelId = (typeof PRODUCT_CHAT_CHANNEL_IDS)[number];
export type ProductChannelSurfaceMode = "focused" | "all";

const PRODUCT_CHAT_CHANNEL_ID_SET = new Set<string>(PRODUCT_CHAT_CHANNEL_IDS);

export function isProductChatChannelId(
  value: string | null | undefined,
): value is ProductChatChannelId {
  return typeof value === "string" && PRODUCT_CHAT_CHANNEL_ID_SET.has(value);
}

function isTruthySurfaceFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function resolveProductChannelSurfaceMode(
  env: NodeJS.ProcessEnv = process.env,
): ProductChannelSurfaceMode {
  const explicitMode = env[CHANNEL_SURFACE_MODE_ENV]?.trim().toLowerCase();
  if (explicitMode === "all" || explicitMode === "advanced" || explicitMode === "experimental") {
    return "all";
  }
  if (isTruthySurfaceFlag(env[EXPERIMENTAL_CHANNELS_ENV])) {
    return "all";
  }
  return "focused";
}

export function shouldExposeChannelInProductSurface(
  value: string | null | undefined,
  options?: { env?: NodeJS.ProcessEnv },
): boolean {
  if (isProductChatChannelId(value)) {
    return true;
  }
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    resolveProductChannelSurfaceMode(options?.env) === "all"
  );
}

export function listProductChatChannels(options?: { env?: NodeJS.ProcessEnv }): ChatChannelMeta[] {
  return filterProductChannelEntries(listChatChannels(), options);
}

export function filterProductChannelEntries<T extends { id: string }>(
  entries: readonly T[],
  options?: { env?: NodeJS.ProcessEnv },
): T[] {
  return entries.filter((entry) => shouldExposeChannelInProductSurface(entry.id, options));
}

export function listProductChannelPlugins(options?: { env?: NodeJS.ProcessEnv }): ChannelPlugin[] {
  return filterProductChannelEntries(listChannelPlugins(), options);
}
