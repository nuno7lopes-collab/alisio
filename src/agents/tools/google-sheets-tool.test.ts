import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  appendAlisioGoogleSpreadsheetRowsMock,
  createAlisioGoogleSpreadsheetMock,
  readAlisioGoogleSpreadsheetRangeMock,
} = vi.hoisted(() => ({
  appendAlisioGoogleSpreadsheetRowsMock: vi.fn(),
  createAlisioGoogleSpreadsheetMock: vi.fn(),
  readAlisioGoogleSpreadsheetRangeMock: vi.fn(),
}));

vi.mock("../../infra/alisio-google-sheets.js", () => ({
  appendAlisioGoogleSpreadsheetRows: appendAlisioGoogleSpreadsheetRowsMock,
  createAlisioGoogleSpreadsheet: createAlisioGoogleSpreadsheetMock,
  readAlisioGoogleSpreadsheetRange: readAlisioGoogleSpreadsheetRangeMock,
}));

describe("createGoogleSheetsTool", () => {
  beforeEach(() => {
    vi.resetModules();
    appendAlisioGoogleSpreadsheetRowsMock.mockReset();
    createAlisioGoogleSpreadsheetMock.mockReset();
    readAlisioGoogleSpreadsheetRangeMock.mockReset();
  });

  it("creates spreadsheets", async () => {
    const { createGoogleSheetsTool } = await import("./google-sheets-tool.js");
    createAlisioGoogleSpreadsheetMock.mockResolvedValue({
      ok: true,
      status: "created",
      connectorId: "google-sheets",
      spreadsheetId: "sheet-1",
      title: "porto",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
      sheetTitle: "Sheet1",
      rowCount: 2,
    });

    const result = await createGoogleSheetsTool().execute?.("tool-1", {
      action: "create",
      title: "porto",
      headers: ["city", "country"],
      rows: [["Porto", "Portugal"]],
    });

    expect(createAlisioGoogleSpreadsheetMock).toHaveBeenCalledWith({
      title: "porto",
      headers: ["city", "country"],
      rows: [["Porto", "Portugal"]],
    });
    expect(result?.details).toMatchObject({
      status: "created",
      connectorId: "google-sheets",
    });
  });

  it("reads spreadsheet ranges", async () => {
    const { createGoogleSheetsTool } = await import("./google-sheets-tool.js");
    readAlisioGoogleSpreadsheetRangeMock.mockResolvedValue({
      ok: true,
      status: "read",
      connectorId: "google-sheets",
      spreadsheetId: "sheet-1",
      title: "porto",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
      range: "Sheet1!A:B",
      values: [
        ["city", "country"],
        ["Porto", "Portugal"],
      ],
      rowCount: 2,
      truncatedRows: false,
    });

    const result = await createGoogleSheetsTool().execute?.("tool-1", {
      action: "read",
      spreadsheetId: "sheet-1",
      range: "Sheet1!A:B",
      maxRows: 20,
    });

    expect(readAlisioGoogleSpreadsheetRangeMock).toHaveBeenCalledWith({
      spreadsheetId: "sheet-1",
      range: "Sheet1!A:B",
      maxRows: 20,
    });
    expect(result?.details).toMatchObject({
      status: "read",
      connectorId: "google-sheets",
    });
  });

  it("appends spreadsheet rows", async () => {
    const { createGoogleSheetsTool } = await import("./google-sheets-tool.js");
    appendAlisioGoogleSpreadsheetRowsMock.mockResolvedValue({
      ok: true,
      status: "appended",
      connectorId: "google-sheets",
      spreadsheetId: "sheet-1",
      title: "porto",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
      range: "Sheet1!A:B",
      updatedRows: 1,
    });

    const result = await createGoogleSheetsTool().execute?.("tool-1", {
      action: "append",
      spreadsheetId: "sheet-1",
      range: "Sheet1!A:B",
      rows: [["Braga", "Portugal"]],
    });

    expect(appendAlisioGoogleSpreadsheetRowsMock).toHaveBeenCalledWith({
      spreadsheetId: "sheet-1",
      range: "Sheet1!A:B",
      rows: [["Braga", "Portugal"]],
    });
    expect(result?.details).toMatchObject({
      status: "appended",
      connectorId: "google-sheets",
    });
  });
});
