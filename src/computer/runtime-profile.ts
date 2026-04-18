import type {
  ComputerActionType,
  ComputerBackendKind,
  ComputerCapabilityDescriptor,
  ComputerSessionTarget,
} from "./types.js";

function buildLocalMacCapabilities(): ComputerCapabilityDescriptor[] {
  return [
    {
      kind: "observe_only",
      available: true,
      exposure: "exposed",
      reason: "Read-only screen capture is supported on the local Mac.",
    },
    {
      kind: "foreground_control",
      available: true,
      exposure: "exposed",
      reason:
        "Control uses real macOS Accessibility input and may move focus, cursor, or global input.",
    },
    {
      kind: "background_safe_control",
      available: false,
      exposure: "hidden",
      reason:
        "Local macOS control is not background-safe because it still depends on real foreground input.",
    },
    {
      kind: "future_virtualized_control",
      available: false,
      exposure: "hidden",
      reason: "No virtualized desktop target exists in the current local-mac runtime.",
    },
  ];
}

function buildUnavailableFutureCapabilities(reason: string): ComputerCapabilityDescriptor[] {
  return [
    {
      kind: "observe_only",
      available: false,
      exposure: "hidden",
      reason,
    },
    {
      kind: "foreground_control",
      available: false,
      exposure: "hidden",
      reason,
    },
    {
      kind: "background_safe_control",
      available: false,
      exposure: "hidden",
      reason,
    },
    {
      kind: "future_virtualized_control",
      available: false,
      exposure: "hidden",
      reason,
    },
  ];
}

export function resolveComputerCapabilityMatrix(
  backend: ComputerBackendKind,
): ComputerCapabilityDescriptor[] {
  switch (backend) {
    case "local-mac":
      return buildLocalMacCapabilities();
    case "remote-node":
      return buildUnavailableFutureCapabilities(
        "Remote-node computer control is reserved for a later runtime phase.",
      );
    case "ssh-mac":
      return buildUnavailableFutureCapabilities(
        "SSH-mac computer control is reserved for a later runtime phase.",
      );
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
        id: displayId
          ? `local-mac:${nodeId}:display:${displayId}`
          : `local-mac:${nodeId}:host`,
        label: displayId ? `Local Mac (${displayId})` : "Local Mac",
        kind: "local-mac-host",
        nodeId,
        ...(displayId ? { displayId } : {}),
        globalInput: true,
        allowsConcurrentObserve: true,
      };
    }
    case "remote-node":
      return {
        id: `remote-node:${params.nodeId?.trim() || sessionKey}`,
        label: "Remote node",
        kind: "remote-node-target",
        nodeId: params.nodeId?.trim() || undefined,
        globalInput: false,
        allowsConcurrentObserve: false,
      };
    case "ssh-mac":
      return {
        id: `ssh-mac:${params.nodeId?.trim() || sessionKey}`,
        label: "SSH Mac",
        kind: "ssh-mac-host",
        nodeId: params.nodeId?.trim() || undefined,
        globalInput: false,
        allowsConcurrentObserve: false,
      };
  }
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
    case "app_focus":
      return true;
  }
}

export function sessionSupportsBackgroundSafeControl(
  capabilities: readonly ComputerCapabilityDescriptor[],
): boolean {
  return capabilities.some(
    (entry) => entry.kind === "background_safe_control" && entry.available && entry.exposure === "exposed",
  );
}
