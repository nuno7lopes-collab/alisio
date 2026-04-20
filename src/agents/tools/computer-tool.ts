import crypto from "node:crypto";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { NodeMacComputerEnvironment } from "../../computer/node-mac-environment.js";
import { normalizeComputerApprovalMode } from "../../computer/policy-engine.js";
import { actionRequiresForegroundControl } from "../../computer/runtime-profile.js";
import {
  ComputerSessionArbitrationError,
  computerSessionArbiter,
} from "../../computer/session-arbiter.js";
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
  "screenshot",
  "move",
  "click",
  "double_click",
  "right_click",
  "drag",
  "scroll",
  "type",
  "keypress",
  "wait",
  "focus_app",
  "open_url",
  "reveal_path",
  "open_path",
  "open_app",
  "session",
  "pause",
  "resume",
  "stop",
] as const;

const COMPUTER_APPROVAL_MODES = [
  "observe_only",
  "approved_apps_only",
  "foreground_supervised",
  "elevated_watch_mode",
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
  return normalizeComputerApprovalMode(value) ?? undefined;
}

function resolveActionFromParams(params: Record<string, unknown>): ComputerStructuredAction {
  const action = readStringParam(params, "action", { required: true });
  switch (action) {
    case "observe":
    case "screenshot":
    case "session":
    case "pause":
    case "resume":
    case "stop":
      throw new Error(`action ${action} does not map to a native computer action`);
    case "move":
      return {
        type: "move",
        x: readNumberParam(params, "x", { required: true, label: "x" }),
        y: readNumberParam(params, "y", { required: true, label: "y" }),
      };
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
    case "focus_app":
      return {
        type: "focus_app",
        app: readStringParam(params, "app", { required: true }),
      };
    case "open_app":
      return {
        type: "open_app",
        app: readStringParam(params, "app", { required: true }),
      };
    default:
      throw new Error(`unknown computer action ${action}`);
  }
}

function withSourceFrameContext(
  action: ComputerStructuredAction,
  observation: ComputerObservation,
): ComputerStructuredAction {
  const frame = observation.frame;
  return {
    ...action,
    id: action.id ?? crypto.randomUUID(),
    coordinateSpace: action.coordinateSpace ?? "display-pixel",
    frame: {
      frameId: frame.id,
      displayId: observation.context.display.id,
      capturedAt: frame.capturedAt,
      maxAgeMs: frame.maxAgeMs,
      sourceSpace: frame.sourceSpace,
      pixelWidth: frame.pixelWidth,
      pixelHeight: frame.pixelHeight,
      logicalWidth: frame.logicalWidth,
      logicalHeight: frame.logicalHeight,
      scaleFactor: frame.scaleFactor,
      orientation: frame.orientation,
    },
    transform:
      action.transform ??
      ({
        sourceSpace: frame.sourceSpace,
        sourceWidth: frame.pixelWidth,
        sourceHeight: frame.pixelHeight,
      } satisfies NonNullable<ComputerStructuredAction["transform"]>),
  };
}

function makeToolUpdate(
  label: string,
  state: ComputerSessionState,
): AgentToolResult<{ computerSession: ComputerSessionState }> {
  return textResult(label, {
    computerSession: state,
  });
}

function buildArbitrationBlockingState(
  session: ComputerSessionState,
  error: ComputerSessionArbitrationError,
) {
  return {
    kind:
      error.details.reasonCode === "focus_required"
        ? ("blocked_on_focus" as const)
        : ("blocked_on_runtime" as const),
    reasonCode: error.details.reasonCode,
    summary: error.details.summary,
    at: Date.now(),
    targetId: error.details.targetId || session.target.id,
    ...(error.details.ownerSessionKey ? { ownerSessionKey: error.details.ownerSessionKey } : {}),
    ...(error.details.foregroundControlRequired !== undefined
      ? { foregroundControlRequired: error.details.foregroundControlRequired }
      : {}),
    ...(error.details.actionType ? { actionType: error.details.actionType } : {}),
  };
}

