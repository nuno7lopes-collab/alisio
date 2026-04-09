import { readConfigFileSnapshot, resolveConfigSnapshotHash } from "../../config/config.js";
import { ensureExecApprovals, readExecApprovalsSnapshot } from "../../infra/exec-approvals.js";
import {
  applySecurityAccessModeToExecApprovalsFile,
  buildSecurityAccessModeConfigPatch,
  matchesSecurityAccessModeTargets,
  resolveSecurityAccessDiagnostics,
  type SecurityAccessProfile,
} from "../../shared/security-policy.js";
import {
  ErrorCodes,
  errorShape,
  type AlisioSecurityPolicyApplyProfileResult,
  type AlisioSecurityPolicySnapshot,
  validateAlisioSecurityPolicyApplyProfileParams,
  validateAlisioSecurityPolicyGetParams,
} from "../protocol/index.js";
import { listApprovalAuditTrail, listPendingApprovalSnapshot } from "./approval-audit.js";
import { configHandlers } from "./config.js";
import { execApprovalsHandlers } from "./exec-approvals.js";
import type {
  GatewayRequestHandler,
  GatewayRequestHandlerOptions,
  GatewayRequestHandlers,
} from "./types.js";
import { assertValidParams } from "./validation.js";

type NestedHandlerResult = {
  ok: boolean;
  payload?: unknown;
  error?: ReturnType<typeof errorShape>;
  meta?: Record<string, unknown>;
};

async function invokeNestedHandler(
  handler: GatewayRequestHandler,
  opts: GatewayRequestHandlerOptions,
): Promise<NestedHandlerResult> {
  let result: NestedHandlerResult | null = null;
  await handler({
    ...opts,
    respond: (ok, payload, error, meta) => {
      result = { ok, payload, error, meta };
    },
  });
  return (
    result ??
    ({
      ok: false,
      error: errorShape(
        ErrorCodes.UNAVAILABLE,
        `nested handler did not respond: ${opts.req.method}`,
      ),
    } satisfies NestedHandlerResult)
  );
}

export async function buildAlisioSecurityPolicySnapshot(
  context: GatewayRequestHandlerOptions["context"],
): Promise<AlisioSecurityPolicySnapshot> {
  const configSnapshot = await readConfigFileSnapshot();
  ensureExecApprovals();
  const approvalsSnapshot = readExecApprovalsSnapshot();
  return {
    target: "gateway",
    diagnostics: resolveSecurityAccessDiagnostics({
      configForm: (configSnapshot.config as Record<string, unknown> | null) ?? null,
      execApprovalsForm: approvalsSnapshot.file ?? null,
    }),
    configSource: {
      path: configSnapshot.path ?? null,
      exists: configSnapshot.exists,
      hash: resolveConfigSnapshotHash(configSnapshot) ?? null,
    },
    approvalsSource: {
      path: approvalsSnapshot.path,
      exists: approvalsSnapshot.exists,
      hash: approvalsSnapshot.hash,
    },
    pending: listPendingApprovalSnapshot(context),
    audit: { items: listApprovalAuditTrail() },
  };
}

export const alisioSecurityPolicyHandlers: GatewayRequestHandlers = {
  "alisio.security.policy.get": async ({ params, respond, context }) => {
    if (
      !assertValidParams(
        params,
        validateAlisioSecurityPolicyGetParams,
        "alisio.security.policy.get",
        respond,
      )
    ) {
      return;
    }
    respond(true, await buildAlisioSecurityPolicySnapshot(context), undefined);
  },
  "alisio.security.policy.applyProfile": async ({
    params,
    req,
    client,
    isWebchatConnect,
    respond,
    context,
  }) => {
    if (
      !assertValidParams(
        params,
        validateAlisioSecurityPolicyApplyProfileParams,
        "alisio.security.policy.applyProfile",
        respond,
      )
    ) {
      return;
    }

    const profile = (params as { profile: SecurityAccessProfile }).profile;
    const configSnapshot = await readConfigFileSnapshot();
    ensureExecApprovals();
    const approvalsSnapshot = readExecApprovalsSnapshot();
    const configHash = resolveConfigSnapshotHash(configSnapshot) ?? undefined;
    if (
      matchesSecurityAccessModeTargets({
        config: (configSnapshot.config as Record<string, unknown> | null) ?? null,
        execApprovals: approvalsSnapshot.file ?? null,
        mode: profile,
      })
    ) {
      const snapshot = await buildAlisioSecurityPolicySnapshot(context);
      const result: AlisioSecurityPolicyApplyProfileResult = { changed: false, snapshot };
      respond(true, result, undefined);
      return;
    }

    const nextApprovalsFile = applySecurityAccessModeToExecApprovalsFile(
      approvalsSnapshot.file ?? null,
      profile,
    );
    const approvalsResult = await invokeNestedHandler(execApprovalsHandlers["exec.approvals.set"], {
      req: { ...req, method: "exec.approvals.set" },
      params: {
        file: nextApprovalsFile,
        baseHash: approvalsSnapshot.hash,
      },
      client,
      isWebchatConnect,
      respond,
      context,
    });
    if (!approvalsResult.ok) {
      respond(false, undefined, approvalsResult.error, approvalsResult.meta);
      return;
    }

    const configResult = await invokeNestedHandler(configHandlers["config.patch"], {
      req: { ...req, method: "config.patch" },
      params: {
        raw: JSON.stringify(
          buildSecurityAccessModeConfigPatch(
            (configSnapshot.config as Record<string, unknown> | null) ?? null,
            profile,
          ),
        ),
        baseHash: configHash,
      },
      client,
      isWebchatConnect,
      respond,
      context,
    });
    if (!configResult.ok) {
      respond(false, undefined, configResult.error, configResult.meta);
      return;
    }

    const snapshot = await buildAlisioSecurityPolicySnapshot(context);
    const result: AlisioSecurityPolicyApplyProfileResult = { changed: true, snapshot };
    respond(true, result, undefined);
  },
};
