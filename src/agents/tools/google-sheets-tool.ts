import { Type } from "@sinclair/typebox";
import {
  appendAlisioGoogleSpreadsheetRows,
  createAlisioGoogleSpreadsheet,
  readAlisioGoogleSpreadsheetRange,
  type AlisioGoogleSheetValueMatrix,
} from "../../infra/alisio-google-sheets.js";
import {
  payloadTextResult,
  readNumberParam,
  readStringArrayParam,
  readStringParam,
  type AnyAgentTool,
  ToolInputError,
} from "./common.js";

const GoogleSheetsToolSchema = Type.Object({
  action: Type.String({
    description: 'Action to run: "create", "read", or "append".',
  }),
  title: Type.Optional(
    Type.String({
      description: 'Spreadsheet title for action="create".',
    }),
  ),
  sheetTitle: Type.Optional(
    Type.String({
      description: 'Optional first sheet title for action="create". Defaults to "Sheet1".',
    }),
  ),
  headers: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Optional header row for action="create".',
    }),
  ),
  rows: Type.Optional(
    Type.Array(Type.Array(Type.String()), {
      description: 'Rows for action="create" or action="append".',
    }),
  ),
  spreadsheetId: Type.Optional(
    Type.String({
      description: 'Spreadsheet id or URL for action="read" or action="append".',
    }),
  ),
  range: Type.Optional(
    Type.String({
      description: 'A1 range for action="read" or action="append".',
    }),
  ),
  maxRows: Type.Optional(
    Type.Number({
      description: 'Maximum rows to return for action="read". Defaults to 200.',
    }),
  ),
});

function readStringMatrixParam(
  params: Record<string, unknown>,
  key: string,
): AlisioGoogleSheetValueMatrix | undefined {
  const raw = params[key];
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const rows = raw.flatMap((row) => {
    if (!Array.isArray(row)) {
      return [];
    }
    return [
      row.map((cell) => {
        if (typeof cell === "string") {
          return cell;
        }
        if (typeof cell === "number" || typeof cell === "boolean") {
          return String(cell);
        }
        throw new ToolInputError(`${key} must contain only strings, numbers, or booleans`);
      }),
    ];
  });
  return rows.length > 0 ? rows : undefined;
}

export function createGoogleSheetsTool(): AnyAgentTool {
  return {
    label: "Google Sheets",
    name: "google_sheets",
    ownerOnly: true,
    displaySummary:
      "Create, read, and append rows in Google Sheets through the connected Google Sheets app.",
    description:
      "Create, read, and append rows in Google Sheets through the connected Google Sheets app. Prefer this over browser automation for spreadsheet work.",
    parameters: GoogleSheetsToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      if (action === "create") {
        const title = readStringParam(params, "title", {
          required: true,
          label: "title",
        });
        const headers = readStringArrayParam(params, "headers");
        const rows = readStringMatrixParam(params, "rows");
        return payloadTextResult(
          await createAlisioGoogleSpreadsheet({
            title,
            ...(readStringParam(params, "sheetTitle")
              ? { sheetTitle: readStringParam(params, "sheetTitle") }
              : {}),
            ...(headers ? { headers } : {}),
            ...(rows ? { rows } : {}),
          }),
        );
      }
      if (action === "read") {
        const spreadsheetId = readStringParam(params, "spreadsheetId", {
          required: true,
          label: "spreadsheetId",
        });
        const maxRows = readNumberParam(params, "maxRows", {
          integer: true,
          strict: true,
        });
        if (maxRows !== undefined && maxRows <= 0) {
          throw new ToolInputError("maxRows must be greater than 0");
        }
        return payloadTextResult(
          await readAlisioGoogleSpreadsheetRange({
            spreadsheetId,
            ...(readStringParam(params, "range")
              ? { range: readStringParam(params, "range") }
              : {}),
            ...(maxRows !== undefined ? { maxRows } : {}),
          }),
        );
      }
      if (action === "append") {
        const spreadsheetId = readStringParam(params, "spreadsheetId", {
          required: true,
          label: "spreadsheetId",
        });
        const rows = readStringMatrixParam(params, "rows");
        if (!rows || rows.length === 0) {
          throw new ToolInputError("rows required");
        }
        return payloadTextResult(
          await appendAlisioGoogleSpreadsheetRows({
            spreadsheetId,
            ...(readStringParam(params, "range")
              ? { range: readStringParam(params, "range") }
              : {}),
            rows,
          }),
        );
      }
      throw new ToolInputError('action must be "create", "read", or "append"');
    },
  };
}
