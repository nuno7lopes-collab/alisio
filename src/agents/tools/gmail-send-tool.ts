import { Type } from "@sinclair/typebox";
import { sendAlisioGmailMessage } from "../../infra/alisio-store.js";
import {
  payloadTextResult,
  readStringParam,
  textResult,
  type AnyAgentTool,
  ToolInputError,
} from "./common.js";

const GmailSendToolSchema = Type.Object({
  to: Type.String({
    description: "Recipient email address or a comma-separated recipient list.",
  }),
  subject: Type.String({
    description: "Email subject line.",
  }),
  body: Type.String({
    description: "Email body content.",
  }),
  bodyFormat: Type.Optional(
    Type.String({
      description: 'Body format: "text" or "html". Defaults to "text".',
    }),
  ),
  cc: Type.Optional(
    Type.String({
      description: "Optional CC recipient list, comma-separated.",
    }),
  ),
  bcc: Type.Optional(
    Type.String({
      description: "Optional BCC recipient list, comma-separated.",
    }),
  ),
  replyTo: Type.Optional(
    Type.String({
      description: "Optional Reply-To address.",
    }),
  ),
  threadId: Type.Optional(
    Type.String({
      description: "Optional Gmail thread id to append to an existing thread.",
    }),
  ),
});

export function createGmailSendTool(): AnyAgentTool {
  return {
    label: "Gmail Send",
    name: "gmail_send",
    ownerOnly: true,
    displaySummary: "Send an email through the Gmail account connected in Alisio.",
    description:
      "Send an email through the Gmail account connected in Alisio. Requires the Gmail Send connector to be connected first.",
    parameters: GmailSendToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const to = readStringParam(params, "to", { required: true });
      const subject = readStringParam(params, "subject", { required: true });
      const body = readStringParam(params, "body", { required: true, trim: false });
      const cc = readStringParam(params, "cc");
      const bcc = readStringParam(params, "bcc");
      const replyTo = readStringParam(params, "replyTo");
      const threadId = readStringParam(params, "threadId");
      const bodyFormatRaw = readStringParam(params, "bodyFormat");
      if (bodyFormatRaw && bodyFormatRaw !== "text" && bodyFormatRaw !== "html") {
        throw new ToolInputError('bodyFormat must be "text" or "html"');
      }
      const bodyFormat = bodyFormatRaw as "text" | "html" | undefined;

      const result = await sendAlisioGmailMessage({
        to,
        subject,
        body,
        ...(cc ? { cc } : {}),
        ...(bcc ? { bcc } : {}),
        ...(replyTo ? { replyTo } : {}),
        ...(threadId ? { threadId } : {}),
        ...(bodyFormat ? { bodyFormat } : {}),
      });

      if (!result.ok) {
        return textResult(result.message, result);
      }
      return payloadTextResult(result);
    },
  };
}
