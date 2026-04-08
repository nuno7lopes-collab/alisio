import { defineSetupPluginEntry } from "alisio/plugin-sdk/core";
import { googlechatPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(googlechatPlugin);
