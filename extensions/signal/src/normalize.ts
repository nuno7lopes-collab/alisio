// Route Signal target normalization through the canonical SDK helper surface
// so the bundled plugin does not carry a second copy of the same logic.
export {
  looksLikeSignalTargetId,
  normalizeSignalMessagingTarget,
} from "alisio/plugin-sdk/channel-runtime";
