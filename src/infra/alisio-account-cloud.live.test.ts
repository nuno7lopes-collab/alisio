import { describe, expect, it } from "vitest";
import { isLiveTestEnabled, readLiveEnv } from "../agents/live-test-helpers.js";
import {
  beginAlisioCloudAccountEmailAuth,
  completeAlisioCloudAccountEmailLinkAuth,
  listMissingRequiredAlisioCloudEnvVars,
  requestAlisioCloudAccountEmailChange,
  requestAlisioCloudPasswordReset,
} from "./alisio-account-cloud.js";

type ParsedEmailLink =
  | {
      kind: "success";
      accessToken: string;
      refreshToken?: string;
      expiresIn?: number;
      tokenType?: string;
      authType?: string;
    }
  | {
      kind: "error";
      message: string;
    };

const describeLive = isLiveTestEnabled(["ALISIO_LIVE_ACCOUNT"]) ? describe : describe.skip;
const CALLBACK_URL =
  readLiveEnv(["ALISIO_LIVE_ACCOUNT_CALLBACK_URL"]) ??
  "http://localhost:40705/logout/setup?step=account";
const SIGNIN_LINK_URL = readLiveEnv(["ALISIO_LIVE_ACCOUNT_SIGNIN_LINK_URL"]) ?? "";
const RECOVERY_LINK_URL = readLiveEnv(["ALISIO_LIVE_ACCOUNT_RECOVERY_LINK_URL"]) ?? "";
const EMAIL_CHANGE_ENABLED = readLiveEnv(["ALISIO_LIVE_ACCOUNT_ENABLE_EMAIL_CHANGE"]) === "1";
const CHANGE_EMAIL = readLiveEnv(["ALISIO_LIVE_ACCOUNT_CHANGE_EMAIL"])?.trim().toLowerCase() ?? "";
const EMAIL_CHANGE_LINK_URL = readLiveEnv(["ALISIO_LIVE_ACCOUNT_EMAIL_CHANGE_LINK_URL"]) ?? "";
const itIfSigninLink = SIGNIN_LINK_URL ? it : it.skip;
const itIfRecoveryLink = RECOVERY_LINK_URL ? it : it.skip;
const itIfEmailChangeRequest =
  EMAIL_CHANGE_ENABLED && SIGNIN_LINK_URL && CHANGE_EMAIL ? it : it.skip;
const itIfEmailChangeLink =
  EMAIL_CHANGE_ENABLED && SIGNIN_LINK_URL && CHANGE_EMAIL && EMAIL_CHANGE_LINK_URL ? it : it.skip;

function requireLiveEmail(): string {
  const email = readLiveEnv(["ALISIO_LIVE_ACCOUNT_EMAIL"]);
  if (!email) {
    throw new Error(
      "Set ALISIO_LIVE_ACCOUNT_EMAIL to a real inbox before running this live suite.",
    );
  }
  return email.trim().toLowerCase();
}

function assertSupabaseConfigured(): void {
  const missing = listMissingRequiredAlisioCloudEnvVars(process.env);
  expect(missing).toEqual([]);
}

function parseEmailLink(rawUrl: string): ParsedEmailLink | null {
  const url = new URL(rawUrl);
  const searchParams = new URLSearchParams(url.search);
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const readParam = (name: string) => hashParams.get(name) ?? searchParams.get(name);
  const accessToken = readParam("access_token")?.trim() ?? "";
  if (accessToken) {
    const expiresInRaw = readParam("expires_in")?.trim() ?? "";
    const expiresIn = Number.parseInt(expiresInRaw, 10);
    return {
      kind: "success",
      accessToken,
      refreshToken: readParam("refresh_token")?.trim() || undefined,
      expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : undefined,
      tokenType: readParam("token_type")?.trim() || undefined,
      authType: readParam("type")?.trim().toLowerCase() || undefined,
    };
  }
  const errorDescription = readParam("error_description")?.trim();
  const errorCode = readParam("error_code")?.trim();
  if (errorCode || errorDescription) {
    return {
      kind: "error",
      message: errorDescription || errorCode || "Unknown email link error.",
    };
  }
  return null;
}

