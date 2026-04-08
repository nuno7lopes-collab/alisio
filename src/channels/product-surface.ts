import type { ChatChannelMeta } from "./chat-meta.js";
import { listChannelPlugins } from "./plugins/index.js";
import type { ChannelPlugin } from "./plugins/types.js";
import { listChatChannels } from "./registry.js";

export const PRODUCT_CHAT_CHANNEL_IDS = ["telegram", "whatsapp", "discord"] as const;

export type ProductChatChannelId = (typeof PRODUCT_CHAT_CHANNEL_IDS)[number];

const PRODUCT_CHAT_CHANNEL_ID_SET = new Set<string>(PRODUCT_CHAT_CHANNEL_IDS);

export function isProductChatChannelId(
  value: string | null | undefined,
): value is ProductChatChannelId {
  return typeof value === "string" && PRODUCT_CHAT_CHANNEL_ID_SET.has(value);
}

export function listProductChatChannels(): ChatChannelMeta[] {
  return listChatChannels().filter((channel) => isProductChatChannelId(channel.id));
}

export function filterProductChannelEntries<T extends { id: string }>(entries: readonly T[]): T[] {
  return entries.filter((entry) => isProductChatChannelId(entry.id));
}

export function listProductChannelPlugins(): ChannelPlugin[] {
  return filterProductChannelEntries(listChannelPlugins());
}
