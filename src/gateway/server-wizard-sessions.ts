import type { WizardSession } from "../wizard/session.js";

export function createWizardSessionTracker<TMeta = undefined>() {
  const wizardSessions = new Map<string, WizardSession>();
  const wizardMeta = new Map<string, TMeta>();

  const findRunningWizard = (): string | null => {
    for (const [id, session] of wizardSessions) {
      if (session.getStatus() === "running") {
        return id;
      }
    }
    return null;
  };

  const getRunningWizard = (): { sessionId: string; meta: TMeta | undefined } | null => {
    for (const [sessionId, session] of wizardSessions) {
      if (session.getStatus() === "running") {
        return { sessionId, meta: wizardMeta.get(sessionId) };
      }
    }
    return null;
  };

  const rememberWizardMeta = (id: string, meta: TMeta) => {
    wizardMeta.set(id, meta);
  };

  const readWizardMeta = (id: string) => wizardMeta.get(id);

  const purgeWizardSession = (id: string) => {
    const session = wizardSessions.get(id);
    if (!session) {
      return;
    }
    if (session.getStatus() === "running") {
      return;
    }
    wizardSessions.delete(id);
    wizardMeta.delete(id);
  };

  return {
    wizardSessions,
    findRunningWizard,
    getRunningWizard,
    rememberWizardMeta,
    readWizardMeta,
    purgeWizardSession,
  };
}
