import { defineChannelPluginEntry } from "alisio/plugin-sdk/core";
import { synologyChatPlugin } from "./src/channel.js";
import { setSynologyRuntime } from "./src/runtime.js";

export { synologyChatPlugin } from "./src/channel.js";
export { setSynologyRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "synology-chat",
  name: "Synology Chat",
  description: "Native Synology Chat channel plugin for Alisio",
  plugin: synologyChatPlugin,
  setRuntime: setSynologyRuntime,
});
