import { describe, expect, it, vi } from "vitest";
import { handleAlisioOAuthHttpRequest } from "./alisio-oauth-http.js";

const completeAlisioAiConnectMock = vi.hoisted(() =>
  vi.fn(async () => ({
    email: "nuno@example.com",
  })),
);

vi.mock("../infra/alisio-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infra/alisio-store.js")>();
  return {
    ...actual,
    completeAlisioAiConnect: completeAlisioAiConnectMock,
    completeAlisioConnectorAuthorizationFromCallback: vi.fn(async () => ({ ok: false })),
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
  });
});
