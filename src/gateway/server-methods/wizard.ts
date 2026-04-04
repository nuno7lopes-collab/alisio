import { randomUUID } from "node:crypto";
import { defaultRuntime } from "../../runtime.js";
import { WizardSession } from "../../wizard/session.js";
import {
  ErrorCodes,
  errorShape,
  validateWizardCancelParams,
  validateWizardNextParams,
  validateWizardStartParams,
  validateWizardStatusParams,
} from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";
import type { GatewayRequestContext, GatewayRequestHandlers, RespondFn } from "./types.js";
import { assertValidParams } from "./validation.js";

function readWizardStatus(session: WizardSession) {
  return {
    status: session.getStatus(),
    error: session.getError(),
  };
}

function findWizardSessionOrRespond(params: {
  context: GatewayRequestContext;
  respond: RespondFn;
  sessionId: string;
}): { session: WizardSession; surface: "onboarding" | "channel" } | null {
  const session =
    params.context.wizardSessions.get(params.sessionId) ??
    params.context.channelWizardSessions.get(params.sessionId);
  if (!session) {
    params.respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "wizard not found"));
    return null;
  }
  return {
    session,
    surface: params.context.wizardSessions.has(params.sessionId) ? "onboarding" : "channel",
  };
}

function hasRunningWizard(context: GatewayRequestContext) {
  for (const [, session] of context.wizardSessions) {
    if (session.getStatus() === "running") {
      return true;
    }
  }
  for (const [, session] of context.channelWizardSessions) {
    if (session.getStatus() === "running") {
      return true;
    }
  }
  return false;
}

function cancelWizardSession(
  context: GatewayRequestContext,
  sessionId: string,
  surface: "onboarding" | "channel",
) {
  const session =
    surface === "channel"
      ? context.channelWizardSessions.get(sessionId)
      : context.wizardSessions.get(sessionId);
  if (!session) {
    return;
  }
  session.cancel();
  if (surface === "channel") {
    context.purgeChannelWizardSession(sessionId);
    return;
  }
  context.purgeWizardSession(sessionId);
}

async function resumeRunningChannelWizard(
  context: GatewayRequestContext,
  channelId: string,
): Promise<{ sessionId: string; result: Awaited<ReturnType<WizardSession["next"]>> } | null> {
  const running = context.getRunningChannelWizard();
  if (!running) {
    return null;
  }
  if (running.channelId !== channelId) {
    cancelWizardSession(context, running.sessionId, "channel");
    return null;
  }
  const session = context.channelWizardSessions.get(running.sessionId);
  if (!session) {
    context.purgeChannelWizardSession(running.sessionId);
    return null;
  }
  const result = await session.next();
  if (result.done) {
    context.purgeChannelWizardSession(running.sessionId);
    return null;
  }
  return {
    sessionId: running.sessionId,
    result,
  };
}

export const wizardHandlers: GatewayRequestHandlers = {
  "wizard.start": async ({ params, respond, context }) => {
    if (!assertValidParams(params, validateWizardStartParams, "wizard.start", respond)) {
      return;
    }
    const surface = params.surface === "channel" ? "channel" : "onboarding";
    if (surface === "channel") {
      const channel = typeof params.channel === "string" ? params.channel.trim() : "";
      if (!channel) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "wizard.start channel is required"),
        );
        return;
      }
      const resumed = await resumeRunningChannelWizard(context, channel);
      if (resumed) {
        respond(true, { sessionId: resumed.sessionId, ...resumed.result }, undefined);
        return;
      }
      const runningOnboardingSessionId = context.findRunningWizard();
      if (runningOnboardingSessionId) {
        cancelWizardSession(context, runningOnboardingSessionId, "onboarding");
      }
      const sessionId = randomUUID();
      const session = new WizardSession((prompter) =>
        context.channelWizardRunner({ channel }, defaultRuntime, prompter),
      );
      context.channelWizardSessions.set(sessionId, session);
      context.rememberChannelWizardSession(sessionId, { channelId: channel });
      const result = await session.next();
      if (result.done) {
        context.purgeChannelWizardSession(sessionId);
      }
      respond(true, { sessionId, ...result }, undefined);
      return;
    }
    if (hasRunningWizard(context)) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "wizard already running"));
      return;
    }
    const sessionId = randomUUID();
    const opts = {
      mode: params.mode,
      workspace: typeof params.workspace === "string" ? params.workspace : undefined,
    };
    const session = new WizardSession((prompter) =>
      context.wizardRunner(opts, defaultRuntime, prompter),
    );
    context.wizardSessions.set(sessionId, session);
    const result = await session.next();
    if (result.done) {
      context.purgeWizardSession(sessionId);
    }
    respond(true, { sessionId, ...result }, undefined);
  },
  "wizard.next": async ({ params, respond, context }) => {
    if (!assertValidParams(params, validateWizardNextParams, "wizard.next", respond)) {
      return;
    }
    const sessionId = params.sessionId;
    const resolved = findWizardSessionOrRespond({ context, respond, sessionId });
    if (!resolved) {
      return;
    }
    const { session, surface } = resolved;
    const answer = params.answer as { stepId?: string; value?: unknown } | undefined;
    if (answer) {
      if (session.getStatus() !== "running") {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "wizard not running"));
        return;
      }
      try {
        await session.answer(String(answer.stepId ?? ""), answer.value);
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, formatForLog(err)));
        return;
      }
    }
    const result = await session.next();
    if (result.done) {
      if (surface === "channel") {
        context.purgeChannelWizardSession(sessionId);
      } else {
        context.purgeWizardSession(sessionId);
      }
    }
    respond(true, result, undefined);
  },
  "wizard.cancel": ({ params, respond, context }) => {
    if (!assertValidParams(params, validateWizardCancelParams, "wizard.cancel", respond)) {
      return;
    }
    const sessionId = params.sessionId;
    const resolved = findWizardSessionOrRespond({ context, respond, sessionId });
    if (!resolved) {
      return;
    }
    const { session, surface } = resolved;
    session.cancel();
    const status = readWizardStatus(session);
    if (surface === "channel") {
      context.purgeChannelWizardSession(sessionId);
    } else {
      context.purgeWizardSession(sessionId);
    }
    respond(true, status, undefined);
  },
  "wizard.status": ({ params, respond, context }) => {
    if (!assertValidParams(params, validateWizardStatusParams, "wizard.status", respond)) {
      return;
    }
    const sessionId = params.sessionId;
    const resolved = findWizardSessionOrRespond({ context, respond, sessionId });
    if (!resolved) {
      return;
    }
    const { session, surface } = resolved;
    const status = readWizardStatus(session);
    if (status.status !== "running") {
      if (surface === "channel") {
        context.purgeChannelWizardSession(sessionId);
      } else {
        context.purgeWizardSession(sessionId);
      }
    }
    respond(true, status, undefined);
  },
};
