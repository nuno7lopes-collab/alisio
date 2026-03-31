import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { InvokeAliasParams, ToolAlias, ToolAliasResult } from "./types.js";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 15_000;

export type ToolAliasDeps = {
  execFile?: typeof execFileAsync;
  platform?: NodeJS.Platform;
};

export function resolveToolCommand(alias: ToolAlias, platform: NodeJS.Platform = process.platform) {
  switch (alias) {
    case "system.whoami":
      return {
        command: platform === "win32" ? "whoami.exe" : "whoami",
        args: [],
      };
    default:
      return assertNever(alias);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported tool alias: ${String(value)}`);
}

export async function invokeToolAlias(
  params: InvokeAliasParams,
  deps: ToolAliasDeps = {},
): Promise<ToolAliasResult> {
  const runner = deps.execFile ?? execFileAsync;
  const resolved = resolveToolCommand(params.alias, deps.platform);
  try {
    const result = await runner(resolved.command, resolved.args, {
      timeout: DEFAULT_TIMEOUT_MS,
      windowsHide: true,
    });
    const output = result.stdout.trim() || result.stderr.trim() || "(sem output)";
    return {
      alias: params.alias,
      output,
      exitCode: 0,
      isError: false,
    };
  } catch (error) {
    const execError = error as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      message?: string;
    };
    return {
      alias: params.alias,
      output:
        execError.stderr?.trim() ||
        execError.stdout?.trim() ||
        execError.message ||
        "Falha ao executar alias local.",
      exitCode: typeof execError.code === "number" ? execError.code : 1,
      isError: true,
    };
  }
}
