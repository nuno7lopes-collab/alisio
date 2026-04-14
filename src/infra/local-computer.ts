import os from "node:os";
import { getMachineDisplayName } from "./machine-name.js";

function normalizeHostToken(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  const withoutTrailingDot = lower.endsWith(".") ? lower.slice(0, -1) : lower;
  return withoutTrailingDot || null;
}

export function resolveCurrentComputerHostToken(): string {
  return normalizeHostToken(os.hostname()) ?? "alisio";
}

export function resolveCurrentComputerFallbackLabel(): string {
  return (
    os
      .hostname()
      .trim()
      .replace(/\.local$/i, "") || "This computer"
  );
}

export function resolveCurrentComputerId(): string {
  return `local:${resolveCurrentComputerHostToken()}`;
}

export async function resolveCurrentComputerIdentity(): Promise<{
  computerId: string;
  label: string;
  hostToken: string;
}> {
  const hostToken = resolveCurrentComputerHostToken();
  const label = await getMachineDisplayName().catch(() => resolveCurrentComputerFallbackLabel());
  return {
    computerId: `local:${hostToken}`,
    label: label.trim() || resolveCurrentComputerFallbackLabel(),
    hostToken,
  };
}

export function isLocalComputerRemoteIp(remoteIp: string | null | undefined): boolean {
  const trimmed = remoteIp?.trim();
  if (!trimmed) {
    return true;
  }
  const normalized = trimmed.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1" ||
    normalized.startsWith("127.") ||
    normalized.startsWith("::ffff:127.")
  );
}
