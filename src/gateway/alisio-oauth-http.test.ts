import { describe, expect, it, vi } from "vitest";
import type { AlisioOAuthCallbackResult } from "../infra/alisio-store.js";
import { handleAlisioOAuthHttpRequest } from "./alisio-oauth-http.js";

const completeAlisioAiConnectMock = vi.hoisted(() =>
  vi.fn(async () => ({
    email: "nuno@example.com",
  })),
);
const completeAlisioConnectorAuthorizationFromCallbackMock = vi.hoisted(() =>
  vi.fn<() => Promise<AlisioOAuthCallbackResult>>(async () => ({
    ok: false,
    reason: "missing_state",
    message: "Missing OAuth state token.",
  })),
);

vi.mock("../infra/alisio-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infra/alisio-store.js")>();
  return {
    ...actual,
    completeAlisioAiConnect: completeAlisioAiConnectMock,
    completeAlisioConnectorAuthorizationFromCallback:
      completeAlisioConnectorAuthorizationFromCallbackMock,
  };
});

function createResponse() {
  const chunks: string[] = [];
  return {
    statusCode: 0,
    headers: new Map<string, string>(),
    setHeader(name: string, value: string) {
      this.headers.set(name, value);
    },
    end(chunk?: string) {
      if (typeof chunk === "string") {
        chunks.push(chunk);
      }
    },
    body() {
      return chunks.join("");
    },
  };
}

describe("handleAlisioOAuthHttpRequest", () => {
  it("injects an auto-refresh signal into the OpenAI success page", async () => {
    const req = {
      method: "GET",
      url: "/__alisio/auth/openai/callback?code=test&state=abc",
    } as const;
    const res = createResponse();

    const handled = await handleAlisioOAuthHttpRequest(req as never, res as never, {} as never);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body()).toContain("Alisio is connected to OpenAI");
    expect(res.body()).toContain("alisio:alisio-openai-oauth:v1");
    expect(res.body()).toContain("BroadcastChannel");
    expect(res.body()).toContain("setTimeout(function(){window.close();},120)");
  });

  it("injects an auto-refresh signal into connector OAuth success pages", async () => {
    completeAlisioConnectorAuthorizationFromCallbackMock.mockResolvedValueOnce({
      ok: true,
      authorization: {
        connectorId: "google-calendar",
        state: "connected",
        health: "healthy",
        scopes: ["openid", "email"],
        connectedAccount: {
          label: "Nuno Lopes",
          email: "nuno@example.com",
        },
      },
    });
    const req = {
      method: "GET",
      url: "/oauth/google/callback?code=test&state=abc",
    } as const;
    const res = createResponse();

    const handled = await handleAlisioOAuthHttpRequest(req as never, res as never, {} as never);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body()).toContain("Alisio connection completed");
    expect(res.body()).toContain("alisio:alisio-connector-oauth:v1");
    expect(res.body()).toContain("alisio:alisio-connector-oauth:return-to:v1");
    expect(res.body()).toContain('"connectorId":"google-calendar"');
    expect(res.body()).toContain("window.location.replace(returnToUrl)");
  });

  it("supports Stripe connector OAuth callbacks", async () => {
    completeAlisioConnectorAuthorizationFromCallbackMock.mockResolvedValueOnce({
      ok: true,
      authorization: {
        connectorId: "stripe",
        state: "connected",
        health: "healthy",
        scopes: ["balance_read", "customer_read", "charge_read", "payment_intent_read"],
        connectedAccount: {
          label: "Stripe test account",
          handle: "acct_123",
        },
      },
    });
    const req = {
      method: "GET",
      url: "/oauth/stripe/callback?code=test&state=abc",
    } as const;
    const res = createResponse();

    const handled = await handleAlisioOAuthHttpRequest(req as never, res as never, {} as never);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body()).toContain("Stripe");
    expect(res.body()).toContain('"provider":"stripe"');
    expect(res.body()).toContain('"connectorId":"stripe"');
  });
});
