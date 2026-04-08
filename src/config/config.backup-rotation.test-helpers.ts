import path from "node:path";
import { expect } from "vitest";
import { legacyEnvKey, readEnv } from "../infra/env.js";

export const IS_WINDOWS = process.platform === "win32";

export function resolveConfigPathFromTempState(fileName = "alisio.json"): string {
  const stateDir = readEnv("ALISIO_STATE_DIR", {
    fallback: legacyEnvKey("STATE_DIR"),
  });
  if (!stateDir) {
    throw new Error("Expected ALISIO_STATE_DIR to be set by withTempHome");
  }
  return path.join(stateDir, fileName);
}

export function expectPosixMode(statMode: number, expectedMode: number): void {
  if (IS_WINDOWS) {
    return;
  }
  expect(statMode & 0o777).toBe(expectedMode);
}