function buildOperationBlockingState(params: {
  session: ComputerSessionState;
  operation: "observe" | "control";
  actionType?: ComputerStructuredAction["type"];
}) {
  const capability =
    params.operation === "observe"
      ? params.session.capabilities.find((entry) => entry.kind === "observe_only")
      : params.session.capabilities.find((entry) => entry.kind === "foreground_control");
  if (!capability || !capability.available || capability.exposure !== "exposed") {
    return {
      kind: "blocked_on_runtime" as const,
      reasonCode: "runtime_unavailable" as const,
      summary: capability?.reason ?? "computer runtime unavailable",
      at: Date.now(),
      targetId: params.session.target.id,
      ...(params.actionType ? { actionType: params.actionType } : {}),
    };
  }

  const permissionState =
    params.operation === "observe"
      ? params.session.permissions.observation
      : params.session.permissions.control;
  if (permissionState === "missing") {
    return {
      kind: "blocked_on_permissions" as const,
      reasonCode:
        params.operation === "observe"
          ? ("observation_permission_missing" as const)
          : ("control_permission_missing" as const),
      summary:
        params.operation === "observe"
          ? "Screen recording permission is missing for computer observation."
          : "Accessibility permission is missing for computer control.",
      at: Date.now(),
      targetId: params.session.target.id,
      ...(params.actionType ? { actionType: params.actionType } : {}),
      openTrigger: "open_permissions" as const,
    };
  }
  if (permissionState === "restart_required") {
    return {
      kind: "blocked_on_restart_required" as const,
      reasonCode:
        params.operation === "observe"
          ? ("observation_restart_required" as const)
          : ("control_restart_required" as const),
      summary:
        params.operation === "observe"
          ? "Screen recording permission was granted but the runtime still needs a restart."
          : "Accessibility permission was granted but the runtime still needs a restart.",
      at: Date.now(),
      targetId: params.session.target.id,
      ...(params.actionType ? { actionType: params.actionType } : {}),
      openTrigger: "open_restart_required" as const,
    };
  }

  return null;
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
      "Observe and control the local macOS computer through screenshots plus structured native actions such as open_url, open_app, focus_app, and direct input. Use observe first, then act with coordinates from the latest frame.",
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
      const normalizedPlatform = resolvedNode.platform?.toLowerCase() ?? "";
      if (normalizedPlatform.startsWith("win")) {
        computerSessionManager.ensureSession({
          sessionKey,
          backend: "windows-local",
          nodeId: resolvedNode.nodeId,
        });
        throw new Error("computer runtime is unavailable on windows-local");
      }
      if (!normalizedPlatform.startsWith("mac")) {
        throw new Error("computer tool requires a macOS node");
      }

      const ensured = computerSessionManager.ensureSession({
        sessionKey,
        backend: "local-mac",
        nodeId: resolvedNode.nodeId,
        ...(mode ? { mode } : {}),
        permissions: {
          ...(typeof resolvedNode.permissions?.accessibility === "boolean"
            ? { accessibility: resolvedNode.permissions.accessibility }
            : {}),
          ...(typeof resolvedNode.permissions?.screenRecording === "boolean"
            ? { screenRecording: resolvedNode.permissions.screenRecording }
            : {}),
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
          params: {
            sessionId: sessionKey,
            ...invokeParams,
          },
          idempotencyKey: crypto.randomUUID(),
        });

      const updateSession = async (
        command?: "start" | "pause" | "resume" | "stop",
      ): Promise<ComputerSessionState> => {
        const response = await callGatewayTool<{ session?: ComputerSessionState }>(
          "computer.session.update",
          gatewayOpts,
          {
            sessionKey,
            nodeId: resolvedNode.nodeId,
            ...(command ? { command } : {}),
            ...(mode ? { mode } : {}),
          },
        );
        return response.session ?? computerSessionManager.getSession(sessionKey) ?? ensured;
      };

      const environment = new NodeMacComputerEnvironment(invoke);
      const sessionTargetId = ensured.target.id;

      if (action === "session") {
        const state = await updateSession("start");
        return jsonResult({
          ok: true,
          computerSession: state,
        });
      }

      if (action === "pause") {
        const state = await updateSession("pause");
        return jsonResult({ ok: true, computerSession: state });
      }

      if (action === "resume") {
        const state = await updateSession("resume");
        return jsonResult({ ok: true, computerSession: state });
      }

      if (action === "stop") {
        const state = await updateSession("stop");
        return jsonResult({ ok: true, computerSession: state });
      }

      if (action === "observe" || action === "screenshot") {
        const observeBlocked = buildOperationBlockingState({
          session: computerSessionManager.getSession(sessionKey) ?? ensured,
          operation: "observe",
        });
        if (observeBlocked) {
          const blocked = computerSessionManager.setBlocking(sessionKey, observeBlocked);
          await emitUpdate(observeBlocked.summary, blocked);
          throw new Error(observeBlocked.summary);
        }
        try {
          return await computerSessionArbiter.withObserveLane({
            sessionKey,
            targetId: sessionTargetId,
            signal,
            onQueued: (queuePosition) => {
              const blocked = computerSessionManager.setBlocking(sessionKey, {
                kind: "blocked_on_runtime",
                reasonCode: "runtime_busy",
                summary: `waiting for shared capture budget on ${ensured.target.label}`,
                at: Date.now(),
                targetId: sessionTargetId,
              });
              void emitUpdate(`Waiting for shared capture budget (${queuePosition})…`, blocked);
            },
            onStarted: () => {
              const state = computerSessionManager.markSessionArbitrated({
                sessionKey,
                summary: "shared capture lane acquired",
              });
              void emitUpdate("Shared capture lane acquired.", state);
            },
            operation: async (laneSignal) => {
              computerSessionManager.startStep({
                sessionKey,
                toolCallId: _toolCallId,
                kind: "observe",
                phase: "observe",
                summary: action === "screenshot" ? "capture screenshot" : "capture current frame",
              });
              const observing = computerSessionManager.setStatus(
                sessionKey,
                "observing",
                action === "screenshot" ? "capturing screenshot" : "capturing current frame",
              );
              await emitUpdate(
                action === "screenshot" ? "Capturing screenshot…" : "Capturing current frame…",
                observing,
              );
              const observation = await environment.observe(laneSignal);
              computerSessionManager.recordObservation(
                sessionKey,
                observation,
                action === "screenshot" ? "captured screenshot" : "captured current frame",
                {
                  phase: "observe",
                  stepSummary:
                    action === "screenshot" ? "captured screenshot" : "captured current frame",
                },
              );
              const state = computerSessionManager.completeStep(
                sessionKey,
                action === "screenshot" ? "captured screenshot" : "observe current frame",
                "observe",
              );
              return await buildComputerToolResult({
                label: `Observed ${observation.context.activeApp?.name ?? "desktop"} (${observation.frame.width}x${observation.frame.height})`,
                state,
                observation,
                imageSanitization,
              });
            },
          });
        } catch (error) {
          if (error instanceof ComputerSessionArbitrationError) {
            const blocked = computerSessionManager.setBlocking(
              sessionKey,
              buildArbitrationBlockingState(ensured, error),
            );
            await emitUpdate("Computer observe blocked by runtime arbitration.", blocked);
            throw error;
          }
          const failed = computerSessionManager.recordError(
            sessionKey,
            error instanceof Error ? error.message : String(error),
          );
          await emitUpdate("Computer observe failed.", failed);
          throw error;
        }
      }

      const nativeAction = resolveActionFromParams(params);
      const currentSession = computerSessionManager.getSession(sessionKey);
      if (currentSession?.status === "stopped") {
        throw new Error("session stopped");
      }
      if (currentSession?.status === "paused") {
        throw new Error("session paused");
      }
      if (currentSession?.status === "blocked_on_approval" || currentSession?.awaitingApproval) {
        throw new Error("computer session is awaiting approval");
      }
      const actionBlocked = buildOperationBlockingState({
        session: currentSession ?? ensured,
        operation: "control",
        actionType: nativeAction.type,
      });
      if (actionBlocked) {
        const blocked = computerSessionManager.setBlocking(sessionKey, actionBlocked);
        await emitUpdate(actionBlocked.summary, blocked);
        throw new Error(actionBlocked.summary);
      }
      try {
        const foregroundRequired = actionRequiresForegroundControl(nativeAction.type);
        return await computerSessionArbiter.withControlLane({
          sessionKey,
          targetId: sessionTargetId,
          actionType: nativeAction.type,
          foregroundRequired,
          signal,
          operation: async (laneSignal) => {
            const arbitrated = computerSessionManager.markSessionArbitrated({
              sessionKey,
              summary: foregroundRequired
                ? "foreground control required on local macOS"
                : "control lane acquired",
              eventCode: foregroundRequired ? "focus_required" : "session_arbitrated",
            });
            await emitUpdate(
              foregroundRequired
                ? "Foreground control required on local macOS."
                : "Computer control lane acquired.",
              arbitrated,
            );
            computerSessionManager.startStep({
              sessionKey,
              toolCallId: _toolCallId,
              kind: "action",
              phase: "observe-before-action",
              summary: `prepare ${nativeAction.type}`,
              actionType: nativeAction.type,
            });
            const observingBeforeAction = computerSessionManager.setStatus(
              sessionKey,
              "observing",
              `capturing current frame before ${nativeAction.type}`,
            );
            await emitUpdate("Capturing fresh frame before action…", observingBeforeAction);
            let latestObservation: ComputerObservation;
            try {
              latestObservation = await environment.observe(laneSignal);
            } catch (error) {
              const failed = computerSessionManager.recordError(
                sessionKey,
                error instanceof Error ? error.message : String(error),
              );
              await emitUpdate("Computer pre-action observe failed.", failed);
              throw error;
            }
            const observedBeforeAction = computerSessionManager.recordObservation(
              sessionKey,
              latestObservation,
              `captured fresh frame before ${nativeAction.type}`,
              {
                phase: "observe-before-action",
                stepSummary: `captured fresh frame before ${nativeAction.type}`,
              },
            );
            await emitUpdate("Captured fresh frame before action.", observedBeforeAction);
            const actionWithContext = withSourceFrameContext(nativeAction, latestObservation);
            computerSessionManager.recordActionRequested(sessionKey, actionWithContext);
            const { evaluation, session: policyState } =
              computerSessionManager.evaluateActionPolicy({
                sessionKey,
                action: actionWithContext,
                context: latestObservation.context,
                targetAppIdentity: actionWithContext.app?.trim() || undefined,
              });
            if (evaluation.safetyEvents.length > 0 || evaluation.escalatedMode) {
              await emitUpdate("Safety policy updated for the current surface.", policyState);
            }
            if (evaluation.decision === "deny") {
              const denied = computerSessionManager.recordPolicyDenied(sessionKey, {
                action: actionWithContext,
                reason: evaluation.reason,
                reasonCode: evaluation.reasonCode,
                appIdentity: evaluation.appIdentity,
              });
              await emitUpdate("Computer action blocked by local policy.", denied);
              throw new Error(evaluation.reason);
            }
            if (
              evaluation.decision === "require_once" ||
              evaluation.decision === "require_session"
            ) {
              const pendingPromise = computerSessionManager.requestApproval({
                sessionKey,
                action: actionWithContext,
                reason: evaluation.reason,
                reasonCode: evaluation.reasonCode,
                policyDecision: evaluation.decision,
                safetyEvents: evaluation.safetyEvents,
                context: latestObservation.context,
                appIdentity: evaluation.appIdentity,
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

            const running = computerSessionManager.recordAction(
              sessionKey,
              actionWithContext,
              undefined,
              {
                actionId: actionWithContext.id,
                sourceFrameId: actionWithContext.frame?.frameId,
              },
            );
            await emitUpdate(`Running ${nativeAction.type}…`, running);
            let actionResult: ComputerActionResult;
            try {
              actionResult = await environment.act(actionWithContext, laneSignal);
            } catch (error) {
              const failed = computerSessionManager.recordError(
                sessionKey,
                error instanceof Error ? error.message : String(error),
              );
              await emitUpdate("Computer action failed.", failed);
              throw error;
            }
            for (const result of actionResult.results) {
              computerSessionManager.recordActionResult(sessionKey, result);
            }
            if (!actionResult.ok) {
              const failureSummary =
                actionResult.results.find((result) => !result.success)?.summary ??
                actionResult.summary;
              const failed = computerSessionManager.recordError(sessionKey, failureSummary);
              await emitUpdate("Computer action failed.", failed);
              throw new Error(failureSummary);
            }
            let observation: ComputerObservation;
            try {
              observation = actionResult.observation ?? (await environment.observe(laneSignal));
            } catch (error) {
              const failed = computerSessionManager.recordError(
                sessionKey,
                error instanceof Error ? error.message : String(error),
              );
              await emitUpdate("Computer post-action observe failed.", failed);
              throw error;
            }
            computerSessionManager.recordObservation(
              sessionKey,
              observation,
              `captured frame after ${nativeAction.type}`,
              {
                phase: "observe-after-action",
                stepSummary: `captured frame after ${nativeAction.type}`,
              },
            );
            const completed = computerSessionManager.completeStep(
              sessionKey,
              actionResult.summary,
              "observe-after-action",
            );
            return await buildComputerToolResult({
              label: actionResult.summary,
              state: completed,
              observation,
              imageSanitization,
            });
          },
        });
      } catch (error) {
        if (error instanceof ComputerSessionArbitrationError) {
          const blocked = computerSessionManager.setBlocking(
            sessionKey,
            buildArbitrationBlockingState(currentSession ?? ensured, error),
          );
          await emitUpdate("Computer action blocked by runtime arbitration.", blocked);
          throw error;
        }
        throw error;
      }
    },
  };
}
