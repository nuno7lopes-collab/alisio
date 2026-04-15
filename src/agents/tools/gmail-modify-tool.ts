import { Type } from "@sinclair/typebox";
import { modifyAlisioGmailMessage } from "../../infra/alisio-gmail.js";
import {
  payloadTextResult,
  readStringArrayParam,
  readStringParam,
  type AnyAgentTool,
  ToolInputError,
} from "./common.js";

const GmailModifyToolSchema = Type.Object({
  action: Type.String({
    description:
      'Action to run: "archive", "trash", "mark_read", "mark_unread", "add_labels", or "remove_labels".',
  }),
  messageId: Type.String({
    description: "Gmail message id to modify.",
  }),
  labelIds: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Label ids for actions "add_labels" or "remove_labels".',
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

export function createGmailModifyTool(): AnyAgentTool {
  return {
    label: "Gmail Modify",
    name: "gmail_modify",
    ownerOnly: true,
    displaySummary: "Archive, label, and mark Gmail messages through Gmail Modify.",
    description:
      "Archive, trash, mark read or unread, and update Gmail labels through the linked Gmail Modify connector. Prefer this over browser automation for inbox cleanup.",
    parameters: GmailModifyToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true }) as
        | "archive"
        | "trash"
        | "mark_read"
        | "mark_unread"
        | "add_labels"
        | "remove_labels";
      if (
        !["archive", "trash", "mark_read", "mark_unread", "add_labels", "remove_labels"].includes(
          action,
        )
      ) {
        throw new ToolInputError(
          'action must be "archive", "trash", "mark_read", "mark_unread", "add_labels", or "remove_labels"',
        );
      }
      const messageId = readStringParam(params, "messageId", {
        required: true,
        label: "messageId",
      });
      const labelIds = readCsvStringArrayParam(params, "labelIds");
      if (
        (action === "add_labels" || action === "remove_labels") &&
        (!labelIds || labelIds.length === 0)
      ) {
        throw new ToolInputError("labelIds required for add_labels/remove_labels");
      }
      return payloadTextResult(
        await modifyAlisioGmailMessage({
          action,
          messageId,
          ...(labelIds ? { labelIds } : {}),
        }),
      );
    },
  };
}
