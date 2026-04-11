import { beforeEach, describe, expect, it, vi } from "vitest";

const readChannelAllowFromStore = vi.hoisted(() => vi.fn(async () => [] as string[]));
const listChannelPairingRequests = vi.hoisted(() =>
  vi.fn(async () => [] as Array<{ id: string; meta?: Record<string, string> }>),
);

vi.mock("alisio/plugin-sdk/conversation-runtime", () => ({
  readChannelAllowFromStore,
  listChannelPairingRequests,
}));

import type { AlisioConfig } from "alisio/plugin-sdk/config-runtime";
import { resolveTelegramDmOnboardingStatus } from "./dm-onboarding-state.js";

describe("resolveTelegramDmOnboardingStatus", () => {
  beforeEach(() => {
    readChannelAllowFromStore.mockReset();
    listChannelPairingRequests.mockReset();
    readChannelAllowFromStore.mockResolvedValue([]);
    listChannelPairingRequests.mockResolvedValue([]);
  });

  it("reports waiting for the first DM when pairing has no approved sender yet", async () => {
    const cfg: AlisioConfig = {
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
        pendingRequests: [],
      },
    );
  });

  it("reports pending approval when a first-DM pairing request already exists", async () => {
    const cfg: AlisioConfig = {
      channels: {
        telegram: {
          botToken: "tok",
          dmPolicy: "pairing",
        },
      },
    };
    listChannelPairingRequests.mockResolvedValue([
      { id: "6074269928", meta: { firstName: "Nuno", username: "nuno" } },
      { id: "1234567890", meta: { username: "alice" } },
    ]);

    await expect(resolveTelegramDmOnboardingStatus({ cfg, accountId: "default" })).resolves.toEqual(
      {
        state: "pending_approval",
        pendingPairingRequests: 2,
        pendingRequests: [
          {
            requestId: "6074269928",
            label: "Nuno",
            detail: "@nuno · 6074269928",
          },
          {
            requestId: "1234567890",
            label: "@alice",
            detail: "@alice · 1234567890",
          },
        ],
      },
    );
  });

  it("returns null once a DM sender is already approved through the pairing store", async () => {
    const cfg: AlisioConfig = {
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
    const cfg: AlisioConfig = {
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
