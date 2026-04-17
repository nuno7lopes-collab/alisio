import crypto from "node:crypto";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { NodeMacComputerEnvironment } from "../../computer/node-mac-environment.js";
import { computerSessionManager } from "../../computer/session-manager.js";
import type {
  ComputerActionResult,
  ComputerApprovalMode,
  ComputerObservation,
  ComputerSessionState,
  ComputerStructuredAction,
} from "../../computer/types.js";
import type { AlisioConfig } from "../../config/config.js";
import { resolveImageSanitizationLimits } from "../image-sanitization.js";
import { optionalStringEnum, stringEnum } from "../schema/typebox.js";
import { sanitizeToolResultImages } from "../tool-images.js";
import {
  jsonResult,
  readNumberParam,
  readStringArrayParam,
  readStringParam,
  textResult,
  type AnyAgentTool,
} from "./common.js";
import { callGatewayTool, readGatewayCallOptions } from "./gateway.js";
import { resolveNode } from "./nodes-utils.js";

const COMPUTER_ACTIONS = [
  "observe",
  "click",
  "double_click",
  "right_click",
  "drag",
  "scroll",
  "type",
  "keypress",
  "wait",
  "open_url",
  "reveal_path",
  "open_path",
  "app_focus",
  "session",
  "pause",
  "resume",
  "stop",
] as const;

const COMPUTER_APPROVAL_MODES = [
  "observe-only",
  "control-approved-apps",
  "elevated-watch",
] as const;

const COMPUTER_MODIFIERS = ["command", "shift", "option", "control"] as const;

const ComputerToolSchema = Type.Object({
  action: stringEnum(COMPUTER_ACTIONS),
  gatewayUrl: Type.Optional(Type.String()),
  gatewayToken: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
  node: Type.Optional(Type.String()),
  mode: optionalStringEnum(COMPUTER_APPROVAL_MODES),
  x: Type.Optional(Type.Number()),
  y: Type.Optional(Type.Number()),
  toX: Type.Optional(Type.Number()),
  toY: Type.Optional(Type.Number()),
  deltaX: Type.Optional(Type.Number()),
  deltaY: Type.Optional(Type.Number()),
  text: Type.Optional(Type.String()),
  key: Type.Optional(Type.String()),
  modifiers: Type.Optional(Type.Array(stringEnum(COMPUTER_MODIFIERS))),
  url: Type.Optional(Type.String()),
  path: Type.Optional(Type.String()),
  app: Type.Optional(Type.String()),
  delayMs: Type.Optional(Type.Number()),
});

function parseApprovalMode(value: unknown): ComputerApprovalMode | undefined {
  if (value === "observe-only" || value === "control-approved-apps" || value === "elevated-watch") {
    return value;
  }
  return undefined;
}

function resolveActionFromParams(params: Record<string, unknown>): ComputerStructuredAction {
  const action = readStringParam(params, "action", { required: true });
  switch (action) {
    case "observe":
    case "session":
    case "pause":
    case "resume":
    case "stop":
      throw new Error(`action ${action} does not map to a native computer action`);
    case "click":
    case "double_click":
    case "right_click":
      return {
        type: action,
        x: readNumberParam(params, "x", { required: true, label: "x" }),
        y: readNumberParam(params, "y", { required: true, label: "y" }),
      };
    case "drag":
      return {
        type: "drag",
        x: readNumberParam(params, "x", { required: true, label: "x" }),
        y: readNumberParam(params, "y", { required: true, label: "y" }),
        toX: readNumberParam(params, "toX", { required: true, label: "toX" }),
        toY: readNumberParam(params, "toY", { required: true, label: "toY" }),
      };
    case "scroll":
      return {
        type: "scroll",
        deltaX: readNumberParam(params, "deltaX") ?? 0,
        deltaY: readNumberParam(params, "deltaY", { required: true, label: "deltaY" }),
      };
    case "type":
      return {
        type: "type",
        text: readStringParam(params, "text", { required: true, trim: false }),
      };
    case "keypress":
      return {
        type: "keypress",
        key: readStringParam(params, "key", { required: true }),
        modifiers: readStringArrayParam(
          params,
          "modifiers",
        ) as ComputerStructuredAction["modifiers"],
      };
    case "wait":
      return {
        type: "wait",
        delayMs: readNumberParam(params, "delayMs", {
          required: true,
          label: "delayMs",
        }),
      };
    case "open_url":
      return {
        type: "open_url",
        url: readStringParam(params, "url", { required: true }),
      };
    case "reveal_path":
      return {
        type: "reveal_path",
        path: readStringParam(params, "path", { required: true }),
      };
    case "open_path":
      return {
        type: "open_path",
        path: readStringParam(params, "path", { required: true }),
      };
    case "app_focus":
      return {
        type: "app_focus",
        app: readStringParam(params, "app", { required: true }),
      };
    default:
      throw new Error(`unknown computer action ${action}`);
  }
}

