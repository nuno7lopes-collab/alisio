import { createSubsystemLogger } from "../logging/subsystem.js";
import type { ComputerActionType, ComputerSessionBlockReasonCode } from "./types.js";

type OperationKind = "observe" | "control";

type ActiveOperation = {
  kind: OperationKind;
  targetId: string;
};

type ObserveQueueJob = {
  sessionKey: string;
  targetId: string;
  signal: AbortSignal;
  onQueued?: (position: number) => void;
  onStarted?: () => void;
  onReleased?: () => void;
  start: () => Promise<void>;
  reject: (error: unknown) => void;
  abortListener: () => void;
};

type ControlOwner = {
  sessionKey: string;
  targetId: string;
  actionType: ComputerActionType;
  foregroundRequired: boolean;
  acquiredAt: number;
};

export type ComputerArbitrationFailure = {
  reasonCode: ComputerSessionBlockReasonCode;
  summary: string;
  targetId: string;
  ownerSessionKey?: string;
  foregroundControlRequired?: boolean;
  actionType?: ComputerActionType;
};

function toAbortError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  return new Error(typeof reason === "string" && reason.trim() ? reason : "operation aborted");
}

function combineAbortSignals(signals: Array<AbortSignal | undefined>): AbortSignal {
  const available = signals.filter((entry): entry is AbortSignal => Boolean(entry));
  if (available.length === 0) {
    return new AbortController().signal;
  }
  if (available.length === 1) {
    return available[0];
  }
  return AbortSignal.any(available);
}

export class ComputerSessionArbitrationError extends Error {
  readonly details: ComputerArbitrationFailure;

  constructor(details: ComputerArbitrationFailure) {
    super(details.summary);
    this.name = "ComputerSessionArbitrationError";
    this.details = details;
  }
}

export class ComputerSessionArbiter {
  private readonly logger = createSubsystemLogger("computer/concurrency");
  private readonly activeOperations = new Map<string, ActiveOperation>();
  private readonly sessionControllers = new Map<string, AbortController>();
  private readonly observeQueues = new Map<string, ObserveQueueJob[]>();
  private readonly activeObserveTargets = new Set<string>();
  private readonly controlOwners = new Map<string, ControlOwner>();

  abortSession(sessionKey: string, reason: string): void {
    const normalizedSessionKey = sessionKey.trim() || "main";
    const controller = this.sessionControllers.get(normalizedSessionKey);
    if (!controller || controller.signal.aborted) {
      return;
    }
    controller.abort(new Error(reason));
    this.logger.info("computer session abort requested", {
      sessionKey: normalizedSessionKey,
      reason,
    });
  }

  async withObserveLane<T>(params: {
    sessionKey: string;
    targetId: string;
    signal?: AbortSignal;
    onQueued?: (position: number) => void;
    onStarted?: () => void;
    onReleased?: () => void;
    operation: (signal: AbortSignal) => Promise<T>;
  }): Promise<T> {
    const sessionKey = params.sessionKey.trim() || "main";
    const targetId = params.targetId.trim();
    this.ensureSessionIsIdle(sessionKey, targetId, "observe");
    const sessionController = this.ensureSessionController(sessionKey);
    const combinedSignal = combineAbortSignals([params.signal, sessionController.signal]);

    return await new Promise<T>((resolve, reject) => {
      let finished = false;
      const job: ObserveQueueJob = {
        sessionKey,
        targetId,
        signal: combinedSignal,
        onQueued: params.onQueued,
        onStarted: params.onStarted,
        onReleased: params.onReleased,
        reject: (error) => {
          if (finished) {
            return;
          }
          finished = true;
          combinedSignal.removeEventListener("abort", job.abortListener);
          reject(error);
        },
        abortListener: () => {
          this.removeObserveJob(job);
          job.reject(toAbortError(combinedSignal.reason));
        },
        start: async () => {
          if (finished) {
            return;
          }
          this.activeObserveTargets.add(targetId);
          this.activeOperations.set(sessionKey, {
            kind: "observe",
            targetId,
          });
          params.onStarted?.();
          this.logger.info("computer observe lane acquired", {
            sessionKey,
            targetId,
          });
          try {
            const result = await params.operation(combinedSignal);
            if (!finished) {
              finished = true;
              combinedSignal.removeEventListener("abort", job.abortListener);
              resolve(result);
            }
          } catch (error) {
            if (!finished) {
              finished = true;
              combinedSignal.removeEventListener("abort", job.abortListener);
              reject(error);
            }
          } finally {
            this.activeOperations.delete(sessionKey);
            this.activeObserveTargets.delete(targetId);
            params.onReleased?.();
            this.pumpObserveQueue(targetId);
          }
        },
      };

      combinedSignal.addEventListener("abort", job.abortListener, { once: true });
      const queue = this.observeQueues.get(targetId) ?? [];
      queue.push(job);
      this.observeQueues.set(targetId, queue);
      if (queue.length > 1 || this.controlOwners.has(targetId) || this.activeObserveTargets.has(targetId)) {
        job.onQueued?.(queue.length);
        this.logger.info("computer observe lane queued", {
          sessionKey,
          targetId,
          queuePosition: queue.length,
        });
      }
      this.pumpObserveQueue(targetId);
    });
  }

