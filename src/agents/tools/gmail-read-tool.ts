import { Type } from "@sinclair/typebox";
import { readAlisioGmailMessage, searchAlisioGmailMessages } from "../../infra/alisio-gmail.js";
import {
  payloadTextResult,
  readNumberParam,
  readStringArrayParam,
  readStringParam,
  type AnyAgentTool,
  ToolInputError,
} from "./common.js";

const GmailReadToolSchema = Type.Object({
  action: Type.String({
    description: 'Action to run: "search" or "get".',
  }),
  query: Type.Optional(
    Type.String({
      description: 'Gmail search query for action="search".',
    }),
  ),
  messageId: Type.Optional(
    Type.String({
      description: 'Gmail message id for action="get".',
    }),
  ),
  labelIds: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Optional Gmail label ids for action="search".',
    }),
  ),
  maxResults: Type.Optional(
    Type.Number({
      description: 'Maximum number of messages to list for action="search". Defaults to 5.',
    }),
  ),
  maxChars: Type.Optional(
    Type.Number({
      description: 'Maximum characters to return for action="get". Defaults to 20000.',
    }),
  ),
  includeSpamTrash: Type.Optional(
    Type.Boolean({
      description: 'Include spam and trash in action="search". Defaults to false.',
    }),
  ),
});

function readCsvStringArrayParam(
  params: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const rawValues = readStringArrayParam(params, key);
  if (!rawValues) {
    return undefined;
  }
  const values = rawValues
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

export function createGmailReadTool(): AnyAgentTool {
  return {
    label: "Gmail Read",
    name: "gmail_read",
    ownerOnly: true,
    displaySummary: "Search and read Gmail messages through the linked Gmail connectors.",
    description:
      "Search and read Gmail messages through the linked Gmail Read or Gmail Modify connectors. Prefer this over browser automation for inbox work.",
    parameters: GmailReadToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      if (action === "search") {
        const query = readStringParam(params, "query");
        const labelIds = readCsvStringArrayParam(params, "labelIds");
        const maxResults = readNumberParam(params, "maxResults", { integer: true, strict: true });
        if (maxResults !== undefined && maxResults <= 0) {
          throw new ToolInputError("maxResults must be greater than 0");
        }
        return payloadTextResult(
          await searchAlisioGmailMessages({
            ...(query ? { query } : {}),
            ...(labelIds ? { labelIds } : {}),
            ...(maxResults !== undefined ? { maxResults } : {}),
            ...(typeof params.includeSpamTrash === "boolean"
              ? { includeSpamTrash: params.includeSpamTrash }
              : {}),
          }),
        );
      }
      if (action === "get") {
        const messageId = readStringParam(params, "messageId", {
          required: true,
          label: "messageId",
        });
        const maxChars = readNumberParam(params, "maxChars", { integer: true, strict: true });
        if (maxChars !== undefined && maxChars <= 0) {
          throw new ToolInputError("maxChars must be greater than 0");
        }
        return payloadTextResult(
          await readAlisioGmailMessage({
            messageId,
            ...(maxChars !== undefined ? { maxChars } : {}),
          }),
        );
      }
      throw new ToolInputError('action must be "search" or "get"');
    },
  };
}
