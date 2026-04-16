import os from "node:os";
import { spawnSync } from "node:child_process";

function safeTrim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveMacosVersion(): string {
  const result = spawnSync("sw_vers", ["-productVersion"], { encoding: "utf-8" });
  return safeTrim(result.stdout) || os.release();
}

export function resolveCurrentDeviceMetadata(): {
  platform: string;
  deviceFamily: string;
} {
  const platform = os.platform();
  if (platform === "darwin") {
    return {
      platform: `macos ${resolveMacosVersion()}`,
      deviceFamily: "Mac",
    };
  }
  if (platform === "win32") {
    return {
      platform: `windows ${os.release()}`,
      deviceFamily: "Windows",
    };
  }
  return {
    platform: `${platform} ${os.release()}`,
    deviceFamily: "Linux",
  };
}
