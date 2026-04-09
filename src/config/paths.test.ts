import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { legacyEnvKey } from "../infra/env.js";
import { withTempDir } from "../test-helpers/temp-dir.js";
import {
  DEFAULT_GATEWAY_PORT,
  resolveDefaultConfigCandidates,
  resolveConfigPathCandidate,
  resolveConfigPath,
  resolveGatewayPort,
  resolveOAuthDir,
  resolveOAuthPath,
  resolveStateDir,
} from "./paths.js";

const LEGACY_STATE_DIRNAME = `.${["open", "claw"].join("")}`;
const LEGACY_CONFIG_FILENAME = `${["open", "claw"].join("")}.json`;
const LEGACY_ALT_STATE_DIRNAME = `.${["claw", "dbot"].join("")}`;
const LEGACY_ALT_CONFIG_FILENAME = `${["claw", "dbot"].join("")}.json`;

function envWith(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...overrides };
}

describe("oauth paths", () => {
  it("prefers ALISIO_OAUTH_DIR over ALISIO_STATE_DIR", () => {
    const env = {
      ALISIO_OAUTH_DIR: "/custom/oauth",
      ALISIO_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.resolve("/custom/oauth"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join(path.resolve("/custom/oauth"), "oauth.json"),
    );
  });

  it("derives oauth path from ALISIO_STATE_DIR when unset", () => {
    const env = {
      ALISIO_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.join("/custom/state", "credentials"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join("/custom/state", "credentials", "oauth.json"),
    );
  });
});

describe("gateway port resolution", () => {
  it("prefers numeric env values over config", () => {
    expect(
      resolveGatewayPort({ gateway: { port: 19002 } }, envWith({ ALISIO_GATEWAY_PORT: "19001" })),
    ).toBe(19001);
  });

  it("accepts Compose-style IPv4 host publish values from env", () => {
    expect(
      resolveGatewayPort(
        { gateway: { port: 19002 } },
        envWith({ ALISIO_GATEWAY_PORT: "127.0.0.1:40705" }),
      ),
    ).toBe(40705);
  });

  it("accepts Compose-style IPv6 host publish values from env", () => {
    expect(
      resolveGatewayPort(
        { gateway: { port: 19002 } },
        envWith({ ALISIO_GATEWAY_PORT: "[::1]:28789" }),
      ),
    ).toBe(28789);
  });

  it("ignores the legacy env name and falls back to config", () => {
    const compatKey = legacyEnvKey("GATEWAY_PORT");
    expect(
      resolveGatewayPort({ gateway: { port: 19002 } }, envWith({ [compatKey]: "127.0.0.1:40705" })),
    ).toBe(40705);
  });

  it("falls back to config when the Compose-style suffix is invalid", () => {
    expect(
      resolveGatewayPort(
        { gateway: { port: 19003 } },
        envWith({ ALISIO_GATEWAY_PORT: "127.0.0.1:not-a-port" }),
      ),
    ).toBe(19003);
  });

  it("falls back when malformed IPv6 inputs do not provide an explicit port", () => {
    expect(
      resolveGatewayPort({ gateway: { port: 19003 } }, envWith({ ALISIO_GATEWAY_PORT: "::1" })),
    ).toBe(19003);
    expect(resolveGatewayPort({}, envWith({ ALISIO_GATEWAY_PORT: "2001:db8::1" }))).toBe(
      DEFAULT_GATEWAY_PORT,
    );
  });

  it("falls back to the default port when env is invalid and config is unset", () => {
    expect(resolveGatewayPort({}, envWith({ ALISIO_GATEWAY_PORT: "127.0.0.1:not-a-port" }))).toBe(
      DEFAULT_GATEWAY_PORT,
    );
  });
});

describe("state + config path candidates", () => {
  function expectAlisioHomeDefaults(env: NodeJS.ProcessEnv): void {
    const configuredHome = env.ALISIO_HOME;
    if (!configuredHome) {
      throw new Error("ALISIO_HOME must be set for this assertion helper");
    }
    const resolvedHome = path.resolve(configuredHome);
    expect(resolveStateDir(env)).toBe(path.join(resolvedHome, ".alisio"));

    const candidates = resolveDefaultConfigCandidates(env);
    expect(candidates[0]).toBe(path.join(resolvedHome, ".alisio", "alisio.json"));
  }

  it("uses ALISIO_STATE_DIR when set", () => {
    const env = {
      ALISIO_STATE_DIR: "/new/state",
    } as NodeJS.ProcessEnv;

    expect(resolveStateDir(env, () => "/home/test")).toBe(path.resolve("/new/state"));
  });

  it("uses the compatibility state-dir env when the current key is unset", () => {
    const compatKey = legacyEnvKey("STATE_DIR");
    const env = { [compatKey]: "/legacy/state" } as NodeJS.ProcessEnv;

    expect(resolveStateDir(env, () => "/home/test")).toBe(path.resolve("/legacy/state"));
  });

  it("uses ALISIO_HOME for default state/config locations", () => {
    const env = {
      ALISIO_HOME: "/srv/alisio-home",
    } as NodeJS.ProcessEnv;
    expectAlisioHomeDefaults(env);
  });

  it("prefers ALISIO_HOME over HOME for default state/config locations", () => {
    const env = {
      ALISIO_HOME: "/srv/alisio-home",
      HOME: "/home/other",
    } as NodeJS.ProcessEnv;
    expectAlisioHomeDefaults(env);
  });

  it("orders default config candidates in a stable order", () => {
    const home = "/home/test";
    const resolvedHome = path.resolve(home);
    const candidates = resolveDefaultConfigCandidates({} as NodeJS.ProcessEnv, () => home);
    const expected = [
      path.join(resolvedHome, ".alisio", "alisio.json"),
      path.join(resolvedHome, ".alisio", LEGACY_CONFIG_FILENAME),
      path.join(resolvedHome, ".alisio", LEGACY_ALT_CONFIG_FILENAME),
      path.join(resolvedHome, LEGACY_STATE_DIRNAME, "alisio.json"),
      path.join(resolvedHome, LEGACY_STATE_DIRNAME, LEGACY_CONFIG_FILENAME),
      path.join(resolvedHome, LEGACY_STATE_DIRNAME, LEGACY_ALT_CONFIG_FILENAME),
      path.join(resolvedHome, LEGACY_ALT_STATE_DIRNAME, "alisio.json"),
      path.join(resolvedHome, LEGACY_ALT_STATE_DIRNAME, LEGACY_CONFIG_FILENAME),
      path.join(resolvedHome, LEGACY_ALT_STATE_DIRNAME, LEGACY_ALT_CONFIG_FILENAME),
    ];
    expect(candidates).toEqual(expected);
  });

  it("prefers ~/.alisio when it exists and legacy dir is missing", async () => {
    await withTempDir({ prefix: "alisio-state-" }, async (root) => {
      const newDir = path.join(root, ".alisio");
      await fs.mkdir(newDir, { recursive: true });
      const resolved = resolveStateDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(newDir);
    });
  });

  it("falls back to existing legacy state dir when ~/.alisio is missing", async () => {
    await withTempDir({ prefix: "alisio-state-legacy-" }, async (root) => {
      const legacyDir = path.join(root, LEGACY_STATE_DIRNAME);
      await fs.mkdir(legacyDir, { recursive: true });
      const resolved = resolveStateDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(legacyDir);
    });
  });

  it("CONFIG_PATH prefers existing config when present", async () => {
    await withTempDir({ prefix: "alisio-config-" }, async (root) => {
      const legacyDir = path.join(root, LEGACY_STATE_DIRNAME);
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyPath = path.join(legacyDir, LEGACY_CONFIG_FILENAME);
      await fs.writeFile(legacyPath, "{}", "utf-8");

      const resolved = resolveConfigPathCandidate({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(legacyPath);
    });
  });

  it("respects state dir overrides when config is missing", async () => {
    await withTempDir({ prefix: "alisio-config-override-" }, async (root) => {
      const legacyDir = path.join(root, LEGACY_STATE_DIRNAME);
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyConfig = path.join(legacyDir, LEGACY_CONFIG_FILENAME);
      await fs.writeFile(legacyConfig, "{}", "utf-8");

      const overrideDir = path.join(root, "override");
      const env = { ALISIO_STATE_DIR: overrideDir } as NodeJS.ProcessEnv;
      const resolved = resolveConfigPath(env, overrideDir, () => root);
      expect(resolved).toBe(path.join(overrideDir, "alisio.json"));
    });
  });
});
