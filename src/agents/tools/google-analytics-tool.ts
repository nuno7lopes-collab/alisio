import { Type } from "@sinclair/typebox";
import {
  listAlisioGoogleAnalyticsAccounts,
  runAlisioGoogleAnalyticsReport,
} from "../../infra/alisio-google-analytics.js";
import {
  payloadTextResult,
  readNumberParam,
  readStringArrayParam,
  readStringParam,
  type AnyAgentTool,
  ToolInputError,
} from "./common.js";

const GoogleAnalyticsToolSchema = Type.Object({
  action: Type.String({
    description: 'Action to run: "list_accounts" or "run_report".',
  }),
  pageSize: Type.Optional(
    Type.Number({
      description: 'Maximum accounts to return for action="list_accounts". Defaults to 20.',
    }),
  ),
  propertyId: Type.Optional(
    Type.String({
      description: 'Google Analytics property id for action="run_report".',
    }),
  ),
  dimensions: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Dimensions for action="run_report".',
    }),
  ),
  metrics: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Metrics for action="run_report".',
    }),
  ),
  startDate: Type.Optional(
    Type.String({
      description: 'Start date for action="run_report". Defaults to 28daysAgo.',
    }),
  ),
  endDate: Type.Optional(
    Type.String({
      description: 'End date for action="run_report". Defaults to today.',
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description: 'Maximum rows for action="run_report". Defaults to 20.',
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

export function createGoogleAnalyticsTool(): AnyAgentTool {
  return {
    label: "Google Analytics",
    name: "google_analytics",
    ownerOnly: true,
    displaySummary:
      "List Google Analytics accounts and run GA4 reports through the connected Google Analytics app.",
    description:
      "List Google Analytics accounts and run GA4 reports through the connected Google Analytics app. Prefer this over browser automation for analytics queries.",
    parameters: GoogleAnalyticsToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      if (action === "list_accounts") {
        const pageSize = readNumberParam(params, "pageSize", {
          integer: true,
          strict: true,
        });
        if (pageSize !== undefined && pageSize <= 0) {
          throw new ToolInputError("pageSize must be greater than 0");
        }
        return payloadTextResult(
          await listAlisioGoogleAnalyticsAccounts(pageSize !== undefined ? { pageSize } : {}),
        );
      }
      if (action === "run_report") {
        const propertyId = readStringParam(params, "propertyId", {
          required: true,
          label: "propertyId",
        });
        const dimensions = readCsvStringArrayParam(params, "dimensions");
        const metrics = readCsvStringArrayParam(params, "metrics");
        if (!dimensions || dimensions.length === 0) {
          throw new ToolInputError("dimensions required");
        }
        if (!metrics || metrics.length === 0) {
          throw new ToolInputError("metrics required");
        }
        const limit = readNumberParam(params, "limit", {
          integer: true,
          strict: true,
        });
        if (limit !== undefined && limit <= 0) {
          throw new ToolInputError("limit must be greater than 0");
        }
        return payloadTextResult(
          await runAlisioGoogleAnalyticsReport({
            propertyId,
            dimensions,
            metrics,
            ...(readStringParam(params, "startDate")
              ? { startDate: readStringParam(params, "startDate") }
              : {}),
            ...(readStringParam(params, "endDate")
              ? { endDate: readStringParam(params, "endDate") }
              : {}),
            ...(limit !== undefined ? { limit } : {}),
          }),
        );
      }
      throw new ToolInputError('action must be "list_accounts" or "run_report"');
    },
  };
}
