import { randomUUID } from "node:crypto";
import { hasApprovalTurnSourceRoute } from "../../infra/approval-turn-source.js";
import type { ExecApprovalForwarder } from "../../infra/exec-approval-forwarder.js";
import type { ExecApprovalDecision } from "../../infra/exec-approvals.js";
import type { PluginApprovalRequestPayload } from "../../infra/plugin-approvals.js";
import {
  DEFAULT_PLUGIN_APPROVAL_TIMEOUT_MS,
  MAX_PLUGIN_APPROVAL_TIMEOUT_MS,
} from "../../infra/plugin-approvals.js";
import type { ExecApprovalManager } from "../exec-approval-manager.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validatePluginApprovalRequestParams,
  validatePluginApprovalResolveParams,
} from "../protocol/index.js";
import {
  logPluginApprovalRequested,
  logPluginApprovalResolved,
  rememberPluginApprovalResolved,
} from "./approval-audit.js";
import {
  APPROVAL_NOT_FOUND_DETAILS,
  getPendingApprovalSnapshotOrRespond,
  parseApprovalDecision,
  parseApprovalId,
  resolvePendingApprovalIdOrRespond,
  waitForApprovalDecision,
} from "./approval.handlers.shared.js";
import type { GatewayRequestHandlers } from "./types.js";