function makeToolUpdate(
  label: string,
  state: ComputerSessionState,
): AgentToolResult<{ computerSession: ComputerSessionState }> {
  return textResult(label, {
    computerSession: state,
  });
}

async function buildComputerToolResult(params: {
  label: string;
  state: ComputerSessionState;
  observation?: ComputerObservation | null;
  imageSanitization: ReturnType<typeof resolveImageSanitizationLimits>;
}): Promise<AgentToolResult<unknown>> {
  const observation = params.observation ?? null;
  const content: AgentToolResult<unknown>["content"] = [
    {
      type: "text",
      text: params.label,
    },
  ];
  if (observation?.frame?.dataUrl) {
    const match = observation.frame.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      content.push({
        type: "image",
        mimeType: match[1] ?? observation.frame.mimeType,
        data: match[2] ?? "",
      });
    }
  }
  return await sanitizeToolResultImages(
    {
      content,
      details: {
        computerSession: params.state,
      },
    },
    "computer",
    params.imageSanitization,
  );
}

export function createComputerTool(options?: {
  agentSessionKey?: string;
  config?: AlisioConfig;
}): AnyAgentTool {
  const imageSanitization = resolveImageSanitizationLimits(options?.config);
  return {
    label: "Computer",
    name: "computer",
    description:
      "Observe and control the local macOS computer through screenshots plus structured native actions. Use observe first, then act with coordinates from the latest frame.",
    parameters: ComputerToolSchema,
    execute: async (_toolCallId, args, signal, onUpdate) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const gatewayOpts = readGatewayCallOptions(params);
      const sessionKey = options?.agentSessionKey?.trim() || "main";
      const mode = parseApprovalMode(params.mode);
      const resolvedNode = await resolveNode(
        gatewayOpts,
        readStringParam(params, "node", { trim: true }),
        true,
      );
      if (resolvedNode.platform?.toLowerCase().startsWith("mac") !== true) {
        throw new Error("computer tool requires a macOS node");
      }

      const ensured = computerSessionManager.ensureSession({
        sessionKey,
        backend: "local-mac",
        nodeId: resolvedNode.nodeId,
        ...(mode ? { mode } : {}),
        permissions: {
          accessibility: resolvedNode.permissions?.accessibility === true,
          screenRecording: resolvedNode.permissions?.screenRecording === true,
        },
      });

      const emitUpdate = async (
        label: string,
        state: ComputerSessionState,
        callback = onUpdate,
      ): Promise<void> => {
        if (!callback) {
          return;
        }
        await Promise.resolve(callback(makeToolUpdate(label, state)));
      };

      const invoke = async (
        command: "computer.observe" | "computer.act",
        invokeParams?: Record<string, unknown>,
      ) =>
        await callGatewayTool<{ payload: unknown }>("node.invoke", gatewayOpts, {
          nodeId: resolvedNode.nodeId,
          command,
          params: invokeParams,
          idempotencyKey: crypto.randomUUID(),
        });

      const environment = new NodeMacComputerEnvironment(invoke);

      if (action === "session") {
        const state = mode ? computerSessionManager.setMode(sessionKey, mode) : ensured;
        return jsonResult({
          ok: true,
          computerSession: state,
        });
      }

      if (action === "pause") {
        const state = computerSessionManager.pause(sessionKey);
        return jsonResult({ ok: true, computerSession: state });
      }

      if (action === "resume") {
        const state = computerSessionManager.resume(sessionKey);
        return jsonResult({ ok: true, computerSession: state });
      }

      if (action === "stop") {
        const state = computerSessionManager.stop(sessionKey);
        return jsonResult({ ok: true, computerSession: state });
      }

      if (action === "observe") {
        const observing = computerSessionManager.setStatus(
          sessionKey,
          "observing",
          "capturing current frame",
        );
        await emitUpdate("Capturing current frame…", observing);
        const observation = await environment.observe(signal);
        const state = computerSessionManager.recordObservation(sessionKey, observation);
        return await buildComputerToolResult({
          label: `Observed ${observation.context.activeApp?.name ?? "desktop"} (${observation.frame.width}x${observation.frame.height})`,
          state,
          observation,
          imageSanitization,
        });
      }

      let latestObservation: ComputerObservation | null = null;
      const current = computerSessionManager.getSession(sessionKey);
      if (!current?.context || !current.frame) {
        latestObservation = await environment.observe(signal);
        const observed = computerSessionManager.recordObservation(
          sessionKey,
          latestObservation,
          "captured frame before action",
        );
        await emitUpdate("Captured frame before action.", observed);
      } else {
        latestObservation = {
          frame: current.frame,
          context: current.context,
        };
      }

      const nativeAction = resolveActionFromParams(params);
      const approvalCheck = computerSessionManager.shouldRequireApproval({
        sessionKey,
        action: nativeAction,
        context: latestObservation?.context ?? undefined,
        targetAppIdentity: nativeAction.app?.trim() || undefined,
      });
      if (approvalCheck.required) {
        if (
          approvalCheck.reason === "observe-only mode blocks control actions" ||
          approvalCheck.reason === "session stopped"
        ) {
          throw new Error(approvalCheck.reason);
        }
        const pendingPromise = computerSessionManager.requestApproval({
          sessionKey,
          action: nativeAction,
          reason: approvalCheck.reason ?? "explicit approval required",
          context: latestObservation?.context ?? undefined,
          appIdentity: approvalCheck.appIdentity,
        });
        const pendingState = computerSessionManager.getSession(sessionKey);
        if (pendingState) {
          await emitUpdate("Awaiting computer approval…", pendingState);
        }
        const decision = await pendingPromise;
        if (decision === "deny") {
          const denied = computerSessionManager.getSession(sessionKey);
          if (denied) {
            await emitUpdate("Computer action denied.", denied);
          }
          throw new Error("computer action denied");
        }
        const resumed = computerSessionManager.getSession(sessionKey);
        if (resumed) {
          await emitUpdate("Computer action approved.", resumed);
        }
      }

      const running = computerSessionManager.recordAction(sessionKey, nativeAction);
      await emitUpdate(`Running ${nativeAction.type}…`, running);
      let actionResult: ComputerActionResult;
      try {
        actionResult = await environment.act(nativeAction, signal);
      } catch (error) {
        const failed = computerSessionManager.recordError(
          sessionKey,
          error instanceof Error ? error.message : String(error),
        );
        await emitUpdate("Computer action failed.", failed);
        throw error;
      }
      const observation = actionResult.observation ?? (await environment.observe(signal));
      const observed = computerSessionManager.recordObservation(
        sessionKey,
        observation,
        `captured frame after ${nativeAction.type}`,
      );
      return await buildComputerToolResult({
        label: actionResult.summary,
        state: observed,
        observation,
        imageSanitization,
      });
    },
  };
}
