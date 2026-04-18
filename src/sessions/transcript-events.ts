export type SessionTranscriptUpdate = {
  sessionFile: string;
  sessionKey?: string;
  message?: unknown;
  messageId?: string;
  phase?: "message" | "transcript";
};

type SessionTranscriptListener = (update: SessionTranscriptUpdate) => void;

const SESSION_TRANSCRIPT_LISTENERS = new Set<SessionTranscriptListener>();

export function onSessionTranscriptUpdate(listener: SessionTranscriptListener): () => void {
  SESSION_TRANSCRIPT_LISTENERS.add(listener);
  return () => {
    SESSION_TRANSCRIPT_LISTENERS.delete(listener);
  };
}

export function emitSessionTranscriptUpdate(update: string | SessionTranscriptUpdate): void {
  const normalized =
    typeof update === "string"
      ? { sessionFile: update, phase: "transcript" as const }
      : {
          sessionFile: update.sessionFile,
          sessionKey: update.sessionKey,
          message: update.message,
          messageId: update.messageId,
          phase: update.phase,
        };
  const trimmed = normalized.sessionFile.trim();
  if (!trimmed) {
    return;
  }
  const phase = normalized.phase ?? (normalized.message !== undefined ? "message" : "transcript");
  const nextUpdate: SessionTranscriptUpdate = {
    sessionFile: trimmed,
    phase,
    ...(typeof normalized.sessionKey === "string" && normalized.sessionKey.trim()
      ? { sessionKey: normalized.sessionKey.trim() }
      : {}),
    ...(normalized.message !== undefined ? { message: normalized.message } : {}),
    ...(typeof normalized.messageId === "string" && normalized.messageId.trim()
      ? { messageId: normalized.messageId.trim() }
      : {}),
  };
  for (const listener of SESSION_TRANSCRIPT_LISTENERS) {
    try {
      listener(nextUpdate);
    } catch {
      /* ignore */
    }
  }
}
