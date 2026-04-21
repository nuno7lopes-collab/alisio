import { describe, expect, it } from "vitest";
import { createGitHubTool } from "../agents/tools/github-tool.js";
import { createGmailModifyTool } from "../agents/tools/gmail-modify-tool.js";
import { createGmailReadTool } from "../agents/tools/gmail-read-tool.js";
import { createGmailSendTool } from "../agents/tools/gmail-send-tool.js";
import { createGoogleAnalyticsTool } from "../agents/tools/google-analytics-tool.js";
import { createGoogleCalendarTool } from "../agents/tools/google-calendar-tool.js";
import { createGoogleDocsTool } from "../agents/tools/google-docs-tool.js";
import { createGoogleDriveTool } from "../agents/tools/google-drive-tool.js";
import { createGoogleFormsTool } from "../agents/tools/google-forms-tool.js";
import { createGoogleSheetsTool } from "../agents/tools/google-sheets-tool.js";
import { createStripeTool } from "../agents/tools/stripe-tool.js";
import { createYouTubeTool } from "../agents/tools/youtube-tool.js";
import { listAlisioConnectorDefinitions } from "../infra/alisio-store.js";
import {
  ALISIO_RUNTIME_READY_CONNECTOR_IDS,
  isAlisioConnectorRuntimeReady,
} from "./alisio-connector-runtime.js";

function normalizeToolNameToConnectorId(toolName: string): string {
  return toolName.replaceAll("_", "-");
}

describe("alisio connector runtime canon", () => {
  it("keeps catalog-ready connectors aligned with the runtime-ready set", () => {
    const readyCatalogConnectorIds = listAlisioConnectorDefinitions()
      .filter((definition) => definition.availability === "ready")
      .map((definition) => definition.id)
      .toSorted();

    expect([...ALISIO_RUNTIME_READY_CONNECTOR_IDS].toSorted()).toEqual(readyCatalogConnectorIds);
  });

  it("keeps registered connector tools aligned with the runtime-ready set", () => {
    const runtimeReadyToolConnectorIds = [
      createGoogleAnalyticsTool(),
      createGoogleCalendarTool(),
      createGoogleDocsTool(),
      createGoogleDriveTool(),
      createGoogleFormsTool(),
      createGoogleSheetsTool(),
      createGmailReadTool(),
      createGmailModifyTool(),
      createGmailSendTool(),
      createGitHubTool(),
      createStripeTool(),
      createYouTubeTool(),
    ]
      .map((tool) => normalizeToolNameToConnectorId(tool.name))
      .filter((toolName) => isAlisioConnectorRuntimeReady(toolName))
      .toSorted();

    expect(runtimeReadyToolConnectorIds).toEqual(
      [...ALISIO_RUNTIME_READY_CONNECTOR_IDS].toSorted(),
    );
  });
});
