import {
  buildChannelConfigSchema,
  GoogleChatConfigSchema,
} from "alisio/plugin-sdk/channel-config-schema";

export const GoogleChatChannelConfigSchema = buildChannelConfigSchema(GoogleChatConfigSchema);
