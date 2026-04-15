import { Type } from "@sinclair/typebox";
import {
  createAlisioGoogleDocument,
  readAlisioGoogleDocument,
} from "../../infra/alisio-google-docs.js";
import {
  payloadTextResult,
  readNumberParam,
  readStringParam,
  type AnyAgentTool,
  ToolInputError,
} from "./common.js";

const GoogleDocsToolSchema = Type.Object({
  action: Type.String({
    description: 'Action to run: "create" or "read".',
  }),
  title: Type.Optional(
    Type.String({
      description: 'Document title. Required for action="create".',
    }),
  ),
  content: Type.Optional(
    Type.String({
      description: 'Document body text to insert when action="create".',
    }),
  ),
  documentId: Type.Optional(
    Type.String({
      description: 'Google Docs document id or full document URL. Required for action="read".',
    }),
  ),
  maxChars: Type.Optional(
    Type.Number({
      description: 'Maximum characters to return for action="read". Defaults to 20000.',
    }),
  ),
});

export function createGoogleDocsTool(): AnyAgentTool {
  return {
    label: "Google Docs",
    name: "google_docs",
    ownerOnly: true,
    displaySummary: "Create and read Google Docs through the connected Google Docs app.",
    description:
      "Create and read Google Docs through the connected Google Docs app. Prefer this over browser automation for document work because it uses the stored connector directly.",
    parameters: GoogleDocsToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      if (action === "create") {
        const title = readStringParam(params, "title", { required: true });
        const content = readStringParam(params, "content", { trim: false });
        return payloadTextResult(
          await createAlisioGoogleDocument({
            title,
            ...(content !== undefined ? { content } : {}),
          }),
        );
      }
      if (action === "read") {
        const documentId = readStringParam(params, "documentId", {
          required: true,
          label: "documentId",
        });
        const maxChars = readNumberParam(params, "maxChars", { integer: true, strict: true });
        if (maxChars !== undefined && maxChars <= 0) {
          throw new ToolInputError("maxChars must be greater than 0");
        }
        return payloadTextResult(
          await readAlisioGoogleDocument({
            documentId,
            ...(maxChars !== undefined ? { maxChars } : {}),
          }),
        );
      }
      throw new ToolInputError('action must be "create" or "read"');
    },
  };
}
