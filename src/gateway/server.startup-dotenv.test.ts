import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getFreePort, installGatewayTestHooks, startGatewayServer } from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

const GOOGLE_ENV_KEYS = [
  "ALISIO_GOOGLE_CLIENT_ID",
  "ALISIO_GOOGLE_CLIENT_SECRET",
  "ALISIO_GOOGLE_REDIRECT_URI",
] as const;

describe("gateway startup dotenv loading", () => {
  afterEach(() => {
    for (const key of GOOGLE_ENV_KEYS) {
      delete process.env[key];
    }
  });

  it("loads state-dir .env entries before serving connector flows", async () => {
    const stateDir = process.env.ALISIO_STATE_DIR;
    expect(stateDir).toBeTruthy();
    await fs.writeFile(
      path.join(stateDir!, ".env"),
      [
        "ALISIO_GOOGLE_CLIENT_ID=google-client-id",
        "ALISIO_GOOGLE_CLIENT_SECRET=google-client-secret",
        "ALISIO_GOOGLE_REDIRECT_URI=http://127.0.0.1:8787/oauth/google/callback",
      ].join("\n"),
    );

    for (const key of GOOGLE_ENV_KEYS) {
      delete process.env[key];
      expect(process.env[key]).toBeUndefined();
    }

    const server = await startGatewayServer(await getFreePort());
    try {
      expect(process.env.ALISIO_GOOGLE_CLIENT_ID).toBe("google-client-id");
      expect(process.env.ALISIO_GOOGLE_CLIENT_SECRET).toBe("google-client-secret");
      expect(process.env.ALISIO_GOOGLE_REDIRECT_URI).toBe(
        "http://127.0.0.1:8787/oauth/google/callback",
      );
    } finally {
      await server.close();
    }
  });
});
