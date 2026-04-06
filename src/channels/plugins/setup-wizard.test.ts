import { describe, expect, it, vi } from "vitest";
import { buildChannelSetupWizardAdapterFromSetupWizard } from "./setup-wizard.js";

describe("buildChannelSetupWizardAdapterFromSetupWizard", () => {
  it("propagates afterConfigWritten to the generated adapter", async () => {
    const afterConfigWritten = vi.fn(async () => undefined);
    const adapter = buildChannelSetupWizardAdapterFromSetupWizard({
      plugin: {
        id: "telegram",
        meta: {
          id: "telegram",
          label: "Telegram",
          selectionLabel: "Telegram",
          docsPath: "/channels/telegram",
          blurb: "Telegram channel",
          detailLabel: "Telegram",
        },
        config: {
          listAccountIds: () => ["default"],
          resolveAccount: () => ({}),
        },
        setup: {
          applyAccountConfig: ({ cfg }) => cfg,
        },
      },
      wizard: {
        channel: "telegram",
        status: {
          configuredLabel: "configured",
          unconfiguredLabel: "needs token",
          resolveConfigured: () => false,
        },
        credentials: [],
        afterConfigWritten,
      },
    });

    await adapter.afterConfigWritten?.({
      previousCfg: {},
      cfg: {},
      accountId: "default",
      runtime: {
        log: vi.fn(),
        error: vi.fn(),
        exit: vi.fn(),
      },
    });

    expect(afterConfigWritten).toHaveBeenCalledWith({
      previousCfg: {},
      cfg: {},
      accountId: "default",
      runtime: expect.any(Object),
    });
  });
});
