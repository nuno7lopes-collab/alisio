import { describe, expect, it, vi } from "vitest";
import {
  buildOpenAiCompatibleEndpointUrls,
  fetchModelRuntimeEndpoint,
} from "./openai-compatible-endpoints.js";

describe("openai-compatible endpoints", () => {
  it("builds a v1-first candidate list for bare base URLs", () => {
    expect(buildOpenAiCompatibleEndpointUrls("http://127.0.0.1:1234", "models")).toEqual([
      "http://127.0.0.1:1234/v1/models",
      "http://127.0.0.1:1234/models",
    ]);
  });

  it("keeps explicit v1 base URLs stable", () => {
    expect(
      buildOpenAiCompatibleEndpointUrls("http://127.0.0.1:1234/v1/", "chat/completions"),
    ).toEqual(["http://127.0.0.1:1234/v1/chat/completions"]);
  });

  it("retries a bare-path fallback when the v1 endpoint is missing", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: "gpt-oss-20b" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const response = await fetchModelRuntimeEndpoint({
      baseUrl: "http://127.0.0.1:1234",
      endpoint: "models",
      fetchImpl: fetchMock,
      init: {
        method: "GET",
      },
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:1234/v1/models",
      "http://127.0.0.1:1234/models",
    ]);
    expect(response.ok).toBe(true);
    await response.text();
  });

  it("does not hide auth errors behind a fallback path", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));

    const response = await fetchModelRuntimeEndpoint({
      baseUrl: "http://127.0.0.1:1234",
      endpoint: "models",
      fetchImpl: fetchMock,
      init: {
        method: "GET",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(401);
    await response.text();
  });
});
