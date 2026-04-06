import { beforeEach, describe, expect, it, vi } from "vitest";

const readChannelAllowFromStore = vi.hoisted(() => vi.fn(async () => [] as string[]));
const listChannelPairingRequests = vi.hoisted(() =>
  vi.fn(async () => [] as Array<{ code: string }>),
);

vi.mock("openclaw/plugin-sdk/conversation-runtime", () => ({
  readChannelAllowFromStore,
  listChannelPairingRequests,
}));

import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { resolveTelegramDmOnboardingStatus } from "./dm-onboarding-state.js";

describe("resolveTelegramDmOnboardingStatus", () => {
  beforeEach(() => {
    readChannelAllowFromStore.mockReset();
    listChannelPairingRequests.mockReset();
    readChannelAllowFromStore.mockResolvedValue([]);
    listChannelPairingRequests.mockResolvedValue([]);
  });

  it("reports waiting for the first DM when pairing has no approved sender yet", async () => {
    const cfg: OpenClawConfig = {
      channels: {
        telegram: {
          botToken: "tok",
          dmPolicy: "pairing",
        },
      },
    };

    await expect(resolveTelegramDmOnboardingStatus({ cfg, accountId: "default" })).resolves.toEqual(
      {
        state: "waiting_for_first_dm",
        pendingPairingRequests: 0,
      },
    );
  });

  it("reports pending approval when a first-DM pairing request already exists", async () => {
    const cfg: OpenClawConfig = {
      channels: {
        telegram: {
          botToken: "tok",
          dmPolicy: "pairing",
        },
      },
    };
    listChannelPairingRequests.mockResolvedValue([{ code: "PAIR1" }, { code: "PAIR2" }]);

    await expect(resolveTelegramDmOnboardingStatus({ cfg, accountId: "default" })).resolves.toEqual(
      {
        state: "pending_approval",
        pendingPairingRequests: 2,
      },
    );
  });

  it("returns null once a DM sender is already approved through the pairing store", async () => {
    const cfg: OpenClawConfig = {
      channels: {
        telegram: {
          botToken: "tok",
          dmPolicy: "pairing",
        },
      },
    };
    readChannelAllowFromStore.mockResolvedValue(["123456789"]);

    await expect(resolveTelegramDmOnboardingStatus({ cfg, accountId: "default" })).resolves.toBe(
      null,
    );
  });

  it("ignores non-pairing DM policies", async () => {
    const cfg: OpenClawConfig = {
      channels: {
        telegram: {
          botToken: "tok",
          dmPolicy: "allowlist",
          allowFrom: ["123456789"],
        },
      },
    };

    await expect(resolveTelegramDmOnboardingStatus({ cfg, accountId: "default" })).resolves.toBe(
      null,
    );
  });
});
