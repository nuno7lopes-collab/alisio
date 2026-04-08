import { describe, expect, it } from "vitest";
import type { AlisioStoredAiProfile, AlisioStoredAiState } from "./alisio-ai-state.js";
import { toAlisioAiState } from "./alisio-ai-state.js";

function createStoredProfile(
  overrides: Partial<AlisioStoredAiProfile> = {},
): AlisioStoredAiProfile {
  return {
    provider: "openai",
    scope: "user",
    ownerKey: "user:nuno",
    canonicalIdentityKey: "email:nuno@example.com",
    identity: {
      email: "nuno@example.com",
      canonicalIdentityKey: "email:nuno@example.com",
      source: "email",
    },
    createdAt: "2026-04-04T12:00:00.000Z",
    ...overrides,
  };
}

describe("toAlisioAiState", () => {
  it("filters out profiles that are only available on another worker", () => {
    const currentWorkerId = "local:this-device";
    const remoteWorkerId = "local:other-device";
    const state: AlisioStoredAiState = {
      aiProfiles: {
        "alisio-openai:current": createStoredProfile(),
        "alisio-openai:remote": createStoredProfile({
          canonicalIdentityKey: "email:remote@example.com",
          identity: {
            email: "remote@example.com",
            canonicalIdentityKey: "email:remote@example.com",
            source: "email",
          },
        }),
      },
      workerCredentials: {
        "cred-current": {
          provider: "openai",
          aiProfileId: "alisio-openai:current",
          workerId: currentWorkerId,
          authProfileId: "openai-codex:current",
          runtimeState: "connected",
          accessToken: "token-current",
          refreshToken: "refresh-current",
          connectedAt: "2026-04-04T12:00:00.000Z",
          createdAt: "2026-04-04T12:00:00.000Z",
          email: "nuno@example.com",
        },
        "cred-remote": {
          provider: "openai",
          aiProfileId: "alisio-openai:remote",
          workerId: remoteWorkerId,
          authProfileId: "openai-codex:remote",
          runtimeState: "connected",
          accessToken: "token-remote",
          refreshToken: "refresh-remote",
          connectedAt: "2026-04-04T12:05:00.000Z",
          createdAt: "2026-04-04T12:05:00.000Z",
          email: "remote@example.com",
        },
      },
      runtimeBindings: {
        [currentWorkerId]: {
          workerId: currentWorkerId,
          workerCredentialId: "cred-current",
          authProfileId: "openai-codex:current",
          boundAt: "2026-04-04T12:00:00.000Z",
        },
      },
    };

    const result = toAlisioAiState({
      state,
      workerId: currentWorkerId,
    });

    expect(result.profiles).toHaveLength(1);
    expect(result.profiles?.[0]?.profileId).toBe("alisio-openai:current");
    expect(result.profiles?.[0]?.workerCredentials).toHaveLength(1);
  });

  it("uses the current worker status for a shared profile", () => {
    const currentWorkerId = "local:this-device";
    const remoteWorkerId = "local:other-device";
    const state: AlisioStoredAiState = {
      aiProfiles: {
        "alisio-openai:shared": createStoredProfile(),
      },
      workerCredentials: {
        "cred-current": {
          provider: "openai",
          aiProfileId: "alisio-openai:shared",
          workerId: currentWorkerId,
          authProfileId: "openai-codex:current",
          runtimeState: "expired",
          accessToken: "token-current",
          refreshToken: "refresh-current",
          connectedAt: "2026-04-04T12:00:00.000Z",
          createdAt: "2026-04-04T12:00:00.000Z",
          email: "nuno@example.com",
        },
        "cred-remote": {
          provider: "openai",
          aiProfileId: "alisio-openai:shared",
          workerId: remoteWorkerId,
          authProfileId: "openai-codex:remote",
          runtimeState: "connected",
          accessToken: "token-remote",
          refreshToken: "refresh-remote",
          connectedAt: "2026-04-04T12:05:00.000Z",
          createdAt: "2026-04-04T12:05:00.000Z",
          email: "nuno@example.com",
        },
      },
      runtimeBindings: {
        [currentWorkerId]: {
          workerId: currentWorkerId,
          workerCredentialId: "cred-current",
          authProfileId: "openai-codex:current",
          boundAt: "2026-04-04T12:00:00.000Z",
        },
      },
    };

    const result = toAlisioAiState({
      state,
      workerId: currentWorkerId,
    });

    expect(result.status).toBe("expired");
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles?.[0]?.status).toBe("expired");
    expect(result.profiles?.[0]?.workerCredentials).toHaveLength(1);
    expect(result.profiles?.[0]?.workerCredentials?.[0]?.workerId).toBe(currentWorkerId);
  });
});