async function completeLink(rawUrl: string) {
  const parsed = parseEmailLink(rawUrl);
  expect(parsed).not.toBeNull();
  expect(parsed?.kind).toBe("success");
  if (!parsed || parsed.kind !== "success") {
    throw new Error("Expected a Supabase redirect URL with access_token in the fragment or query.");
  }
  return await completeAlisioCloudAccountEmailLinkAuth({
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken,
    expiresIn: parsed.expiresIn,
    tokenType: parsed.tokenType,
    env: process.env,
  });
}

function expectSigninAuthType(authType: string | undefined) {
  expect(["magiclink", "signup", "invite", undefined]).toContain(authType);
}

function expectRecoveryAuthType(authType: string | undefined) {
  expect(authType).toBe("recovery");
}

function expectEmailChangeAuthType(authType: string | undefined) {
  expect(authType).toBe("email_change");
}

function readSuccessfulLinkAuthType(rawUrl: string): string | undefined {
  const parsed = parseEmailLink(rawUrl);
  return parsed?.kind === "success" ? parsed.authType : undefined;
}

async function completeSigninLink() {
  expectSigninAuthType(readSuccessfulLinkAuthType(SIGNIN_LINK_URL));
  return await completeLink(SIGNIN_LINK_URL);
}

describeLive("alisio-account-cloud live", () => {
  it("dispatches a real Supabase sign-in email", async () => {
    const email = requireLiveEmail();
    assertSupabaseConfigured();

    const result = await beginAlisioCloudAccountEmailAuth({
      email,
      callbackUrl: CALLBACK_URL,
      env: process.env,
    });

    expect(result).toMatchObject({
      ok: true,
      email,
    });
  });

  itIfSigninLink("completes a real sign-in link from a real email", async () => {
    const email = requireLiveEmail();
    assertSupabaseConfigured();

    const result = await completeSigninLink();

    expect(result.session).toMatchObject({
      backend: "supabase",
      state: "signed_in",
      authMethod: "email",
      email,
    });
    expect(result.profile).toMatchObject({
      email,
      backend: "supabase",
    });
  });

  it("dispatches a real recovery email", async () => {
    const email = requireLiveEmail();
    assertSupabaseConfigured();

    const result = await requestAlisioCloudPasswordReset({
      email,
      callbackUrl: CALLBACK_URL,
      env: process.env,
    });

    expect(result).toEqual({
      ok: true,
      message: "If this Alisio account exists, a recovery email is on its way.",
    });
  });

  itIfRecoveryLink("completes a real recovery link from a real email", async () => {
    const email = requireLiveEmail();
    assertSupabaseConfigured();
    expectRecoveryAuthType(readSuccessfulLinkAuthType(RECOVERY_LINK_URL));

    const result = await completeLink(RECOVERY_LINK_URL);

    expect(result.session).toMatchObject({
      backend: "supabase",
      state: "signed_in",
      authMethod: "email",
      email,
    });
    expect(result.profile).toMatchObject({
      email,
      backend: "supabase",
    });
  });

  itIfEmailChangeRequest("starts a real email change email", async () => {
    assertSupabaseConfigured();

    const signedIn = await completeSigninLink();
    const result = await requestAlisioCloudAccountEmailChange({
      session: signedIn.session,
      email: CHANGE_EMAIL,
      callbackUrl: CALLBACK_URL,
      env: process.env,
    });

    expect(result).toEqual({
      ok: true,
      message: "Check your new email inbox to confirm the change.",
    });
  });

  itIfEmailChangeLink("completes a real email change link", async () => {
    assertSupabaseConfigured();
    expectEmailChangeAuthType(readSuccessfulLinkAuthType(EMAIL_CHANGE_LINK_URL));

    const result = await completeLink(EMAIL_CHANGE_LINK_URL);

    expect(result.session).toMatchObject({
      backend: "supabase",
      state: "signed_in",
      authMethod: "email",
      email: CHANGE_EMAIL,
    });
    expect(result.profile).toMatchObject({
      email: CHANGE_EMAIL,
      backend: "supabase",
    });
  });
});
