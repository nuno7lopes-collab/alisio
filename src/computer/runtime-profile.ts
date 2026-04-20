import type {
  ComputerActionType,
  ComputerBackendKind,
  ComputerCapabilityDescriptor,
  ComputerCapabilityKind,
  ComputerSessionTarget,
} from "./types.js";

function buildLocalMacCapabilities(): ComputerCapabilityDescriptor[] {
  return [
    {
      kind: "observe_only",
      available: true,
      exposure: "exposed",
      reasonCode: "local_mac_observe_supported",
      reason: "Read-only screen capture is supported on the local Mac.",
    },
    {
      kind: "foreground_control",
      available: true,
      exposure: "exposed",
      reasonCode: "local_mac_foreground_control_supported",
      reason:
        "Control uses real macOS Accessibility input and may move focus, cursor, or global input.",
    },
  ];
}

function buildUnavailableCapabilities(params: {
  reason: string;
  reasonCode:
    | "web_runtime_unavailable"
    | "windows_local_runtime_unavailable"
    | "remote_node_runtime_unavailable"
    | "ssh_mac_runtime_unavailable";
}): ComputerCapabilityDescriptor[] {
  return [
    {
      kind: "observe_only",
      available: false,
      exposure: "hidden",
      reasonCode: params.reasonCode,
      reason: params.reason,
    },
    {
      kind: "foreground_control",
      available: false,
      exposure: "hidden",
      reasonCode: params.reasonCode,
      reason: params.reason,
    },
  ];
}

export function resolveComputerCapabilityMatrix(
  backend: ComputerBackendKind,
): ComputerCapabilityDescriptor[] {
  switch (backend) {
    case "local-mac":
      return buildLocalMacCapabilities();
    case "web":
      return buildUnavailableCapabilities({
        reason: "Web sessions do not expose a local computer runtime.",
        reasonCode: "web_runtime_unavailable",
      });
    case "windows-local":
      return buildUnavailableCapabilities({
        reason: "Windows-local computer control remains capability-gated until the runtime exists.",
        reasonCode: "windows_local_runtime_unavailable",
      });
    case "remote-node":
      return buildUnavailableCapabilities({
        reason: "Remote-node computer control is reserved for a later runtime phase.",
        reasonCode: "remote_node_runtime_unavailable",
      });
    case "ssh-mac":
      return buildUnavailableCapabilities({
        reason: "SSH-mac computer control is reserved for a later runtime phase.",
        reasonCode: "ssh_mac_runtime_unavailable",
      });
  }
}

export function resolveComputerTarget(params: {
  backend: ComputerBackendKind;
  sessionKey: string;
  nodeId?: string | null;
  displayId?: string | null;
}): ComputerSessionTarget {
  const sessionKey = params.sessionKey.trim() || "main";
  const displayId = params.displayId?.trim() || undefined;
  switch (params.backend) {
    case "local-mac": {
      const nodeId = params.nodeId?.trim() || "local";
      return {
        id: displayId ? `local-mac:${nodeId}:display:${displayId}` : `local-mac:${nodeId}:host`,
        label: displayId ? `Local Mac (${displayId})` : "Local Mac",
        kind: "local-mac-host",
        platform: "macos",
        nodeId,
        ...(displayId ? { displayId } : {}),
        globalInput: true,
        allowsConcurrentObserve: true,
      };
    }
    case "web":
      return {
        id: `web:${sessionKey}`,
        label: "Web session",
        kind: "web-session",
        platform: "web",
        globalInput: false,
        allowsConcurrentObserve: false,
      };
    case "windows-local": {
      const nodeId = params.nodeId?.trim() || "local";
      return {
        id: `windows-local:${nodeId}:host`,
        label: "Local Windows",
        kind: "windows-local-host",
        platform: "windows",
        nodeId,
        globalInput: false,
        allowsConcurrentObserve: false,
      };
    }
    case "remote-node":
      return {
        id: `remote-node:${params.nodeId?.trim() || sessionKey}`,
        label: "Remote node",
        kind: "remote-node-target",
        platform: "unknown",
        nodeId: params.nodeId?.trim() || undefined,
        globalInput: false,
        allowsConcurrentObserve: false,
      };
    case "ssh-mac":
      return {
        id: `ssh-mac:${params.nodeId?.trim() || sessionKey}`,
        label: "SSH Mac",
        kind: "ssh-mac-host",
        platform: "macos",
        nodeId: params.nodeId?.trim() || undefined,
        globalInput: false,
        allowsConcurrentObserve: false,
      };
  }
}

export function findComputerCapability(
  capabilities: readonly ComputerCapabilityDescriptor[],
  kind: ComputerCapabilityKind,
): ComputerCapabilityDescriptor | null {
  return capabilities.find((entry) => entry.kind === kind) ?? null;
}

export function actionRequiresForegroundControl(actionType: ComputerActionType): boolean {
  switch (actionType) {
    case "screenshot":
    case "wait":
      return false;
    case "move":
    case "click":
    case "double_click":
    case "right_click":
    case "drag":
    case "scroll":
    case "type":
    case "keypress":
    case "focus_app":
    case "open_url":
    case "reveal_path":
    case "open_path":
    case "open_app":
      return true;
  }
}
