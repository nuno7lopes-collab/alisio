import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway run --dev for subcommands", () => {
    const res = parseCliProfileArgs([
      "node",
      "alisio",
      "gateway",
      "run",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "alisio", "gateway", "run", "--dev", "--allow-unconfigured"]);
  });

  it("leaves gateway run --dev for subcommands after leading root options", () => {
    const res = parseCliProfileArgs([
      "node",
      "alisio",
      "--no-color",
      "gateway",
      "run",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual([
      "node",
      "alisio",
      "--no-color",
      "gateway",
      "run",
      "--dev",
      "--allow-unconfigured",
    ]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "alisio", "--dev", "gateway"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "alisio", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "alisio", "--profile", "work", "status"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "alisio", "status"]);
  });

  it("parses interleaved --profile after the command token", () => {
    const res = parseCliProfileArgs(["node", "alisio", "status", "--profile", "work", "--deep"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "alisio", "status", "--deep"]);
  });

  it("parses interleaved --dev after the command token", () => {
    const res = parseCliProfileArgs(["node", "alisio", "status", "--dev"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "alisio", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "alisio", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it.each([
    ["--dev first", ["node", "alisio", "--dev", "--profile", "work", "status"]],
    ["--profile first", ["node", "alisio", "--profile", "work", "--dev", "status"]],
    ["interleaved after command", ["node", "alisio", "status", "--profile", "work", "--dev"]],
  ])("rejects combining --dev with --profile (%s)", (_name, argv) => {
    const res = parseCliProfileArgs(argv);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join(path.resolve("/home/peter"), ".alisio-dev");
    expect(env.ALISIO_PROFILE).toBe("dev");
    expect(env.ALISIO_STATE_DIR).toBe(expectedStateDir);
    expect(env.ALISIO_CONFIG_PATH).toBe(path.join(expectedStateDir, "alisio.json"));
    expect(env.ALISIO_GATEWAY_PORT).toBe("19001");
    expect(env.ALISIO_PROFILE).toBe("dev");
    expect(env.ALISIO_STATE_DIR).toBe(expectedStateDir);
    expect(env.ALISIO_CONFIG_PATH).toBe(path.join(expectedStateDir, "alisio.json"));
    expect(env.ALISIO_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      ALISIO_STATE_DIR: "/custom",
      ALISIO_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.ALISIO_STATE_DIR).toBe("/custom");
    expect(env.ALISIO_GATEWAY_PORT).toBe("19099");
    expect(env.ALISIO_CONFIG_PATH).toBe(path.join("/custom", "alisio.json"));
    expect(env.ALISIO_STATE_DIR).toBe("/custom");
    expect(env.ALISIO_GATEWAY_PORT).toBe("19099");
    expect(env.ALISIO_CONFIG_PATH).toBe(path.join("/custom", "alisio.json"));
  });

  it("uses ALISIO_HOME when deriving profile state dir", () => {
    const env: Record<string, string | undefined> = {
      ALISIO_HOME: "/srv/alisio-home",
      HOME: "/home/other",
    };
    applyCliProfileEnv({
      profile: "work",
      env,
      homedir: () => "/home/fallback",
    });

    const resolvedHome = path.resolve("/srv/alisio-home");
    expect(env.ALISIO_STATE_DIR).toBe(path.join(resolvedHome, ".alisio-work"));
    expect(env.ALISIO_CONFIG_PATH).toBe(path.join(resolvedHome, ".alisio-work", "alisio.json"));
    expect(env.ALISIO_STATE_DIR).toBe(path.join(resolvedHome, ".alisio-work"));
    expect(env.ALISIO_CONFIG_PATH).toBe(path.join(resolvedHome, ".alisio-work", "alisio.json"));
  });
});

describe("formatCliCommand", () => {
  it.each([
    {
      name: "no profile is set",
      cmd: "alisio doctor --fix",
      env: {},
      expected: "alisio doctor --fix",
    },
    {
      name: "profile is default",
      cmd: "alisio doctor --fix",
      env: { ALISIO_PROFILE: "default" },
      expected: "alisio doctor --fix",
    },
    {
      name: "profile is Default (case-insensitive)",
      cmd: "alisio doctor --fix",
      env: { ALISIO_PROFILE: "Default" },
      expected: "alisio doctor --fix",
    },
    {
      name: "profile is invalid",
      cmd: "alisio doctor --fix",
      env: { ALISIO_PROFILE: "bad profile" },
      expected: "alisio doctor --fix",
    },
    {
      name: "--profile is already present",
      cmd: "alisio --profile work doctor --fix",
      env: { ALISIO_PROFILE: "work" },
      expected: "alisio --profile work doctor --fix",
    },
    {
      name: "--dev is already present",
      cmd: "alisio --dev doctor",
      env: { ALISIO_PROFILE: "dev" },
      expected: "alisio --dev doctor",
    },
  ])("returns command unchanged when $name", ({ cmd, env, expected }) => {
    expect(formatCliCommand(cmd, env)).toBe(expected);
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("alisio doctor --fix", { ALISIO_PROFILE: "work" })).toBe(
      "alisio --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("alisio doctor --fix", { ALISIO_PROFILE: "  jbalisio  " })).toBe(
      "alisio --profile jbalisio doctor --fix",
    );
  });

  it("handles command with no args after alisio", () => {
    expect(formatCliCommand("alisio", { ALISIO_PROFILE: "test" })).toBe("alisio --profile test");
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm alisio doctor", { ALISIO_PROFILE: "work" })).toBe(
      "pnpm alisio --profile work doctor",
    );
  });

  it("inserts --container when a container hint is set", () => {
    expect(
      formatCliCommand("alisio gateway status --deep", { ALISIO_CONTAINER_HINT: "demo" }),
    ).toBe("alisio --container demo gateway status --deep");
  });

  it("preserves both --container and --profile hints", () => {
    expect(
      formatCliCommand("alisio doctor", {
        ALISIO_CONTAINER_HINT: "demo",
        ALISIO_PROFILE: "work",
      }),
    ).toBe("alisio --container demo doctor");
  });

  it("does not prepend --container for update commands", () => {
    expect(formatCliCommand("alisio update", { ALISIO_CONTAINER_HINT: "demo" })).toBe(
      "alisio update",
    );
    expect(
      formatCliCommand("pnpm alisio update --channel beta", { ALISIO_CONTAINER_HINT: "demo" }),
    ).toBe("pnpm alisio update --channel beta");
  });
});
