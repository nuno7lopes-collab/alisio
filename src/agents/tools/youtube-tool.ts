import { Type } from "@sinclair/typebox";
import {
  getAlisioYouTubeChannelProfile,
  listAlisioYouTubeUploads,
  readAlisioYouTubeVideo,
} from "../../infra/alisio-youtube.js";
import {
  payloadTextResult,
  readNumberParam,
  readStringParam,
  type AnyAgentTool,
  ToolInputError,
} from "./common.js";

const YouTubeToolSchema = Type.Object({
  action: Type.String({
    description: 'Action to run: "channel", "list_uploads", or "video".',
  }),
  maxResults: Type.Optional(
    Type.Number({
      description: 'Maximum videos to return for action="list_uploads". Defaults to 10.',
    }),
  ),
  videoId: Type.Optional(
    Type.String({
      description: 'YouTube video id or URL for action="video".',
    }),
  ),
});

export function createYouTubeTool(): AnyAgentTool {
  return {
    label: "YouTube",
    name: "youtube",
    ownerOnly: true,
    displaySummary: "Read YouTube channel and video metadata through the connected YouTube app.",
    description:
      "Read YouTube channel and video metadata through the connected YouTube app. Prefer this over browser automation for channel introspection.",
    parameters: YouTubeToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      if (action === "channel") {
        return payloadTextResult(await getAlisioYouTubeChannelProfile());
      }
      if (action === "list_uploads") {
        const maxResults = readNumberParam(params, "maxResults", {
          integer: true,
          strict: true,
        });
        if (maxResults !== undefined && maxResults <= 0) {
          throw new ToolInputError("maxResults must be greater than 0");
        }
        return payloadTextResult(
          await listAlisioYouTubeUploads(maxResults !== undefined ? { maxResults } : {}),
        );
      }
      if (action === "video") {
        const videoId = readStringParam(params, "videoId", {
          required: true,
          label: "videoId",
        });
        return payloadTextResult(await readAlisioYouTubeVideo({ videoId }));
      }
      throw new ToolInputError('action must be "channel", "list_uploads", or "video"');
    },
  };
}
