import { describe, expect, it, vi } from "vitest";
import { refreshAfterAlisioConnectorOAuth } from "./alisio-connector-oauth.ts";

const loadAlisioConnectorsMock = vi.hoisted(() => vi.fn(async () => undefined));
const loadAlisioDoctorSummaryMock = vi.hoisted(() => vi.fn(async () => undefined));
const loadAlisioProviderOverviewMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("./controllers/alisio.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./controllers/alisio.ts")>();
  return {
    ...actual,
    loadAlisioConnectors: loadAlisioConnectorsMock,
    loadAlisioDoctorSummary: loadAlisioDoctorSummaryMock,
    loadAlisioProviderOverview: loadAlisioProviderOverviewMock,
  };
});

describe("refreshAfterAlisioConnectorOAuth", () => {
  it("reloads connector authorization state after OAuth completes", async () => {
    const host = {
      client: null,
      connected: true,
      alisioProvidersLoading: false,
      alisioProvidersError: null,
      alisioProviders: null,
      alisioConnectorsLoading: false,
      alisioConnectorsError: null,
      alisioConnectorCatalog: [],
      alisioConnectorAuthorizations: [],
      alisioConnectorSetupGuide: null,
    };

    await refreshAfterAlisioConnectorOAuth(
      host as unknown as Parameters<typeof refreshAfterAlisioConnectorOAuth>[0],
    );

    expect(loadAlisioProviderOverviewMock).toHaveBeenCalledTimes(1);
    expect(loadAlisioConnectorsMock).toHaveBeenCalledTimes(1);
    expect(loadAlisioDoctorSummaryMock).toHaveBeenCalledTimes(1);
  });
});
