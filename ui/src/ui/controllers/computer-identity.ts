import type { NodeListNode } from "../../../../src/shared/node-list-types.js";

export function normalizeComputerText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveComputerId(params: {
  computerId?: string | null;
  fallbackId?: string | null;
}): string | null {
  return normalizeComputerText(params.computerId) ?? normalizeComputerText(params.fallbackId);
}

export function resolveComputerLabelText(params: {
  computerLabel?: string | null;
  displayName?: string | null;
  platform?: string | null;
  clientId?: string | null;
  clientMode?: string | null;
  deviceFamily?: string | null;
  fallbackLabel?: string | null;
}): string | null {
  return (
    normalizeComputerText(params.computerLabel) ??
    normalizeComputerText(params.displayName) ??
    normalizeComputerText(params.platform) ??
    normalizeComputerText(params.clientId) ??
    normalizeComputerText(params.clientMode) ??
    normalizeComputerText(params.deviceFamily) ??
    normalizeComputerText(params.fallbackLabel)
  );
}

export function resolveNodeRuntimeComputerId(node: Pick<NodeListNode, "computerId" | "nodeId">) {
  return resolveComputerId({
    computerId: node.computerId,
    fallbackId: node.nodeId,
  });
}

export function resolveComputerGroupKey(params: {
  computerId?: string | null;
  fallbackId?: string | null;
}): string | null {
  const value = resolveComputerId(params);
  return value ? value.toLowerCase().replace(/\s+/g, " ") : null;
}

export function resolveNodeRuntimePlatform(node: Pick<NodeListNode, "platform">) {
  return normalizeComputerText(node.platform) ?? null;
}
