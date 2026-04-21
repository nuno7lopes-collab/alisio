import { describe, expect, it } from "vitest";
import {
  ALISIO_ACCOUNT_SCOPE_ROOT,
  ALISIO_BACKEND_SHARED_RESOURCES,
  ALISIO_LOCAL_RUNTIME_RESOURCES,
  buildAccountDeviceBinding,
  buildAccountWorkspaceScopeSegments,
  buildAlisioDataResidencyContract,
  isAccountScopedWorkspaceDir,
  normalizeCanonicalAccountId,
  resolveCanonicalAccountScope,
} from "./alisio-account-scope.js";

describe("shared/alisio-account-scope", () => {
  it("normalizes canonical account ids", () => {
    expect(normalizeCanonicalAccountId("  User@example.com ")).toBe("user@example.com");
    expect(normalizeCanonicalAccountId(" acct_123 ")).toBe("acct_123");
    expect(normalizeCanonicalAccountId("   ")).toBeUndefined();
  });

  it("resolves the signed-in canonical account id from the strongest available source", () => {
    expect(
      resolveCanonicalAccountScope({
        authenticated: true,
        accountId: " acct_primary ",
        accountUserId: "user-2",
        userId: "user-1",
        email: "person@example.com",
      }),
    ).toEqual({
      scopeRoot: ALISIO_ACCOUNT_SCOPE_ROOT,
      accountId: "acct_primary",
      source: "account_id",
      authenticated: true,
      authRequired: true,
    });

    expect(
      resolveCanonicalAccountScope({
        authenticated: true,
        userId: "user-1",
        email: "person@example.com",
      }),
    ).toEqual({
      scopeRoot: ALISIO_ACCOUNT_SCOPE_ROOT,
      accountId: "user-1",
      source: "user_id",
      authenticated: true,
      authRequired: true,
    });
  });

  it("drops account binding when auth is missing", () => {
    expect(
      resolveCanonicalAccountScope({
        authenticated: false,
        userId: "user-1",
        email: "person@example.com",
      }),
    ).toEqual({
      scopeRoot: ALISIO_ACCOUNT_SCOPE_ROOT,
      source: "missing",
      authenticated: false,
      authRequired: true,
    });
  });

  it("describes an account-bound local device only when auth is active", () => {
    expect(
      buildAccountDeviceBinding({
        authenticated: true,
        accountId: "acct_primary",
        deviceId: "device-1",
        label: "MacBook Pro",
        platform: "macOS",
      }),
    ).toEqual({
      binding: "account_bound",
      runtime: "local",
      current: true,
      accountId: "acct_primary",
      deviceId: "device-1",
      label: "MacBook Pro",
      platform: "macOS",
    });

    expect(
      buildAccountDeviceBinding({
        authenticated: false,
        accountId: "acct_primary",
        deviceId: "device-1",
      }),
    ).toEqual({
      binding: "auth_required",
      runtime: "local",
      current: true,
      deviceId: "device-1",
    });
  });

  it("publishes the canonical residency split", () => {
    expect(buildAlisioDataResidencyContract()).toEqual({
      scopeRoot: ALISIO_ACCOUNT_SCOPE_ROOT,
      backendShared: [...ALISIO_BACKEND_SHARED_RESOURCES],
      localRuntime: [...ALISIO_LOCAL_RUNTIME_RESOURCES],
    });
  });

  it("builds stable account workspace segments", () => {
    expect(buildAccountWorkspaceScopeSegments(" Person@Example.com ")).toEqual([
      "accounts",
      "person-example-com",
    ]);
  });

  it("detects when a workspace is already scoped to the canonical account", () => {
    expect(
      isAccountScopedWorkspaceDir(
        "/srv/alisio/workspace/accounts/person-example-com",
        " Person@Example.com ",
      ),
    ).toBe(true);
    expect(isAccountScopedWorkspaceDir("/srv/alisio/workspace", " Person@Example.com ")).toBe(
      false,
    );
  });
});
