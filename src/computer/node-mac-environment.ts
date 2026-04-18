import type {
  ComputerActionFailureCategory,
  ComputerActionResult,
  ComputerActionType,
  ComputerCoordinateSpace,
  ComputerEnvironment,
  ComputerExecutedActionResult,
  ComputerObservation,
  ComputerStructuredAction,
} from "./types.js";

type NodeInvokeResponse = {
  payload?: unknown;
};

export type ComputerNodeInvoke = (
  command: "computer.observe" | "computer.act",
  params?: Record<string, unknown>,
) => Promise<NodeInvokeResponse>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`invalid ${label}`);
  }
  return value.trim();
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function requireCoordinateSpace(value: unknown, label: string): ComputerCoordinateSpace {
  if (value !== "display-pixel" && value !== "rendered-pane") {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function requireOrientation(value: unknown, label: string) {
  if (value !== "landscape" && value !== "portrait") {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function parseActionType(value: unknown, label: string): ComputerActionType {
  switch (value) {
    case "move":
    case "click":
    case "double_click":
    case "right_click":
    case "drag":
    case "scroll":
    case "type":
    case "keypress":
    case "wait":
    case "screenshot":
    case "focus_app":
    case "open_url":
    case "reveal_path":
    case "open_path":
    case "open_app":
    case "app_focus":
      return value;
    default:
      throw new Error(`invalid ${label}`);
  }
}

function parseFailureCategory(value: unknown): ComputerActionFailureCategory | undefined {
  switch (value) {
    case "validation":
    case "stale-frame":
    case "invalid-target":
    case "permission-missing":
    case "cancelled":
    case "execution-failed":
    case "action-rejected":
      return value;
    default:
      return undefined;
  }
}

function parseObservationPayload(payload: unknown): ComputerObservation {
  if (!isRecord(payload)) {
    throw new Error("invalid computer.observe payload");
  }
  const frame = isRecord(payload.frame) ? payload.frame : null;
  const context = isRecord(payload.context) ? payload.context : null;
  if (!frame || !context) {
    throw new Error("invalid computer.observe payload");
  }
  const display = isRecord(context.display) ? context.display : null;
  if (!display) {
    throw new Error("invalid computer.observe context");
  }
  return {
    frame: {
      id: requireString(frame.id, "frame.id"),
      dataUrl: requireString(frame.dataUrl, "frame.dataUrl"),
      mimeType: requireString(frame.mimeType, "frame.mimeType"),
      width: requireFiniteNumber(frame.width, "frame.width"),
      height: requireFiniteNumber(frame.height, "frame.height"),
      pixelWidth: requireFiniteNumber(frame.pixelWidth, "frame.pixelWidth"),
      pixelHeight: requireFiniteNumber(frame.pixelHeight, "frame.pixelHeight"),
      logicalWidth: requireFiniteNumber(frame.logicalWidth, "frame.logicalWidth"),
      logicalHeight: requireFiniteNumber(frame.logicalHeight, "frame.logicalHeight"),
      scaleFactor: requireFiniteNumber(frame.scaleFactor, "frame.scaleFactor"),
      orientation: requireOrientation(frame.orientation, "frame.orientation"),
      displayId: typeof frame.displayId === "string" ? frame.displayId : undefined,
      sourceSpace: requireCoordinateSpace(frame.sourceSpace, "frame.sourceSpace"),
      capturedAt: requireFiniteNumber(frame.capturedAt, "frame.capturedAt"),
      maxAgeMs: requireFiniteNumber(frame.maxAgeMs, "frame.maxAgeMs"),
      staleAt: requireFiniteNumber(frame.staleAt, "frame.staleAt"),
      cursor: isRecord(frame.cursor)
        ? {
            x: requireFiniteNumber(frame.cursor.x, "frame.cursor.x"),
            y: requireFiniteNumber(frame.cursor.y, "frame.cursor.y"),
            visible: frame.cursor.visible !== false,
          }
        : null,
    },
    context: {
      display: {
        id: typeof display.id === "string" ? display.id : undefined,
        width: requireFiniteNumber(display.width, "context.display.width"),
        height: requireFiniteNumber(display.height, "context.display.height"),
        scale: requireFiniteNumber(display.scale, "context.display.scale"),
        logicalWidth: requireFiniteNumber(
          display.logicalWidth,
          "context.display.logicalWidth",
        ),
        logicalHeight: requireFiniteNumber(
          display.logicalHeight,
          "context.display.logicalHeight",
        ),
        pixelWidth: requireFiniteNumber(display.pixelWidth, "context.display.pixelWidth"),
        pixelHeight: requireFiniteNumber(display.pixelHeight, "context.display.pixelHeight"),
        orientation: requireOrientation(
          display.orientation,
          "context.display.orientation",
        ),
      },
      activeApp: isRecord(context.activeApp)
        ? {
            name: typeof context.activeApp.name === "string" ? context.activeApp.name : undefined,
            bundleId:
              typeof context.activeApp.bundleId === "string"
                ? context.activeApp.bundleId
                : undefined,
            processId:
              typeof context.activeApp.processId === "number" &&
              Number.isFinite(context.activeApp.processId)
                ? context.activeApp.processId
                : undefined,
          }
        : null,
      activeWindow: isRecord(context.activeWindow)
        ? {
            title:
              typeof context.activeWindow.title === "string"
                ? context.activeWindow.title
                : undefined,
          }
        : null,
      errorState: typeof context.errorState === "string" ? context.errorState : null,
      capturedAt: requireFiniteNumber(context.capturedAt, "context.capturedAt"),
    },
  };
}

function parseActionResults(payload: unknown): ComputerExecutedActionResult[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  const results: ComputerExecutedActionResult[] = [];
  for (const entry of payload) {
    if (!isRecord(entry)) {
      continue;
    }
    const id = requireString(entry.id, "results[].id");
    const type = parseActionType(entry.type, "results[].type");
    const success = entry.success !== false;
    const elapsedMs = requireFiniteNumber(entry.elapsedMs, "results[].elapsedMs");
    const retryCount = requireFiniteNumber(entry.retryCount, "results[].retryCount");
    const summary = requireString(entry.summary, "results[].summary");
    results.push({
      id,
      actionId: typeof entry.actionId === "string" ? entry.actionId : undefined,
      type,
      success,
      elapsedMs,
      retryCount,
      summary,
      failureCategory: parseFailureCategory(entry.failureCategory),
      sourceFrameId:
        typeof entry.sourceFrameId === "string" ? entry.sourceFrameId : undefined,
      resultFrameId:
        typeof entry.resultFrameId === "string" ? entry.resultFrameId : undefined,
    });
  }
  return results;
}

function parseActionPayload(payload: unknown): ComputerActionResult {
  if (!isRecord(payload)) {
    throw new Error("invalid computer.act payload");
  }
  return {
    ok: payload.ok !== false,
    summary:
      typeof payload.summary === "string" && payload.summary.trim()
        ? payload.summary.trim()
        : "action completed",
    results: parseActionResults(payload.results),
    observation: payload.observation ? parseObservationPayload(payload.observation) : undefined,
  };
}

export class NodeMacComputerEnvironment implements ComputerEnvironment {
  readonly backend = "local-mac" as const;

  constructor(private readonly invoke: ComputerNodeInvoke) {}

  async observe(signal?: AbortSignal): Promise<ComputerObservation> {
    signal?.throwIfAborted();
    const raw = await this.invoke("computer.observe");
    signal?.throwIfAborted();
    return parseObservationPayload(raw.payload);
  }

  async act(action: ComputerStructuredAction, signal?: AbortSignal): Promise<ComputerActionResult> {
    signal?.throwIfAborted();
    const raw = await this.invoke("computer.act", {
      action,
    });
    signal?.throwIfAborted();
    return parseActionPayload(raw.payload);
  }
}
