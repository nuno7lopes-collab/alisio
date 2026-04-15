import { Type } from "@sinclair/typebox";
import { createAlisioGoogleForm, readAlisioGoogleForm } from "../../infra/alisio-google-forms.js";
import {
  payloadTextResult,
  readStringArrayParam,
  readStringParam,
  type AnyAgentTool,
  ToolInputError,
} from "./common.js";

const GoogleFormsToolSchema = Type.Object({
  action: Type.String({
    description: 'Action to run: "create" or "read".',
  }),
  title: Type.Optional(
    Type.String({
      description: 'Form title for action="create".',
    }),
  ),
  description: Type.Optional(
    Type.String({
      description: 'Optional form description for action="create".',
    }),
  ),
  questions: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Optional text questions to add for action="create".',
    }),
  ),
  formId: Type.Optional(
    Type.String({
      description: 'Form id or URL for action="read".',
    }),
  ),
});

export function createGoogleFormsTool(): AnyAgentTool {
  return {
    label: "Google Forms",
    name: "google_forms",
    ownerOnly: true,
    displaySummary: "Create and read Google Forms through the connected Google Forms app.",
    description:
      "Create and read Google Forms through the connected Google Forms app. Prefer this over browser automation for form creation and inspection.",
    parameters: GoogleFormsToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      if (action === "create") {
        const title = readStringParam(params, "title", {
          required: true,
          label: "title",
        });
        const questions = readStringArrayParam(params, "questions");
        return payloadTextResult(
          await createAlisioGoogleForm({
            title,
            ...(readStringParam(params, "description")
              ? { description: readStringParam(params, "description") }
              : {}),
            ...(questions ? { questions } : {}),
          }),
        );
      }
      if (action === "read") {
        const formId = readStringParam(params, "formId", {
          required: true,
          label: "formId",
        });
        return payloadTextResult(await readAlisioGoogleForm({ formId }));
      }
      throw new ToolInputError('action must be "create" or "read"');
    },
  };
}
