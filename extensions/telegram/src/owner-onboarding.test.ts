import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withEnvAsync } from "../../../test/helpers/plugins/env.js";
import {
  beginTelegramOwnerOnboarding,
  clearTelegramOwnerOnboarding,
  readTelegramOwnerOnboarding,
} from "./owner-onboarding.js";

async function withStateDir<T>(fn: (stateDir: string) => Promise<T>): Promise<T> {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "alisio-telegram-owner-"));
  return await withEnvAsync({ ALISIO_STATE_DIR: stateDir }, async () => {
    try {
      return await fn(stateDir);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
}

describe("telegram owner onboarding store", () => {
  it("creates and reads a Telegram onboarding session with a deep link", async () => {
    await withStateDir(async () => {
      const started = await beginTelegramOwnerOnboarding({
        accountId: "alerts",
        botUsername: "@alizio_bot",
        nowMs: 1_000,
      });

      expect(started.token).toMatch(/^[A-Z2-9]{12}$/);
      expect(started.startCommand).toBe(`/start ${started.token}`);
      expect(started.deepLink).toBe(`https://t.me/alizio_bot?start=${started.token}`);

      const reread = await readTelegramOwnerOnboarding({
        accountId: "alerts",
        nowMs: 2_000,
      });

      expect(reread).toEqual(started);
    });
  });

  it("expires stale Telegram onboarding sessions", async () => {
    await withStateDir(async () => {
      await beginTelegramOwnerOnboarding({
        accountId: "default",
        botUsername: "alizio_bot",
        nowMs: 1_000,
        ttlMs: 10,
      });

      await expect(
        readTelegramOwnerOnboarding({
          accountId: "default",
          nowMs: 1_020,
        }),
      ).resolves.toBeNull();

      await expect(
        readTelegramOwnerOnboarding({
          accountId: "default",
          nowMs: 1_030,
        }),
      ).resolves.toBeNull();
    });
  });

  it("clears stored Telegram onboarding sessions", async () => {
    await withStateDir(async () => {
      await beginTelegramOwnerOnboarding({
        accountId: "default",
        nowMs: 1_000,
      });

      await clearTelegramOwnerOnboarding({ accountId: "default" });

      await expect(
        readTelegramOwnerOnboarding({
          accountId: "default",
          nowMs: 2_000,
        }),
      ).resolves.toBeNull();
    });
  });
});
