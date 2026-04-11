import { describe, expect, it } from "vitest";
import {
  buildParseArgv,
  getFlagValue,
  getCommandPath,
  getCommandPositionalsWithRootOptions,
  getCommandPathWithRootOptions,
  getPrimaryCommand,
  getPositiveIntFlagValue,
  getVerboseFlag,
  hasHelpOrVersion,
  hasFlag,
  isRootHelpInvocation,
  isRootVersionInvocation,
  shouldMigrateState,
  shouldMigrateStateFromPath,
} from "./argv.js";

describe("argv helpers", () => {
  it.each([
    {
      name: "help flag",
      argv: ["node", "alisio", "--help"],
      expected: true,
    },
    {
      name: "version flag",
      argv: ["node", "alisio", "-V"],
      expected: true,
    },
    {
      name: "normal command",
      argv: ["node", "alisio", "status"],
      expected: false,
    },
    {
      name: "root -v alias",
      argv: ["node", "alisio", "-v"],
      expected: true,
    },
    {
      name: "root -v alias with profile",
      argv: ["node", "alisio", "--profile", "work", "-v"],
      expected: true,
    },
    {
      name: "root -v alias with log-level",
      argv: ["node", "alisio", "--log-level", "debug", "-v"],
      expected: true,
    },
    {
      name: "subcommand -v should not be treated as version",
      argv: ["node", "alisio", "acp", "-v"],
      expected: false,
    },
    {
      name: "root -v alias with equals profile",
      argv: ["node", "alisio", "--profile=work", "-v"],
      expected: true,
    },
    {
      name: "subcommand path after global root flags should not be treated as version",
      argv: ["node", "alisio", "--dev", "skills", "list", "-v"],
      expected: false,
    },
  ])("detects help/version flags: $name", ({ argv, expected }) => {
    expect(hasHelpOrVersion(argv)).toBe(expected);
  });

  it.each([
    {
      name: "root --version",
      argv: ["node", "alisio", "--version"],
      expected: true,
    },
    {
      name: "root -V",
      argv: ["node", "alisio", "-V"],
      expected: true,
    },
    {
      name: "root -v alias with profile",
      argv: ["node", "alisio", "--profile", "work", "-v"],
      expected: true,
    },
    {
      name: "subcommand version flag",
      argv: ["node", "alisio", "status", "--version"],
      expected: false,
    },
    {
      name: "unknown root flag with version",
      argv: ["node", "alisio", "--unknown", "--version"],
      expected: false,
    },
  ])("detects root-only version invocations: $name", ({ argv, expected }) => {
    expect(isRootVersionInvocation(argv)).toBe(expected);
  });

  it.each([
    {
      name: "root --help",
      argv: ["node", "alisio", "--help"],
      expected: true,
    },
    {
      name: "root -h",
      argv: ["node", "alisio", "-h"],
      expected: true,
    },
    {
      name: "root --help with profile",
      argv: ["node", "alisio", "--profile", "work", "--help"],
      expected: true,
    },
    {
      name: "subcommand --help",
      argv: ["node", "alisio", "status", "--help"],
      expected: false,
    },
    {
      name: "help before subcommand token",
      argv: ["node", "alisio", "--help", "status"],
      expected: false,
    },
    {
      name: "help after -- terminator",
      argv: ["node", "alisio", "nodes", "invoke", "--", "device.status", "--help"],
      expected: false,
    },
    {
      name: "unknown root flag before help",
      argv: ["node", "alisio", "--unknown", "--help"],
      expected: false,
    },
    {
      name: "unknown root flag after help",
      argv: ["node", "alisio", "--help", "--unknown"],
      expected: false,
    },
  ])("detects root-only help invocations: $name", ({ argv, expected }) => {
    expect(isRootHelpInvocation(argv)).toBe(expected);
  });

  it.each([
    {
      name: "single command with trailing flag",
      argv: ["node", "alisio", "status", "--json"],
      expected: ["status"],
    },
    {
      name: "two-part command",
      argv: ["node", "alisio", "agents", "list"],
      expected: ["agents", "list"],
    },
    {
      name: "terminator cuts parsing",
      argv: ["node", "alisio", "status", "--", "ignored"],
      expected: ["status"],
    },
  ])("extracts command path: $name", ({ argv, expected }) => {
    expect(getCommandPath(argv, 2)).toEqual(expected);
  });

  it("extracts command path while skipping known root option values", () => {
    expect(
      getCommandPathWithRootOptions(
        [
          "node",
          "alisio",
          "--profile",
          "work",
          "--container",
          "demo",
          "--no-color",
          "config",
          "validate",
        ],
        2,
      ),
    ).toEqual(["config", "validate"]);
  });

  it("extracts routed config get positionals with interleaved root options", () => {
    expect(
      getCommandPositionalsWithRootOptions(
        ["node", "alisio", "config", "get", "--log-level", "debug", "update.channel", "--json"],
        {
          commandPath: ["config", "get"],
          booleanFlags: ["--json"],
        },
      ),
    ).toEqual(["update.channel"]);
  });

  it("extracts routed config unset positionals with interleaved root options", () => {
    expect(
      getCommandPositionalsWithRootOptions(
        ["node", "alisio", "config", "unset", "--profile", "work", "update.channel"],
        {
          commandPath: ["config", "unset"],
        },
      ),
    ).toEqual(["update.channel"]);
  });

  it("returns null when routed command sees unknown options", () => {
    expect(
      getCommandPositionalsWithRootOptions(
        ["node", "alisio", "config", "get", "--mystery", "value", "update.channel"],
        {
          commandPath: ["config", "get"],
          booleanFlags: ["--json"],
        },
      ),
    ).toBeNull();
  });

  it.each([
    {
      name: "returns first command token",
      argv: ["node", "alisio", "agents", "list"],
      expected: "agents",
    },
    {
      name: "returns null when no command exists",
      argv: ["node", "alisio"],
      expected: null,
    },
    {
      name: "skips known root option values",
      argv: ["node", "alisio", "--log-level", "debug", "status"],
      expected: "status",
    },
  ])("returns primary command: $name", ({ argv, expected }) => {
    expect(getPrimaryCommand(argv)).toBe(expected);
  });

  it.each([
    {
      name: "detects flag before terminator",
      argv: ["node", "alisio", "status", "--json"],
      flag: "--json",
      expected: true,
    },
    {
      name: "ignores flag after terminator",
      argv: ["node", "alisio", "--", "--json"],
      flag: "--json",
      expected: false,
    },
  ])("parses boolean flags: $name", ({ argv, flag, expected }) => {
    expect(hasFlag(argv, flag)).toBe(expected);
  });

  it.each([
    {
      name: "value in next token",
      argv: ["node", "alisio", "status", "--timeout", "5000"],
      expected: "5000",
    },
    {
      name: "value in equals form",
      argv: ["node", "alisio", "status", "--timeout=2500"],
      expected: "2500",
    },
    {
      name: "missing value",
      argv: ["node", "alisio", "status", "--timeout"],
      expected: null,
    },
    {
      name: "next token is another flag",
      argv: ["node", "alisio", "status", "--timeout", "--json"],
      expected: null,
    },
    {
      name: "flag appears after terminator",
      argv: ["node", "alisio", "--", "--timeout=99"],
      expected: undefined,
    },
  ])("extracts flag values: $name", ({ argv, expected }) => {
    expect(getFlagValue(argv, "--timeout")).toBe(expected);
  });

  it("parses verbose flags", () => {
    expect(getVerboseFlag(["node", "alisio", "status", "--verbose"])).toBe(true);
    expect(getVerboseFlag(["node", "alisio", "status", "--debug"])).toBe(false);
    expect(getVerboseFlag(["node", "alisio", "status", "--debug"], { includeDebug: true })).toBe(
      true,
    );
  });

  it.each([
    {
      name: "missing flag",
      argv: ["node", "alisio", "status"],
      expected: undefined,
    },
    {
      name: "missing value",
      argv: ["node", "alisio", "status", "--timeout"],
      expected: null,
    },
    {
      name: "valid positive integer",
      argv: ["node", "alisio", "status", "--timeout", "5000"],
      expected: 5000,
    },
    {
      name: "invalid integer",
      argv: ["node", "alisio", "status", "--timeout", "nope"],
      expected: undefined,
    },
  ])("parses positive integer flag values: $name", ({ argv, expected }) => {
    expect(getPositiveIntFlagValue(argv, "--timeout")).toBe(expected);
  });

  it.each([
    {
      name: "keeps plain node argv",
      rawArgs: ["node", "alisio", "status"],
      expected: ["node", "alisio", "status"],
    },
    {
      name: "keeps version-suffixed node binary",
      rawArgs: ["node-22", "alisio", "status"],
      expected: ["node-22", "alisio", "status"],
    },
    {
      name: "keeps windows versioned node exe",
      rawArgs: ["node-22.2.0.exe", "alisio", "status"],
      expected: ["node-22.2.0.exe", "alisio", "status"],
    },
    {
      name: "keeps dotted node binary",
      rawArgs: ["node-22.2", "alisio", "status"],
      expected: ["node-22.2", "alisio", "status"],
    },
    {
      name: "keeps dotted node exe",
      rawArgs: ["node-22.2.exe", "alisio", "status"],
      expected: ["node-22.2.exe", "alisio", "status"],
    },
    {
      name: "keeps absolute versioned node path",
      rawArgs: ["/usr/bin/node-22.2.0", "alisio", "status"],
      expected: ["/usr/bin/node-22.2.0", "alisio", "status"],
    },
    {
      name: "keeps node24 shorthand",
      rawArgs: ["node24", "alisio", "status"],
      expected: ["node24", "alisio", "status"],
    },
    {
      name: "keeps absolute node24 shorthand",
      rawArgs: ["/usr/bin/node24", "alisio", "status"],
      expected: ["/usr/bin/node24", "alisio", "status"],
    },
    {
      name: "keeps windows node24 exe",
      rawArgs: ["node24.exe", "alisio", "status"],
      expected: ["node24.exe", "alisio", "status"],
    },
    {
      name: "keeps nodejs binary",
      rawArgs: ["nodejs", "alisio", "status"],
      expected: ["nodejs", "alisio", "status"],
    },
    {
      name: "prefixes fallback when first arg is not a node launcher",
      rawArgs: ["node-dev", "alisio", "status"],
      expected: ["node", "alisio", "node-dev", "alisio", "status"],
    },
    {
      name: "prefixes fallback when raw args start at program name",
      rawArgs: ["alisio", "status"],
      expected: ["node", "alisio", "status"],
    },
    {
      name: "keeps bun execution argv",
      rawArgs: ["bun", "src/entry.ts", "status"],
      expected: ["bun", "src/entry.ts", "status"],
    },
  ] as const)("builds parse argv from raw args: $name", ({ rawArgs, expected }) => {
    const parsed = buildParseArgv({
      programName: "alisio",
      rawArgs: [...rawArgs],
    });
    expect(parsed).toEqual([...expected]);
  });

  it("builds parse argv from fallback args", () => {
    const fallbackArgv = buildParseArgv({
      programName: "alisio",
      fallbackArgv: ["status"],
    });
    expect(fallbackArgv).toEqual(["node", "alisio", "status"]);
  });

  it.each([
    { argv: ["node", "alisio", "status"], expected: false },
    { argv: ["node", "alisio", "health"], expected: false },
    { argv: ["node", "alisio", "sessions"], expected: false },
    { argv: ["node", "alisio", "config", "get", "update"], expected: false },
    { argv: ["node", "alisio", "config", "unset", "update"], expected: false },
    { argv: ["node", "alisio", "models", "list"], expected: false },
    { argv: ["node", "alisio", "models", "status"], expected: false },
    { argv: ["node", "alisio", "update", "status", "--json"], expected: false },
    { argv: ["node", "alisio", "agent", "--message", "hi"], expected: false },
    { argv: ["node", "alisio", "agents", "list"], expected: true },
    { argv: ["node", "alisio", "message", "send"], expected: true },
  ] as const)("decides when to migrate state: $argv", ({ argv, expected }) => {
    expect(shouldMigrateState([...argv])).toBe(expected);
  });

  it.each([
    { path: ["status"], expected: false },
    { path: ["update", "status"], expected: false },
    { path: ["config", "get"], expected: false },
    { path: ["models", "status"], expected: false },
    { path: ["agents", "list"], expected: true },
  ])("reuses command path for migrate state decisions: $path", ({ path, expected }) => {
    expect(shouldMigrateStateFromPath(path)).toBe(expected);
  });
});