  async withControlLane<T>(params: {
    sessionKey: string;
    targetId: string;
    actionType: ComputerActionType;
    foregroundRequired: boolean;
    signal?: AbortSignal;
    operation: (signal: AbortSignal) => Promise<T>;
  }): Promise<T> {
    const sessionKey = params.sessionKey.trim() || "main";
    const targetId = params.targetId.trim();
    this.ensureSessionIsIdle(sessionKey, targetId, "control", params.actionType);

    const currentOwner = this.controlOwners.get(targetId);
    if (currentOwner && currentOwner.sessionKey !== sessionKey) {
      throw new ComputerSessionArbitrationError({
        reasonCode: params.foregroundRequired ? "focus_required" : "concurrency_denied",
        summary: params.foregroundRequired
          ? `foreground control required; session ${currentOwner.sessionKey} already owns ${targetId}`
          : `control lane already owned by session ${currentOwner.sessionKey}`,
        targetId,
        ownerSessionKey: currentOwner.sessionKey,
        foregroundControlRequired: params.foregroundRequired,
        actionType: params.actionType,
      });
    }
    if (this.activeObserveTargets.has(targetId)) {
      throw new ComputerSessionArbitrationError({
        reasonCode: "runtime_busy",
        summary: `shared capture budget busy for ${targetId}`,
        targetId,
        actionType: params.actionType,
      });
    }

    const sessionController = this.ensureSessionController(sessionKey);
    const combinedSignal = combineAbortSignals([params.signal, sessionController.signal]);
    const owner: ControlOwner = {
      sessionKey,
      targetId,
      actionType: params.actionType,
      foregroundRequired: params.foregroundRequired,
      acquiredAt: Date.now(),
    };
    this.controlOwners.set(targetId, owner);
    this.activeOperations.set(sessionKey, {
      kind: "control",
      targetId,
    });
    this.logger.info("computer control lane acquired", {
      sessionKey,
      targetId,
      actionType: params.actionType,
      foregroundRequired: params.foregroundRequired,
    });
    try {
      return await params.operation(combinedSignal);
    } finally {
      const current = this.controlOwners.get(targetId);
      if (current?.sessionKey === sessionKey) {
        this.controlOwners.delete(targetId);
      }
      this.activeOperations.delete(sessionKey);
      this.logger.info("computer control lane released", {
        sessionKey,
        targetId,
        actionType: params.actionType,
      });
      this.pumpObserveQueue(targetId);
    }
  }

  private ensureSessionController(sessionKey: string): AbortController {
    let controller = this.sessionControllers.get(sessionKey);
    if (!controller || controller.signal.aborted) {
      controller = new AbortController();
      this.sessionControllers.set(sessionKey, controller);
    }
    return controller;
  }

  private ensureSessionIsIdle(
    sessionKey: string,
    targetId: string,
    nextKind: OperationKind,
    actionType?: ComputerActionType,
  ) {
    const current = this.activeOperations.get(sessionKey);
    if (!current) {
      return;
    }
    throw new ComputerSessionArbitrationError({
      reasonCode: "concurrency_denied",
      summary: `session ${sessionKey} already has an active ${current.kind} lane on ${current.targetId}`,
      targetId,
      actionType,
    });
  }

  private removeObserveJob(job: ObserveQueueJob) {
    const queue = this.observeQueues.get(job.targetId);
    if (!queue || queue.length === 0) {
      return;
    }
    const next = queue.filter((entry) => entry !== job);
    if (next.length === 0) {
      this.observeQueues.delete(job.targetId);
    } else {
      this.observeQueues.set(job.targetId, next);
    }
  }

  private pumpObserveQueue(targetId: string) {
    if (this.activeObserveTargets.has(targetId) || this.controlOwners.has(targetId)) {
      return;
    }
    const queue = this.observeQueues.get(targetId);
    if (!queue || queue.length === 0) {
      this.observeQueues.delete(targetId);
      return;
    }
    const next = queue.shift();
    if (!next) {
      this.observeQueues.delete(targetId);
      return;
    }
    if (queue.length === 0) {
      this.observeQueues.delete(targetId);
    } else {
      this.observeQueues.set(targetId, queue);
    }
    if (next.signal.aborted) {
      next.reject(toAbortError(next.signal.reason));
      this.pumpObserveQueue(targetId);
      return;
    }
    void next.start();
  }
}

export const computerSessionArbiter = new ComputerSessionArbiter();
