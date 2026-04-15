import { Type } from "@sinclair/typebox";
import {
  createAlisioGoogleDriveTextFile,
  readAlisioGoogleDriveFile,
  searchAlisioGoogleDriveFiles,
} from "../../infra/alisio-google-drive.js";
import {
  payloadTextResult,
  readNumberParam,
  readStringParam,
  type AnyAgentTool,
  ToolInputError,
} from "./common.js";

const GoogleDriveToolSchema = Type.Object({
  action: Type.String({
    description: 'Action to run: "search", "read", or "create_text".',
  }),
  query: Type.Optional(
    Type.String({
      description: 'Optional Google Drive search query for action="search".',
    }),
  ),
  folderId: Type.Optional(
    Type.String({
      description: 'Optional folder id or URL for action="search" or action="create_text".',
    }),
  ),
  maxResults: Type.Optional(
    Type.Number({
      description: 'Maximum files to return for action="search". Defaults to 10.',
    }),
  ),
  fileId: Type.Optional(
    Type.String({
      description: 'Google Drive file id or URL for action="read".',
    }),
  ),
  maxChars: Type.Optional(
    Type.Number({
      description: 'Maximum characters to return for action="read". Defaults to 20000.',
    }),
  ),
  name: Type.Optional(
    Type.String({
      description: 'File name for action="create_text".',
    }),
  ),
  content: Type.Optional(
    Type.String({
      description: 'Optional file content for action="create_text".',
    }),
  ),
  mimeType: Type.Optional(
    Type.String({
      description: 'Optional MIME type for action="create_text". Defaults to text/plain.',
    }),
  ),
});

export function createGoogleDriveTool(): AnyAgentTool {
  return {
    label: "Google Drive",
    name: "google_drive",
    ownerOnly: true,
    displaySummary:
      "Search, read, and create text files in Google Drive through the connected app.",
    description:
      "Search, read, and create text files in Google Drive through the connected Google Drive app. Prefer this over browser automation for Drive work.",
    parameters: GoogleDriveToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      if (action === "search") {
        const query = readStringParam(params, "query");
        const folderId = readStringParam(params, "folderId");
        const maxResults = readNumberParam(params, "maxResults", {
          integer: true,
          strict: true,
        });
        if (maxResults !== undefined && maxResults <= 0) {
          throw new ToolInputError("maxResults must be greater than 0");
        }
        return payloadTextResult(
          await searchAlisioGoogleDriveFiles({
            ...(query ? { query } : {}),
            ...(folderId ? { folderId } : {}),
            ...(maxResults !== undefined ? { maxResults } : {}),
          }),
        );
      }
      if (action === "read") {
        const fileId = readStringParam(params, "fileId", {
          required: true,
          label: "fileId",
        });
        const maxChars = readNumberParam(params, "maxChars", {
          integer: true,
          strict: true,
        });
        if (maxChars !== undefined && maxChars <= 0) {
          throw new ToolInputError("maxChars must be greater than 0");
        }
        return payloadTextResult(
          await readAlisioGoogleDriveFile({
            fileId,
            ...(maxChars !== undefined ? { maxChars } : {}),
          }),
        );
      }
      if (action === "create_text") {
        const folderId = readStringParam(params, "folderId");
        const mimeType = readStringParam(params, "mimeType");
        const name = readStringParam(params, "name", {
          required: true,
          label: "name",
        });
        const content = readStringParam(params, "content", {
          trim: false,
          allowEmpty: true,
        });
        return payloadTextResult(
          await createAlisioGoogleDriveTextFile({
            name,
            ...(content !== undefined ? { content } : {}),
            ...(folderId ? { folderId } : {}),
            ...(mimeType ? { mimeType } : {}),
          }),
        );
      }
      throw new ToolInputError('action must be "search", "read", or "create_text"');
    },
  };
}
