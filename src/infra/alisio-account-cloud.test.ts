import { describe, expect, it, vi } from "vitest";
import {
  beginAlisioCloudAccountEmailAuth,
  completeAlisioCloudAccountEmailLinkAuth,
  completeAlisioCloudAccountProfile,
  listMissingRequiredAlisioCloudEnvVars,
  requestAlisioCloudAccountEmailChange,
  requestAlisioCloudPasswordReset,
  resolveAlisioAccountBackend,
  restoreAlisioCloudAccountSession,
  signUpAlisioCloudAccount,
  updateAlisioCloudAccountPassword,
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

  it("lists missing required Supabase env vars explicitly", () => {
    expect(listMissingRequiredAlisioCloudEnvVars({} as NodeJS.ProcessEnv)).toEqual([
      "ALISIO_SUPABASE_URL",
      "ALISIO_SUPABASE_ANON_KEY",
    ]);
    expect(
      listMissingRequiredAlisioCloudEnvVars({
        ALISIO_SUPABASE_URL: "https://example.supabase.co",
        ALISIO_SUPABASE_ANON_KEY: "anon-key",
      } as NodeJS.ProcessEnv),
    ).toEqual([]);
    expect(
      listMissingRequiredAlisioCloudEnvVars({
        ALISIO_SUPABASE_URL: "https://example.supabase.co",
        ALISIO_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_project_ref_example",
      } as NodeJS.ProcessEnv),
    ).toEqual([]);
  });

  it("creates a persisted default profile in Supabase during sign-up", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
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

  it("keeps sign-up pending when Supabase requires email confirmation", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const requestUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      expect(requestUrl).toContain(
        "redirect_to=http%3A%2F%2Flocalhost%3A40705%2Flogout%2Fsetup%3Fstep%3Daccount",
      );
      return new Response(
        JSON.stringify({
          user: {
            id: "user-1",
            email: "owner@example.com",
            created_at: "2026-04-04T15:30:00.000Z",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await signUpAlisioCloudAccount({
      email: "owner@example.com",
      password: "password123",
      callbackUrl: "http://localhost:40705/logout/setup?step=account",
      env: SUPABASE_ENV,
      fetchImpl: fetchMock,
    });

    expect(result.session).toMatchObject({
      backend: "supabase",
      state: "signed_out",
      authMethod: "email",
      email: "owner@example.com",
    });
    expect(result.profile).toMatchObject({
      email: "owner@example.com",
      profileCompleted: false,
      backend: "supabase",
    });
  });

  it("passes a redirect_to header when email auth provides a callback url", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const requestUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      expect(new Headers(init?.headers).get("redirect_to")).toBe(
        "http://localhost:40705/logout/setup?step=account",
      );
      expect(requestUrl).toContain(
        "redirect_to=http%3A%2F%2Flocalhost%3A40705%2Flogout%2Fsetup%3Fstep%3Daccount",
      );
      expect(parseJsonBody(init?.body)).toEqual({
        email: "owner@example.com",
        create_user: true,
      });
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const result = await beginAlisioCloudAccountEmailAuth({
      email: "owner@example.com",
      callbackUrl: "http://localhost:40705/logout/setup?step=account",
      env: SUPABASE_ENV,
      fetchImpl: fetchMock,
    });

    expect(result).toEqual({
      ok: true,
      email: "owner@example.com",
      message:
        "Check your email for the Alisio sign-in link. If the email also includes a 6-digit backup code, you can enter it in the app instead.",
    });
  });

  it("surfaces the upstream Supabase failure when email auth dispatch is rejected", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          msg: "Email logins are disabled",
        }),
        {
          status: 429,
          headers: { "content-type": "application/json" },
        },
      );
    });

    await expect(
      beginAlisioCloudAccountEmailAuth({
        email: "owner@example.com",
        env: SUPABASE_ENV,
        fetchImpl: fetchMock,
      }),
    ).rejects.toMatchObject({
      name: "AlisioAccountCloudError",
      code: "email_auth_failed",
      message:
        "Alisio could not send the verification email right now. Supabase replied with HTTP 429: Email logins are disabled",
    });
  });

  it("passes redirect_to on recovery emails so Alisio can finish the reset locally", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const requestUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      expect(requestUrl).toContain(
        "redirect_to=http%3A%2F%2Flocalhost%3A40705%2Flogout%2Fsetup%3Fstep%3Daccount",
      );
      expect(parseJsonBody(init?.body)).toEqual({
        email: "owner@example.com",
      });
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const result = await requestAlisioCloudPasswordReset({
      email: "owner@example.com",
      callbackUrl: "http://localhost:40705/logout/setup?step=account",
      env: SUPABASE_ENV,
      fetchImpl: fetchMock,
    });

    expect(result).toEqual({
      ok: true,
      message: "If this Alisio account exists, a recovery email is on its way.",
    });
  });

  it("surfaces the upstream Supabase failure when account recovery is rejected", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          error_description: "Rate limit exceeded",
        }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      );
    });

    await expect(
      requestAlisioCloudPasswordReset({
        email: "owner@example.com",
        env: SUPABASE_ENV,
        fetchImpl: fetchMock,
      }),
    ).rejects.toMatchObject({
      name: "AlisioAccountCloudError",
      code: "password_reset_failed",
      message:
        "Alisio could not start account recovery right now. Supabase replied with HTTP 400: Rate limit exceeded",
    });
  });

  it("completes email link auth from returned Supabase tokens", async () => {
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
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockImplementationOnce(async (_input, init) => {
        const payload = parseJsonBody(init?.body);
        expect(payload.user_id).toBe("user-1");
        expect(payload.email).toBe("owner@example.com");
        expect(payload.profile_completed).toBe(false);
        return new Response(JSON.stringify([payload]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

    const result = await completeAlisioCloudAccountEmailLinkAuth({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
      tokenType: "bearer",
      env: SUPABASE_ENV,
      fetchImpl: fetchMock,
    });

    expect(result.session).toMatchObject({
      backend: "supabase",
      state: "signed_in",
      authMethod: "email",
      userId: "user-1",
      email: "owner@example.com",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      tokenType: "bearer",
    });
    expect(result.profile).toMatchObject({
      email: "owner@example.com",
      profileCompleted: false,
      backend: "supabase",
    });
  });

  it("retries profile fetch when the live Supabase table is missing optional columns", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const requestUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (requestUrl.includes("/auth/v1/user")) {
        return new Response(
          JSON.stringify({
            id: "user-1",
            email: "owner@example.com",
            created_at: "2026-04-04T15:30:00.000Z",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (requestUrl.includes("agent_name")) {
        return new Response(
          JSON.stringify({
            code: "42703",
            message: "column alisio_profiles.agent_name does not exist",
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      if (requestUrl.includes("terms_accepted_at")) {
        return new Response(
          JSON.stringify({
            code: "42703",
            message: "column alisio_profiles.terms_accepted_at does not exist",
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      expect(requestUrl).not.toContain("agent_name");
      expect(requestUrl).not.toContain("terms_accepted_at");
      return new Response(
        JSON.stringify([
          {
            user_id: "user-1",
            email: "owner@example.com",
            display_name: "Owner",
            username: "owner",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await completeAlisioCloudAccountEmailLinkAuth({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
      tokenType: "bearer",
      env: SUPABASE_ENV,
      fetchImpl: fetchMock,
    });

    expect(result.profile).toMatchObject({
      userId: "user-1",
      email: "owner@example.com",
      displayName: "Owner",
      username: "owner",
      backend: "supabase",
    });
  });

  it("refreshes an expired email link session when the fragment includes a refresh token", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: "JWT expired",
          }),
          {
            status: 403,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockImplementationOnce(async (_input, init) => {
        expect(parseJsonBody(init?.body)).toEqual({
          refresh_token: "refresh-token",
        });
        return new Response(
          JSON.stringify({
            access_token: "refreshed-access-token",
            refresh_token: "refreshed-refresh-token",
            token_type: "bearer",
            expires_in: 7200,
            user: {
              id: "user-1",
              email: "owner@example.com",
              created_at: "2026-04-04T15:30:00.000Z",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      })
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
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockImplementationOnce(async (_input, init) => {
        const payload = parseJsonBody(init?.body);
        expect(payload.user_id).toBe("user-1");
        expect(payload.email).toBe("owner@example.com");
        return new Response(JSON.stringify([payload]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

    const result = await completeAlisioCloudAccountEmailLinkAuth({
      accessToken: "expired-access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
      tokenType: "bearer",
      env: SUPABASE_ENV,
      fetchImpl: fetchMock,
    });

    expect(result.session).toMatchObject({
      accessToken: "refreshed-access-token",
      refreshToken: "refreshed-refresh-token",
      tokenType: "bearer",
      userId: "user-1",
      email: "owner@example.com",
    });
    expect(result.profile).toMatchObject({
      userId: "user-1",
      email: "owner@example.com",
      backend: "supabase",
    });
  });

  it("surfaces the upstream Supabase failure when the email link token no longer resolves a user", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          message: "JWT expired",
        }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      );
    });

    await expect(
      completeAlisioCloudAccountEmailLinkAuth({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: 3600,
        tokenType: "bearer",
        env: SUPABASE_ENV,
        fetchImpl: fetchMock,
      }),
    ).rejects.toMatchObject({
      name: "AlisioAccountCloudError",
      code: "session_refresh_failed",
      message:
        "The Alisio account session is no longer valid. Sign in again. Supabase replied with HTTP 401: JWT expired",
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

  it("starts an email change through Supabase user update with redirect_to", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const requestUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      expect(requestUrl).toContain(
        "redirect_to=http%3A%2F%2Flocalhost%3A40705%2Flogout%2Fsettings",
      );
      expect(parseJsonBody(init?.body)).toEqual({
        email: "next@example.com",
      });
      return new Response(JSON.stringify({ email_change_sent_at: "2026-04-05T10:00:00.000Z" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await requestAlisioCloudAccountEmailChange({
      session: createSupabaseSession(),
      email: "next@example.com",
      callbackUrl: "http://localhost:40705/logout/settings",
      env: SUPABASE_ENV,
      fetchImpl: fetchMock,
    });

    expect(result).toEqual({
      ok: true,
      message: "Check your new email inbox to confirm the change.",
    });
  });

  it("updates the password through Supabase user update", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      expect(parseJsonBody(init?.body)).toEqual({
        password: "password123",
      });
      return new Response(JSON.stringify({ id: "user-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await updateAlisioCloudAccountPassword({
      session: createSupabaseSession(),
      password: "password123",
      env: SUPABASE_ENV,
      fetchImpl: fetchMock,
    });

    expect(result).toEqual({
      ok: true,
      message: "Your Alisio password was updated.",
    });
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
