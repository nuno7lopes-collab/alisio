import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withTempDir } from "../test-utils/temp-dir.js";
import {
  resolveAlisioCanonicalMemoryStorePath,
  resolveAlisioMemoryOwnerProfile,
} from "./alisio-memory-profile.js";

async function writeProfileState(
  stateDir: string,
  profile: {
    userId?: string;
    username?: string;
    displayName?: string;
    email?: string;
  },
) {
  const statePath = path.join(stateDir, "alisio", "state.json");
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify({ account: { profile } }, null, 2)}\n`, "utf8");
}

describe("alisio memory owner profile", () => {
  it("prefers the signed-in cloud user id when available", async () => {
    await withTempDir("alisio-memory-profile-", async (stateDir) => {
      await writeProfileState(stateDir, {
        userId: "google-oauth2|shared-user",
        username: "nuno",
        displayName: "Nuno",
        email: "nuno@example.com",
      });
      vi.stubEnv("ALISIO_STATE_DIR", stateDir);

      const profile = resolveAlisioMemoryOwnerProfile(process.env);
      const storePath = resolveAlisioCanonicalMemoryStorePath({ env: process.env });

      expect(profile).toMatchObject({
        profileId: "user-google-oauth2-shared-user",
        source: "cloud-user",
        userId: "google-oauth2|shared-user",
        username: "nuno",
        displayName: "Nuno",
      });
      expect(profile.emailHash).toMatch(/^[a-f0-9]{16}$/);
      expect(storePath).toBe(
        path.join(
          stateDir,
          "memory",
          "profiles",
          "user-google-oauth2-shared-user",
          "canonical.sqlite",
        ),
      );
    });
  });

  it("falls back to the local profile when cloud identity is absent", async () => {
    await withTempDir("alisio-memory-profile-", async (stateDir) => {
      await writeProfileState(stateDir, {
        username: "nuno.lopes",
        displayName: "Nuno Lopes",
        email: "nuno@example.com",
      });
      vi.stubEnv("ALISIO_STATE_DIR", stateDir);

      const profile = resolveAlisioMemoryOwnerProfile(process.env);

      expect(profile).toMatchObject({
        profileId: "local-nuno.lopes",
        source: "local-profile",
        username: "nuno.lopes",
        displayName: "Nuno Lopes",
      });
      expect(profile.emailHash).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  it("falls back to a state-dir scoped profile when no account profile exists", async () => {
    await withTempDir("alisio-memory-profile-", async (stateDir) => {
      vi.stubEnv("ALISIO_STATE_DIR", stateDir);

      const profile = resolveAlisioMemoryOwnerProfile(process.env);
      const storePath = resolveAlisioCanonicalMemoryStorePath({ env: process.env });

      expect(profile.source).toBe("state-dir");
      expect(profile.profileId).toMatch(/^state-[a-f0-9]{16}$/);
      expect(storePath).toBe(
        path.join(stateDir, "memory", "profiles", profile.profileId, "canonical.sqlite"),
      );
    });
  });
});