export function createPluginApprovalHandlers(
  manager: ExecApprovalManager<PluginApprovalRequestPayload>,
  opts?: { forwarder?: ExecApprovalForwarder },
): GatewayRequestHandlers {
  return {
    "plugin.approval.request": async ({ params, client, respond, context }) => {
      if (!validatePluginApprovalRequestParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid plugin.approval.request params: ${formatValidationErrors(
              validatePluginApprovalRequestParams.errors,
            )}`,
          ),
        );
        return;
      }
      const p = params as {
        pluginId?: string | null;
        title: string;
        description: string;
        severity?: string | null;
        toolName?: string | null;
        toolCallId?: string | null;
        agentId?: string | null;
        sessionKey?: string | null;
        turnSourceChannel?: string | null;
        turnSourceTo?: string | null;
        turnSourceAccountId?: string | null;
        turnSourceThreadId?: string | number | null;
        timeoutMs?: number;
        twoPhase?: boolean;
      };
      const twoPhase = p.twoPhase === true;
      const timeoutMs = Math.min(
        typeof p.timeoutMs === "number" ? p.timeoutMs : DEFAULT_PLUGIN_APPROVAL_TIMEOUT_MS,
        MAX_PLUGIN_APPROVAL_TIMEOUT_MS,
      );

      const normalizeTrimmedString = (value?: string | null): string | null =>
        value?.trim() || null;

      const request: PluginApprovalRequestPayload = {
        pluginId: p.pluginId ?? null,
        title: p.title,
        description: p.description,
        severity: (p.severity as PluginApprovalRequestPayload["severity"]) ?? null,
        toolName: p.toolName ?? null,
        toolCallId: p.toolCallId ?? null,
        agentId: p.agentId ?? null,
        sessionKey: p.sessionKey ?? null,
        turnSourceChannel: normalizeTrimmedString(p.turnSourceChannel),
        turnSourceTo: normalizeTrimmedString(p.turnSourceTo),
        turnSourceAccountId: normalizeTrimmedString(p.turnSourceAccountId),
        turnSourceThreadId: p.turnSourceThreadId ?? null,
      };

      // Always server-generate the ID — never accept plugin-provided IDs.
      // Kind-prefix so /approve routing can distinguish plugin vs exec IDs deterministically.
      const record = manager.create(request, timeoutMs, `plugin:${randomUUID()}`);

      let decisionPromise: Promise<ExecApprovalDecision | null>;
      try {
        decisionPromise = manager.register(record, timeoutMs);
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `registration failed: ${String(err)}`),
        );
        return;
      }

      context.broadcast(
        "plugin.approval.requested",
        {
          id: record.id,
          request: record.request,
          createdAtMs: record.createdAtMs,
          expiresAtMs: record.expiresAtMs,
        },
        { dropIfSlow: true },
      );
      logPluginApprovalRequested(context.logGateway, {
        id: record.id,
        request: record.request,
      });

      let forwarded = false;
      if (opts?.forwarder?.handlePluginApprovalRequested) {
        try {
          forwarded = await opts.forwarder.handlePluginApprovalRequested({
            id: record.id,
            request: record.request,
            createdAtMs: record.createdAtMs,
            expiresAtMs: record.expiresAtMs,
          });
        } catch (err) {
          context.logGateway?.error?.(`plugin approvals: forward request failed: ${String(err)}`);
        }
      }

      const hasApprovalClients = context.hasExecApprovalClients?.(client?.connId) ?? false;
      const hasTurnSourceRoute = hasApprovalTurnSourceRoute({
        turnSourceChannel: record.request.turnSourceChannel,
        turnSourceAccountId: record.request.turnSourceAccountId,
      });
      if (!hasApprovalClients && !forwarded && !hasTurnSourceRoute) {
        manager.expire(record.id, "no-approval-route");
        respond(
          true,
          {
            id: record.id,
            decision: null,
            createdAtMs: record.createdAtMs,
            expiresAtMs: record.expiresAtMs,
          },
          undefined,
        );
        return;
      }

      if (twoPhase) {
        respond(
          true,
          {
            status: "accepted",
            id: record.id,
            createdAtMs: record.createdAtMs,
            expiresAtMs: record.expiresAtMs,
          },
          undefined,
        );
      }

      const decision = await decisionPromise;
      respond(
        true,
        {
          id: record.id,
          decision,
          createdAtMs: record.createdAtMs,
          expiresAtMs: record.expiresAtMs,
        },
        undefined,
      );
    },

    "plugin.approval.waitDecision": async ({ params, respond }) => {
      const id = parseApprovalId(params as { id?: string }, respond);
      if (!id) {
        return;
      }
      await waitForApprovalDecision(manager, id, respond);
    },

    "plugin.approval.resolve": async ({ params, respond, client, context }) => {
      if (!validatePluginApprovalResolveParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid plugin.approval.resolve params: ${formatValidationErrors(
              validatePluginApprovalResolveParams.errors,
            )}`,
          ),
        );
        return;
      }
      const p = params as { id: string; decision: string };
      const decision = parseApprovalDecision(p.decision, respond);
      if (!decision) {
        return;
      }
      const approvalId = resolvePendingApprovalIdOrRespond(manager, p.id, respond);
      if (!approvalId) {
        return;
      }
      const snapshot = getPendingApprovalSnapshotOrRespond(manager, approvalId, respond, {
        requireUnresolved: true,
      });
      if (!snapshot) {
        return;
      }
      const resolvedBy = client?.connect?.client?.displayName ?? client?.connect?.client?.id;
      const resolvedAtMs = Date.now();
      const ok = manager.resolve(approvalId, decision, resolvedBy ?? null);
      if (!ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "unknown or expired approval id", {
            details: APPROVAL_NOT_FOUND_DETAILS,
          }),
        );
        return;
      }
      context.broadcast(
        "plugin.approval.resolved",
        { id: approvalId, decision, resolvedBy, ts: resolvedAtMs, request: snapshot?.request },
        { dropIfSlow: true },
      );
      rememberPluginApprovalResolved({
        id: approvalId,
        request: snapshot?.request,
        decision,
        resolvedBy,
        ts: resolvedAtMs,
      });
      logPluginApprovalResolved(context.logGateway, {
        id: approvalId,
        request: snapshot?.request,
        decision,
        resolvedBy,
      });
      void opts?.forwarder
        ?.handlePluginApprovalResolved?.({
          id: approvalId,
          decision,
          resolvedBy,
          ts: resolvedAtMs,
          request: snapshot?.request,
        })
        .catch((err) => {
          context.logGateway?.error?.(`plugin approvals: forward resolve failed: ${String(err)}`);
        });
      respond(true, { ok: true }, undefined);
    },
  };
}
