import { describe, expect, it } from "vitest";
import {
  clearAlisioAccountEmailLinkAuthFromUrl,
  readAlisioAccountEmailLinkAuthResultFromUrl,
  resolveAlisioAccountEmailRedirectUrl,
} from "./alisio-account-auth.ts";

describe("alisio account email link auth url helpers", () => {
  it("lê tokens de sessão a partir do fragmento Supabase", () => {
    expect(
      readAlisioAccountEmailLinkAuthResultFromUrl(
        "http://localhost:18789/logout/setup?step=account#access_token=at_123&refresh_token=rt_456&expires_in=3600&token_type=bearer&type=magiclink",
      ),
    ).toEqual({
      kind: "success",
      accessToken: "at_123",
      refreshToken: "rt_456",
      expiresIn: 3600,
      tokenType: "bearer",
      authType: "magiclink",
    });
  });

  it("preserva o tipo de callback para recovery e email_change", () => {
    expect(
      readAlisioAccountEmailLinkAuthResultFromUrl(
        "http://localhost:18789/logout/setup#access_token=at_123&type=recovery",
      ),
    ).toEqual({
      kind: "success",
      accessToken: "at_123",
      authType: "recovery",
    });
    expect(
      readAlisioAccountEmailLinkAuthResultFromUrl(
        "http://localhost:18789/logout/settings#access_token=at_123&type=email_change",
      ),
    ).toEqual({
      kind: "success",
      accessToken: "at_123",
      authType: "email_change",
    });
  });

  it("normaliza erros comuns de links expirados", () => {
    expect(
      readAlisioAccountEmailLinkAuthResultFromUrl(
        "http://localhost:18789/logout/setup#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
      ),
    ).toEqual({
      kind: "error",
      message: "The sign-in link is invalid or has expired. Request a new email and try again.",
    });
  });

  it("limpa tokens e erros do URL antes de o reutilizar como redirect", () => {
    expect(
      clearAlisioAccountEmailLinkAuthFromUrl(
        "http://localhost:18789/logout/setup?step=account&error_description=stale#access_token=at_123&refresh_token=rt_456&sb=",
      ),
    ).toBe("http://localhost:18789/logout/setup?step=account");
  });

  it("preserva params genéricos sem sinal de callback de auth", () => {
    expect(
      clearAlisioAccountEmailLinkAuthFromUrl(
        "http://localhost:18789/logout/setup?step=account&error=other&type=custom",
      ),
    ).toBe("http://localhost:18789/logout/setup?step=account&error=other&type=custom");
  });

  it("preserva um type conhecido quando aparece sozinho sem tokens nem erros", () => {
    expect(
      clearAlisioAccountEmailLinkAuthFromUrl(
        "http://localhost:18789/logout/setup?step=account&type=magiclink",
      ),
    ).toBe("http://localhost:18789/logout/setup?step=account&type=magiclink");
  });

  it("gera um redirect reutilizável a partir da página actual", () => {
    expect(
      resolveAlisioAccountEmailRedirectUrl(
        "http://localhost:18789/logout/setup?step=gateway#access_token=stale",
      ),
    ).toBe("http://localhost:18789/logout/setup?step=gateway");
  });
});
