import { beforeEach, describe, expect, it, vi } from "vitest";

const { listAlisioGoogleAnalyticsAccountsMock, runAlisioGoogleAnalyticsReportMock } = vi.hoisted(
  () => ({
    listAlisioGoogleAnalyticsAccountsMock: vi.fn(),
    runAlisioGoogleAnalyticsReportMock: vi.fn(),
  }),
);

vi.mock("../../infra/alisio-google-analytics.js", () => ({
  listAlisioGoogleAnalyticsAccounts: listAlisioGoogleAnalyticsAccountsMock,
  runAlisioGoogleAnalyticsReport: runAlisioGoogleAnalyticsReportMock,
}));

describe("createGoogleAnalyticsTool", () => {
  beforeEach(() => {
    vi.resetModules();
    listAlisioGoogleAnalyticsAccountsMock.mockReset();
    runAlisioGoogleAnalyticsReportMock.mockReset();
  });

  it("lists accounts", async () => {
    const { createGoogleAnalyticsTool } = await import("./google-analytics-tool.js");
    listAlisioGoogleAnalyticsAccountsMock.mockResolvedValue({
      ok: true,
      status: "listed",
      connectorId: "google-analytics",
      accounts: [],
    });

    const result = await createGoogleAnalyticsTool().execute?.("tool-1", {
      action: "list_accounts",
      pageSize: 5,
    });

    expect(listAlisioGoogleAnalyticsAccountsMock).toHaveBeenCalledWith({
      pageSize: 5,
    });
    expect(result?.details).toMatchObject({
      status: "listed",
      connectorId: "google-analytics",
    });
  });

  it("runs reports", async () => {
    const { createGoogleAnalyticsTool } = await import("./google-analytics-tool.js");
    runAlisioGoogleAnalyticsReportMock.mockResolvedValue({
      ok: true,
      status: "reported",
      connectorId: "google-analytics",
      propertyId: "2000",
      startDate: "7daysAgo",
      endDate: "today",
      dimensions: ["country"],
      metrics: ["activeUsers"],
      rowCount: 1,
      rows: [{ country: "Portugal", activeUsers: "42" }],
    });

    const result = await createGoogleAnalyticsTool().execute?.("tool-1", {
      action: "run_report",
      propertyId: "2000",
      dimensions: ["country"],
      metrics: ["activeUsers"],
      startDate: "7daysAgo",
      endDate: "today",
      limit: 5,
    });

    expect(runAlisioGoogleAnalyticsReportMock).toHaveBeenCalledWith({
      propertyId: "2000",
      dimensions: ["country"],
      metrics: ["activeUsers"],
      startDate: "7daysAgo",
      endDate: "today",
      limit: 5,
    });
    expect(result?.details).toMatchObject({
      status: "reported",
      connectorId: "google-analytics",
    });
  });
});
