export const PRODUCT_CHAT_CHANNEL_IDS = ["telegram", "whatsapp", "discord"] as const;

export type ProductChatChannelId = (typeof PRODUCT_CHAT_CHANNEL_IDS)[number];
export type ProductChannelSurfaceMode = "focused" | "all";

const PRODUCT_CHAT_CHANNEL_ID_SET = new Set<string>(PRODUCT_CHAT_CHANNEL_IDS);

export function isProductChatChannelId(
  value: string | null | undefined,
): value is ProductChatChannelId {
  return typeof value === "string" && PRODUCT_CHAT_CHANNEL_ID_SET.has(value);
}
