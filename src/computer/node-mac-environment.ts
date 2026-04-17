import type {
  ComputerActionResult,
  ComputerEnvironment,
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
      dataUrl: requireString(frame.dataUrl, "frame.dataUrl"),
      mimeType: requireString(frame.mimeType, "frame.mimeType"),
      width: requireFiniteNumber(frame.width, "frame.width"),
      height: requireFiniteNumber(frame.height, "frame.height"),
      capturedAt: requireFiniteNumber(frame.capturedAt, "frame.capturedAt"),
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
