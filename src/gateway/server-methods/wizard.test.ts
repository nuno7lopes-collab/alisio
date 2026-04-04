import { describe, expect, it, vi } from "vitest";
import { WizardSession } from "../../wizard/session.js";
import type { GatewayRequestContext, GatewayRequestHandlerOptions, RespondFn } from "./types.js";
import { wizardHandlers } from "./wizard.js";

function createContext(overrides?: Partial<GatewayRequestContext>): GatewayRequestContext {
  const wizardSessions = new Map();
  const channelWizardSessions = new Map();
  const context = {
    wizardSessions,
    channelWizardSessions,
    findRunningWizard: vi.fn(() => null),
    getRunningChannelWizard: vi.fn(() => null),
    purgeWizardSession: vi.fn((id: string) => {
      wizardSessions.delete(id);
    }),
    purgeChannelWizardSession: vi.fn((id: string) => {
      channelWizardSessions.delete(id);
    }),
    rememberChannelWizardSession: vi.fn(),
    wizardRunner: vi.fn(),
    channelWizardRunner: vi.fn(
      async (
        opts: { channel: string },
        _runtime: unknown,
        prompter: { note: (message: string, title?: string) => Promise<void> },
      ) => {
        await prompter.note(`Configure ${opts.channel}`, "Channel");
      },
    ),
    ...overrides,
  } satisfies Partial<GatewayRequestContext>;
  return context as GatewayRequestContext;
}

function createOptions(
  method: "wizard.start" | "wizard.next",
  params: Record<string, unknown>,
  context: GatewayRequestContext,
) {
  const respond = vi.fn() as unknown as RespondFn;
  return {
    req: { type: "req", id: "req-1", method, params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond,
    context,
  } satisfies GatewayRequestHandlerOptions;
}

describe("wizardHandlers channel surface", () => {
  it("retoma o wizard do canal em curso em vez de devolver erro", async () => {
    const context = createContext();
    const firstStart = createOptions(
      "wizard.start",
      { surface: "channel", channel: "telegram" },
      context,
    );

    await wizardHandlers["wizard.start"](firstStart);

    const firstRespond = firstStart.respond as unknown as ReturnType<typeof vi.fn>;
    const firstPayload = firstRespond.mock.calls[0]?.[1] as {
      sessionId: string;
      step: { id: string; message: string };
    };

    context.getRunningChannelWizard = vi.fn(() => ({
      sessionId: firstPayload.sessionId,
      channelId: "telegram",
    }));

    const resumedStart = createOptions(
      "wizard.start",
      { surface: "channel", channel: "telegram" },
      context,
    );

    await wizardHandlers["wizard.start"](resumedStart);

    expect(context.channelWizardRunner).toHaveBeenCalledTimes(1);
    expect(context.channelWizardSessions.size).toBe(1);
    const resumedRespond = resumedStart.respond as unknown as ReturnType<typeof vi.fn>;
    expect(resumedRespond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        sessionId: firstPayload.sessionId,
        done: false,
        status: "running",
        step: expect.objectContaining({
          id: firstPayload.step.id,
          message: "Configure telegram",
        }),
      }),
      undefined,
    );
  });

  it("cancela um onboarding em curso antes de arrancar o wizard do canal", async () => {
    const onboardingSession = new WizardSession(async (prompter) => {
      await prompter.note("Onboarding", "Setup");
    });
    const context = createContext({
      findRunningWizard: vi.fn(() => "wizard-onboarding-1"),
    });
    context.wizardSessions.set("wizard-onboarding-1", onboardingSession);

    const startOpts = createOptions(
      "wizard.start",
      { surface: "channel", channel: "telegram" },
      context,
    );

    await wizardHandlers["wizard.start"](startOpts);

    expect(context.purgeWizardSession).toHaveBeenCalledWith("wizard-onboarding-1");
    expect(context.wizardSessions.size).toBe(0);
    expect(context.channelWizardRunner).toHaveBeenCalledWith(
      { channel: "telegram" },
      expect.anything(),
      expect.anything(),
    );
    const startRespond = startOpts.respond as unknown as ReturnType<typeof vi.fn>;
    expect(startRespond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        done: false,
        status: "running",
        step: expect.objectContaining({
          type: "note",
          message: "Configure telegram",
        }),
      }),
      undefined,
    );
  });

  it("starts channel setup in the dedicated channel wizard session store", async () => {
    const context = createContext();
    const startOpts = createOptions(
      "wizard.start",
      { surface: "channel", channel: "telegram" },
      context,
    );

    await wizardHandlers["wizard.start"](startOpts);

    expect(context.channelWizardRunner).toHaveBeenCalledWith(
      { channel: "telegram" },
      expect.anything(),
      expect.anything(),
    );
    expect(context.rememberChannelWizardSession).toHaveBeenCalledWith(expect.any(String), {
      channelId: "telegram",
    });
    expect(context.wizardRunner).not.toHaveBeenCalled();
    expect(context.wizardSessions.size).toBe(0);
    expect(context.channelWizardSessions.size).toBe(1);

    const startRespond = startOpts.respond as unknown as ReturnType<typeof vi.fn>;
    const startPayload = startRespond.mock.calls[0]?.[1] as {
      sessionId: string;
      step: { id: string };
    };
    expect(startPayload).toMatchObject({
      done: false,
      status: "running",
      step: expect.objectContaining({
        type: "note",
        title: "Channel",
        message: "Configure telegram",
      }),
    });

    const nextOpts = createOptions(
      "wizard.next",
      {
        sessionId: startPayload.sessionId,
        answer: {
          stepId: startPayload.step.id,
        },
      },
      context,
    );

    await wizardHandlers["wizard.next"](nextOpts);

    expect(context.purgeChannelWizardSession).toHaveBeenCalledWith(startPayload.sessionId);
    expect(context.channelWizardSessions.size).toBe(0);
    const nextRespond = nextOpts.respond as unknown as ReturnType<typeof vi.fn>;
    expect(nextRespond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        done: true,
        status: "done",
      }),
      undefined,
    );
  });
});
