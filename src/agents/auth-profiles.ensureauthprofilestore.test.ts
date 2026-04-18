import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRuntimeAuthProfileStoreSnapshots, ensureAuthProfileStore } from "./auth-profiles.js";
import { AUTH_STORE_VERSION, log } from "./auth-profiles/constants.js";

describe("ensureAuthProfileStore", () => {
  let previousDisableExternalCliSync: string | undefined;

  beforeEach(() => {
    clearRuntimeAuthProfileStoreSnapshots();
    previousDisableExternalCliSync = process.env.ALISIO_DISABLE_EXTERNAL_CLI_SYNC;
    process.env.ALISIO_DISABLE_EXTERNAL_CLI_SYNC = "1";
  });

  afterEach(() => {
    clearRuntimeAuthProfileStoreSnapshots();
    if (previousDisableExternalCliSync === undefined) {
      delete process.env.ALISIO_DISABLE_EXTERNAL_CLI_SYNC;
    } else {
      process.env.ALISIO_DISABLE_EXTERNAL_CLI_SYNC = previousDisableExternalCliSync;
    }
  });

  function withTempAgentDir<T>(prefix: string, run: (agentDir: string) => T): T {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    try {
      return run(agentDir);
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  }

  it("ignores legacy auth.json instead of migrating it", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "alisio-auth-profiles-"));
    try {
      const legacyPath = path.join(agentDir, "auth.json");
      fs.writeFileSync(
        legacyPath,
        `${JSON.stringify(
          {
            anthropic: {
              type: "oauth",
              provider: "anthropic",
              access: "access-token",
              refresh: "refresh-token",
              expires: Date.now() + 60_000,
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const store = ensureAuthProfileStore(agentDir);
      expect(store.profiles).toEqual({});

      const migratedPath = path.join(agentDir, "auth-profiles.json");
      expect(fs.existsSync(migratedPath)).toBe(false);
      expect(fs.existsSync(legacyPath)).toBe(true);
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("merges main auth profiles into agent store and keeps agent overrides", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "alisio-auth-merge-"));
    const previousAgentDir = process.env.ALISIO_AGENT_DIR;
    const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
    try {
      const mainDir = path.join(root, "main-agent");
      const agentDir = path.join(root, "agent-x");
      fs.mkdirSync(mainDir, { recursive: true });
      fs.mkdirSync(agentDir, { recursive: true });

      process.env.ALISIO_AGENT_DIR = mainDir;
      process.env.PI_CODING_AGENT_DIR = mainDir;

      const mainStore = {
        version: AUTH_STORE_VERSION,
        profiles: {
          "openai:default": {
            type: "api_key",
            provider: "openai",
            key: "main-key",
          },
          "anthropic:default": {
            type: "api_key",
            provider: "anthropic",
            key: "main-anthropic-key",
          },
        },
      };
      fs.writeFileSync(
        path.join(mainDir, "auth-profiles.json"),
        `${JSON.stringify(mainStore, null, 2)}\n`,
        "utf8",
      );

      const agentStore = {
        version: AUTH_STORE_VERSION,
        profiles: {
          "openai:default": {
            type: "api_key",
            provider: "openai",
            key: "agent-key",
          },
        },
      };
      fs.writeFileSync(
        path.join(agentDir, "auth-profiles.json"),
        `${JSON.stringify(agentStore, null, 2)}\n`,
        "utf8",
      );

      const store = ensureAuthProfileStore(agentDir);
      expect(store.profiles["anthropic:default"]).toMatchObject({
        type: "api_key",
        provider: "anthropic",
        key: "main-anthropic-key",
      });
      expect(store.profiles["openai:default"]).toMatchObject({
        type: "api_key",
        provider: "openai",
        key: "agent-key",
      });
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.ALISIO_AGENT_DIR;
      } else {
        process.env.ALISIO_AGENT_DIR = previousAgentDir;
      }
      if (previousPiAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousPiAgentDir;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "mode/apiKey aliases are rejected",
      profile: {
        provider: "anthropic",
        mode: "api_key",
        apiKey: "sk-ant-alias", // pragma: allowlist secret
      },
      expected: undefined,
    },
    {
      name: "canonical type ignores extra mode alias",
      profile: {
        provider: "anthropic",
        type: "api_key",
        mode: "token",
        key: "sk-ant-canonical",
      },
      expected: {
        type: "api_key",
        key: "sk-ant-canonical",
      },
    },
    {
      name: "canonical key ignores extra apiKey alias",
      profile: {
        provider: "anthropic",
        type: "api_key",
        key: "sk-ant-canonical",
        apiKey: "sk-ant-alias", // pragma: allowlist secret
      },
      expected: {
        type: "api_key",
        key: "sk-ant-canonical",
      },
    },
    {
      name: "canonical profile shape remains unchanged",
      profile: {
        provider: "anthropic",
        type: "api_key",
        key: "sk-ant-direct",
      },
      expected: {
        type: "api_key",
        key: "sk-ant-direct",
      },
    },
  ] as const)(
    "loads only canonical auth-profiles credential fields: $name",
    ({ name, profile, expected }) => {
      withTempAgentDir("alisio-auth-alias-", (agentDir) => {
        const storeData = {
          version: AUTH_STORE_VERSION,
          profiles: {
            "anthropic:work": profile,
          },
        };
        fs.writeFileSync(
          path.join(agentDir, "auth-profiles.json"),
          `${JSON.stringify(storeData, null, 2)}\n`,
          "utf8",
        );

        const store = ensureAuthProfileStore(agentDir);
        if (expected) {
          expect(store.profiles["anthropic:work"], name).toMatchObject(expected);
          expect(store.profiles["anthropic:work"]).not.toHaveProperty("mode");
          expect(store.profiles["anthropic:work"]).not.toHaveProperty("apiKey");
          return;
        }
        expect(store.profiles["anthropic:work"], name).toBeUndefined();
      });
    },
  );

  it("ignores legacy oauth.json instead of merging it into auth-profiles", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "alisio-oauth-migrate-"));
    const previousStateDir = process.env.ALISIO_STATE_DIR;
    const previousAgentDir = process.env.ALISIO_AGENT_DIR;
    const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
    try {
      const agentDir = path.join(root, "agent");
      const oauthDir = path.join(root, "credentials");
      fs.mkdirSync(agentDir, { recursive: true });
      fs.mkdirSync(oauthDir, { recursive: true });
      fs.writeFileSync(
        path.join(oauthDir, "oauth.json"),
        `${JSON.stringify(
          {
            "openai-codex": {
              access: "access-token",
              refresh: "refresh-token",
              expires: Date.now() + 60_000,
              accountId: "acct_123",
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      process.env.ALISIO_STATE_DIR = root;
      process.env.ALISIO_AGENT_DIR = agentDir;
      process.env.PI_CODING_AGENT_DIR = agentDir;
      clearRuntimeAuthProfileStoreSnapshots();

      const store = ensureAuthProfileStore(agentDir);
      expect(store.profiles).toEqual({});
      expect(fs.existsSync(path.join(agentDir, "auth-profiles.json"))).toBe(false);
    } finally {
      clearRuntimeAuthProfileStoreSnapshots();
      if (previousStateDir === undefined) {
        delete process.env.ALISIO_STATE_DIR;
      } else {
        process.env.ALISIO_STATE_DIR = previousStateDir;
      }
      if (previousAgentDir === undefined) {
        delete process.env.ALISIO_AGENT_DIR;
      } else {
        process.env.ALISIO_AGENT_DIR = previousAgentDir;
      }
      if (previousPiAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousPiAgentDir;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("logs one warning with aggregated reasons for rejected auth-profiles entries", () => {
    const warnSpy = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    try {
      withTempAgentDir("alisio-auth-invalid-", (agentDir) => {
        const invalidStore = {
          version: AUTH_STORE_VERSION,
          profiles: {
            "anthropic:missing-type": {
              provider: "anthropic",
            },
            "openai:missing-provider": {
              type: "api_key",
              key: "sk-openai",
            },
            "qwen:not-object": "broken",
          },
        };
        fs.writeFileSync(
          path.join(agentDir, "auth-profiles.json"),
          `${JSON.stringify(invalidStore, null, 2)}\n`,
          "utf8",
        );

        const store = ensureAuthProfileStore(agentDir);
        expect(store.profiles).toEqual({});
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          "ignored invalid auth profile entries during store load",
          {
            source: "auth-profiles.json",
            dropped: 3,
            reasons: {
              invalid_type: 1,
              missing_provider: 1,
              non_object: 1,
            },
            keys: ["anthropic:missing-type", "openai:missing-provider", "qwen:not-object"],
          },
        );
      });
    } finally {
      warnSpy.mockRestore();
    }
  });
});
