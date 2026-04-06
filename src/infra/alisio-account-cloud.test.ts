import { describe, expect, it, vi } from "vitest";
import {
  completeAlisioCloudAccountProfile,
  resolveAlisioAccountBackend,
  restoreAlisioCloudAccountSession,
  signUpAlisioCloudAccount,
  type AlisioCloudAccountProfile,
  type AlisioStoredCloudSession,
} from "./alisio-account-cloud.js";

const SUPABASE_ENV = {
  ALISIO_SUPABASE_URL: "https://example.supabase.co",
  ALISIO_SUPABASE_ANON_KEY: "anon-key",
} as NodeJS.ProcessEnv;

function parseJsonBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== "string") {
    throw new Error("Expected request body to be a JSON string.");
  }
  return JSON.parse(body) as Record<string, unknown>;
}

function createSupabaseSession(): AlisioStoredCloudSession {
  return {
    backend: "supabase",
    state: "signed_in",
    userId: "user-1",
    email: "owner@example.com",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: "2026-04-04T16:30:00.000Z",
    tokenType: "bearer",
    signedInAt: "2026-04-04T15:30:00.000Z",
  };
}

function createSupabaseProfile(): AlisioCloudAccountProfile {
  return {
    userId: "user-1",
    email: "owner@example.com",
    displayName: "Owner",
    username: "owner",
    avatarLabel: "O",
    joinedAt: "2026-04-04T15:30:00.000Z",
    plan: "free",
    profileCompleted: true,
    backend: "supabase",
  };
}

describe("alisio-account-cloud", () => {
  it("always resolves the account backend to Supabase", () => {
    expect(resolveAlisioAccountBackend({} as NodeJS.ProcessEnv)).toBe("supabase");
  });

  it("creates a persisted default profile in Supabase during sign-up", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user: {
              id: "user-1",
              email: "owner@example.com",
              created_at: "2026-04-04T15:30:00.000Z",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
            token_type: "bearer",
            user: {
              id: "user-1",
              email: "owner@example.com",
              created_at: "2026-04-04T15:30:00.000Z",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockImplementationOnce(async (_input, init) => {
        const payload = parseJsonBody(init?.body);
        expect(payload.user_id).toBe("user-1");
        expect(payload.email).toBe("owner@example.com");
        expect(payload.profile_completed).toBe(false);
        expect(typeof payload.username).toBe("string");
        expect(String(payload.username).length).toBeGreaterThanOrEqual(4);
        return new Response(JSON.stringify([payload]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

    const result = await signUpAlisioCloudAccount({
      email: "owner@example.com",
      password: "password123",
      env: SUPABASE_ENV,
      fetchImpl: fetchMock,
    });

    expect(result.profile).toMatchObject({
      email: "owner@example.com",
      profileCompleted: false,
      backend: "supabase",
    });
  });

  it("keeps the Supabase auth email authoritative when saving the cloud profile", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const payload = parseJsonBody(init?.body);
      expect(payload.email).toBe("owner@example.com");
      expect(payload.username).toBe("owner_handle");
      return new Response(JSON.stringify([payload]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const profile = await completeAlisioCloudAccountProfile({
      session: createSupabaseSession(),
      email: "edited@example.com",
      username: "Owner_Handle",
      displayName: "Owner Name",
      avatarLabel: "ON",
      joinedAt: "2026-04-04T15:30:00.000Z",
      plan: "free",
      env: SUPABASE_ENV,
      fetchImpl: fetchMock,
    });

    expect(profile.email).toBe("owner@example.com");
    expect(profile.username).toBe("owner_handle");
    expect(profile.profileCompleted).toBe(true);
  });

  it("drops cloud tokens when a stored Supabase session cannot be restored", async () => {
    const restored = await restoreAlisioCloudAccountSession({
      session: createSupabaseSession(),
      profile: createSupabaseProfile(),
      env: {} as NodeJS.ProcessEnv,
    });

    expect(restored.profile.profileCompleted).toBe(false);
    expect(restored.session).toMatchObject({
      backend: "supabase",
      state: "signed_out",
      userId: "user-1",
      email: "owner@example.com",
      signedInAt: "2026-04-04T15:30:00.000Z",
      signedOutAt: expect.any(String),
    });
    expect(restored.session).not.toHaveProperty("accessToken");
    expect(restored.session).not.toHaveProperty("refreshToken");
    expect(restored.session).not.toHaveProperty("expiresAt");
    expect(restored.session).not.toHaveProperty("tokenType");
  });

  it("heals a drifted Supabase profile email from the auth session during restore", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "user-1",
            email: "owner@example.com",
            created_at: "2026-04-04T15:30:00.000Z",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              user_id: "user-1",
              email: "drifted@example.com",
              display_name: "Owner",
              username: "owner",
              avatar_label: "O",
              joined_at: "2026-04-04T15:30:00.000Z",
              plan: "free",
              profile_completed: true,
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockImplementationOnce(async (_input, init) => {
        const payload = parseJsonBody(init?.body);
        expect(payload.email).toBe("owner@example.com");
        expect(payload.user_id).toBe("user-1");
        return new Response(JSON.stringify([payload]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

    const restored = await restoreAlisioCloudAccountSession({
      session: {
        ...createSupabaseSession(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      profile: createSupabaseProfile(),
      env: SUPABASE_ENV,
      fetchImpl: fetchMock,
    });

    expect(restored.session.email).toBe("owner@example.com");
    expect(restored.profile.email).toBe("owner@example.com");
    expect(restored.profile.profileCompleted).toBe(true);
  });
});
