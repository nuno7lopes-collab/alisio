import { createCipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withTempDir } from "../test-helpers/temp-dir.js";
import {
  __testing,
  beginAlisioConnectorSetup,
  completeAlisioConnectorAuthorization,
  completeAlisioConnectorAuthorizationFromCallback,
  changeAlisioAccountEmail,
  disconnectAlisioAi,
  approveAlisioSharingRequest,
  getAlisioAccountState,
  getAlisioAiState,
  getAlisioSharingState,
  getAlisioConnectorAccessToken,
  getAlisioBootstrapSummary,
  getAlisioDoctorSummary,
  getAlisioOrganizationState,
  loadAlisioBootstrapSnapshot,
  listAlisioRemoteModelServers,
  selectAlisioRemoteModelServer,
  saveAlisioRemoteModelServer,
  listAlisioConnectorAuthorizations,
  refreshAlisioAiLimits,
  renameAlisioAiProfile,
  requestAlisioAccountRecoveryEmail,
  requestAlisioSharingAccess,
  rejectAlisioSharingRequest,
  revokeAlisioSharingGrant,
  revokeAlisioConnectorAuthorization,
  setAlisioSharingPolicy,
  setAlisioOrganizationState,
  signInAlisioAccount,
  signUpAlisioAccount,
  signOutAlisioAccount,
  summarizeAlisioConnectorAuthorizations,
  type AlisioStoredState,
  updateAlisioAccountPassword,
  updateAlisioAccountProfile,
} from "./alisio-store.js";

const CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

function parseJsonBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== "string") {
    throw new Error("Expected request body to be a JSON string.");
  }
  return JSON.parse(body) as Record<string, unknown>;
}

function resolveRequestUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) {
    return input;
  }
  if (typeof input === "string") {
    return new URL(input);
  }
  return new URL(input.url);
}

function stringifyPrimaryKey(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value).trim();
  }
  return "";
}

function alisioStateFile(root: string) {
  return path.join(root, "alisio", "state.json");
}

function createJwt(payload: Record<string, unknown>) {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

function createEncryptedStoredToken(plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(CONNECTOR_ENCRYPTION_KEY, "base64"), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

async function createReadyAlisioAccountEnv(
  root: string,
  extra: Record<string, string> = {},
): Promise<NodeJS.ProcessEnv> {
  const env = {
    ALISIO_STATE_DIR: root,
    ALISIO_SUPABASE_URL: "https://example.supabase.co",
    ALISIO_SUPABASE_ANON_KEY: "anon-key",
    ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
    ...extra,
  } as NodeJS.ProcessEnv;
  const statePath = alisioStateFile(root);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(
    statePath,
    JSON.stringify(
      {
        version: 1,
        account: {
          profile: {
            userId: "user-1",
            username: "nuno",
            displayName: "Nuno Lopes",
            email: "nuno@example.com",
            avatarLabel: "N",
            joinedAt: "2026-04-04T15:00:00.000Z",
            plan: "Free Plan",
            backend: "supabase",
          },
          preferences: {
            language: "pt-PT",
            theme: "dark",
          },
          session: {
            state: "signed_in",
            profileCompleted: true,
            signedInAt: "2026-04-04T15:00:00.000Z",
            backend: "supabase",
          },
          cloudSession: {
            backend: "supabase",
            state: "signed_out",
            userId: "user-1",
            email: "nuno@example.com",
            signedInAt: "2026-04-04T15:00:00.000Z",
            signedOutAt: "2026-04-04T15:05:00.000Z",
          },
        },
        organization: {
          mode: "none",
        },
        ai: {},
        authorizations: {},
        oauthCredentials: {},
        pendingAuthorizations: {},
      },
      null,
      2,
    ),
  );
  return env;
}

async function setStoredAlisioPlan(root: string, plan: "free" | "plus") {
  const statePath = alisioStateFile(root);
  const state = JSON.parse(await fs.readFile(statePath, "utf8")) as AlisioStoredState;
  state.account.profile.plan = plan;
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function updateStoredAlisioState(root: string, update: (state: AlisioStoredState) => void) {
  const statePath = alisioStateFile(root);
  const state = JSON.parse(await fs.readFile(statePath, "utf8")) as AlisioStoredState;
  update(state);
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function switchStoredAlisioUser(
  root: string,
  params: {
    userId: string;
    username: string;
    displayName: string;
    email: string;
    plan?: "free" | "plus";
  },
) {
  await updateStoredAlisioState(root, (state) => {
    state.account.profile = {
      ...state.account.profile,
      userId: params.userId,
      username: params.username,
      displayName: params.displayName,
      email: params.email,
      avatarLabel: params.displayName.slice(0, 1).toUpperCase() || "A",
      plan: params.plan ?? state.account.profile.plan,
    };
    state.account.session = {
      state: "signed_in",
      profileCompleted: true,
      signedInAt: "2026-04-04T15:00:00.000Z",
      backend: "supabase",
    };
    delete state.account.cloudSession;
  });
}

async function switchStoredAlisioCloudUser(
  root: string,
  params: {
    userId: string;
    username: string;
    displayName: string;
    email: string;
    accessToken: string;
    plan?: "free" | "plus";
  },
) {
  await updateStoredAlisioState(root, (state) => {
    state.account.profile = {
      ...state.account.profile,
      userId: params.userId,
      username: params.username,
      displayName: params.displayName,
      email: params.email,
      avatarLabel: params.displayName.slice(0, 1).toUpperCase() || "A",
      plan: params.plan ?? state.account.profile.plan,
      backend: "supabase",
    };
    state.account.session = {
      state: "signed_in",
      profileCompleted: true,
      signedInAt: "2026-04-04T15:00:00.000Z",
      backend: "supabase",
    };
    state.account.cloudSession = {
      backend: "supabase",
      state: "signed_in",
      userId: params.userId,
      email: params.email,
      accessToken: params.accessToken,
      refreshToken: `refresh-${params.userId}`,
      tokenType: "bearer",
      signedInAt: "2026-04-04T15:00:00.000Z",
    };
  });
}

function createSharingTarget(targetId: string, label: string) {
  return {
    targetId,
    label,
    platform: "macOS",
    sourceKind: "current" as const,
    connected: true,
    current: true,
  };
}

function createSharingCloudFetchMock() {
  const tables = {
    alisio_sharing_policies: new Map<string, Record<string, unknown>>(),
    alisio_sharing_targets: new Map<string, Record<string, unknown>>(),
    alisio_sharing_requests: new Map<string, Record<string, unknown>>(),
    alisio_sharing_grants: new Map<string, Record<string, unknown>>(),
    alisio_sharing_audit: new Map<string, Record<string, unknown>>(),
  };
  const primaryKeyByTable: Record<keyof typeof tables, string> = {
    alisio_sharing_policies: "owner_key",
    alisio_sharing_targets: "target_id",
    alisio_sharing_requests: "request_id",
    alisio_sharing_grants: "grant_id",
    alisio_sharing_audit: "entry_id",
  };

  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof Request ? input.url : String(input),
    );
    const tableName = url.pathname.split("/").at(-1) as keyof typeof tables;
    const table = tables[tableName];
    if (!table) {
      return new Response(JSON.stringify({ message: `unknown table ${tableName}` }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET") {
      let rows = [...table.values()];
      const ownerKey = url.searchParams.get("owner_key");
      if (ownerKey?.startsWith("eq.")) {
        rows = rows.filter((row) => row.owner_key === ownerKey.slice(3));
      }
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (method === "POST") {
      const rows = JSON.parse(typeof init?.body === "string" ? init.body : "[]") as Array<
        Record<string, unknown>
      >;
      const primaryKey = primaryKeyByTable[tableName];
      for (const row of rows) {
        const key = stringifyPrimaryKey(row[primaryKey]);
        if (!key) {
          continue;
        }
        table.set(key, row);
      }
      return new Response(JSON.stringify([]), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ message: `unsupported method ${method}` }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  });

  return { fetchMock, tables };
}

describe("legacy Alisio state-dir migration", () => {
  it("migrates ~/.openclaw into ~/.alisio before loading account state", async () => {
    await withTempDir({ prefix: "alisio-store-home-" }, async (home) => {
      const legacyRoot = path.join(home, ".openclaw");
      const legacyStatePath = path.join(legacyRoot, "alisio", "state.json");

      await fs.mkdir(path.dirname(legacyStatePath), { recursive: true });
      await fs.writeFile(
        legacyStatePath,
        JSON.stringify(
          {
            version: 1,
            account: {
              profile: {
                username: "nuno",
                displayName: "Nuno Lopes",
                email: "nuno@example.com",
                avatarLabel: "N",
                joinedAt: "2026-04-04T15:00:00.000Z",
                plan: "Free Plan",
              },
              preferences: {
                language: "pt-PT",
                theme: "system",
              },
              session: {
                state: "signed_in",
                profileCompleted: true,
              },
            },
            organization: {
              mode: "none",
            },
            ai: {},
            authorizations: {},
            oauthCredentials: {},
            pendingAuthorizations: {},
          },
          null,
          2,
        ),
      );

      const account = await getAlisioAccountState({
        HOME: home,
      } as NodeJS.ProcessEnv);

      expect(account.profile.displayName).toBe("Nuno Lopes");
      await expect(
        fs.stat(path.join(home, ".alisio", "alisio", "state.json")),
      ).resolves.toBeTruthy();
      await expect(fs.stat(legacyRoot)).rejects.toThrow();
    });
  });
});

describe("Alisio organization state", () => {
  it("normalizes organization values before persisting them", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await setStoredAlisioPlan(root, "plus");

      await setAlisioOrganizationState(
        {
          mode: "member",
          organizationName: "  Alisio  ",
          inviteEmail: "  team@example.com  ",
        },
        env,
      );

      expect(await getAlisioOrganizationState(env)).toEqual({
        mode: "member",
        organizationName: "Alisio",
        inviteEmail: "team@example.com",
      });
    });
  });

  it("rejects blank organization names and invalid invitation emails", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);

      await expect(
        setAlisioOrganizationState(
          {
            mode: "owner",
            organizationName: "   ",
          },
          env,
        ),
      ).rejects.toThrow("Organization name is required.");

      await expect(
        setAlisioOrganizationState(
          {
            mode: "member",
            organizationName: "Alisio",
            inviteEmail: "not-an-email",
          },
          env,
        ),
      ).rejects.toThrow("Invitation email must be a valid email address.");
    });
  });

  it("keeps organization membership behind Plus", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);

      await expect(
        setAlisioOrganizationState(
          {
            mode: "owner",
            organizationName: "Alisio",
          },
          env,
        ),
      ).rejects.toThrow("Organizations currently require Plus");
    });
  });
});

describe("Alisio sharing state", () => {
  it("auto-shares model access for linked devices on the same account and keeps exec explicit", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await setStoredAlisioPlan(root, "plus");

      await switchStoredAlisioUser(root, {
        userId: "user-owner",
        username: "owner",
        displayName: "Owner User",
        email: "owner@example.com",
        plan: "plus",
      });
      await getAlisioSharingState(
        {
          targets: [
            createSharingTarget("owner-device", "Owner Device"),
            {
              targetId: "linked-device",
              label: "Linked Device",
              platform: "macOS",
              sourceKind: "node",
              connected: true,
              current: false,
            },
          ],
        },
        env,
      );

      const initialState = await getAlisioSharingState(undefined, env);
      expect(initialState.devices.owned).toEqual([
        expect.objectContaining({
          targetId: "owner-device",
          deviceAccess: "owner",
          modelAccess: "owner",
          execAccess: "owner",
        }),
      ]);
      expect(initialState.devices.sharedWithMe).toEqual([
        expect.objectContaining({
          targetId: "linked-device",
          deviceAccess: "shared",
          modelAccess: "shared",
          execAccess: "requestable",
          grantScopes: ["read-only", "model-use"],
        }),
      ]);
      expect(initialState.devices.available).toEqual([
        expect.objectContaining({
          targetId: "linked-device",
          execAccess: "requestable",
        }),
      ]);

      const request = await requestAlisioSharingAccess(
        {
          targetId: "linked-device",
          scopes: ["exec"],
        },
        env,
      );
      expect(request).toEqual({
        ok: true,
        requestId: expect.any(String),
      });

      const grantedState = await getAlisioSharingState(undefined, env);
      expect(grantedState.devices.sharedWithMe).toEqual([
        expect.objectContaining({
          targetId: "linked-device",
          deviceAccess: "shared",
          modelAccess: "shared",
          execAccess: "shared",
          requestStatus: "approved",
          grantId: expect.any(String),
          grantScopes: ["read-only", "model-use", "exec"],
        }),
      ]);
      expect(grantedState.devices.available).toEqual([]);
      expect(grantedState.outgoingRequests).toEqual([
        expect.objectContaining({
          requestId: request.requestId,
          targetId: "linked-device",
          status: "approved",
          scopes: ["read-only", "model-use", "exec"],
          grantId: expect.any(String),
        }),
      ]);

      await revokeAlisioSharingGrant(
        {
          grantId: grantedState.devices.sharedWithMe[0]?.grantId ?? "",
        },
        env,
      );

      const revokedState = await getAlisioSharingState(undefined, env);
      expect(revokedState.devices.sharedWithMe).toEqual([
        expect.objectContaining({
          targetId: "linked-device",
          modelAccess: "shared",
          execAccess: "requestable",
          grantScopes: ["read-only", "model-use"],
        }),
      ]);
      expect(revokedState.devices.available).toEqual([
        expect.objectContaining({
          targetId: "linked-device",
          execAccess: "requestable",
        }),
      ]);
    });
  });

  it("persists request, approval, revocation, and audit for shared devices", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await setStoredAlisioPlan(root, "plus");

      await switchStoredAlisioUser(root, {
        userId: "user-owner",
        username: "owner",
        displayName: "Owner User",
        email: "owner@example.com",
        plan: "plus",
      });
      await getAlisioSharingState(
        {
          targets: [createSharingTarget("owner-device", "Owner Device")],
        },
        env,
      );

      await switchStoredAlisioUser(root, {
        userId: "user-requester",
        username: "requester",
        displayName: "Requester User",
        email: "requester@example.com",
        plan: "plus",
      });
      const request = await requestAlisioSharingAccess(
        {
          targetId: "owner-device",
          scopes: ["device.use", "model.use"],
        },
        env,
      );

      await switchStoredAlisioUser(root, {
        userId: "user-owner",
        username: "owner",
        displayName: "Owner User",
        email: "owner@example.com",
        plan: "plus",
      });
      const approval = await approveAlisioSharingRequest({ requestId: request.requestId }, env);

      await switchStoredAlisioUser(root, {
        userId: "user-requester",
        username: "requester",
        displayName: "Requester User",
        email: "requester@example.com",
        plan: "plus",
      });
      const grantedState = await getAlisioSharingState(undefined, env);
      expect(grantedState.devices.sharedWithMe).toEqual([
        expect.objectContaining({
          targetId: "owner-device",
          deviceAccess: "shared",
          modelAccess: "shared",
          grantId: approval.grantId,
        }),
      ]);

      await revokeAlisioSharingGrant({ grantId: approval.grantId }, env);

      const revokedState = await getAlisioSharingState(undefined, env);
      expect(revokedState.devices.sharedWithMe).toEqual([]);
      expect(revokedState.outgoingRequests).toEqual([
        expect.objectContaining({
          requestId: request.requestId,
          status: "revoked",
          grantId: approval.grantId,
        }),
      ]);
      expect(revokedState.audit.map((entry) => entry.action)).toEqual([
        "grant.revoked",
        "request.approved",
        "request.created",
      ]);
    });
  });

  it("persists denied requests with canonical audit actions", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await setStoredAlisioPlan(root, "plus");

      await switchStoredAlisioUser(root, {
        userId: "user-owner",
        username: "owner",
        displayName: "Owner User",
        email: "owner@example.com",
        plan: "plus",
      });
      await getAlisioSharingState(
        {
          targets: [createSharingTarget("owner-device", "Owner Device")],
        },
        env,
      );

      await switchStoredAlisioUser(root, {
        userId: "user-requester",
        username: "requester",
        displayName: "Requester User",
        email: "requester@example.com",
        plan: "plus",
      });
      const request = await requestAlisioSharingAccess(
        {
          targetId: "owner-device",
          scopes: ["exec"],
        },
        env,
      );

      await switchStoredAlisioUser(root, {
        userId: "user-owner",
        username: "owner",
        displayName: "Owner User",
        email: "owner@example.com",
        plan: "plus",
      });
      await rejectAlisioSharingRequest({ requestId: request.requestId }, env);

      await switchStoredAlisioUser(root, {
        userId: "user-requester",
        username: "requester",
        displayName: "Requester User",
        email: "requester@example.com",
        plan: "plus",
      });
      const requesterState = await getAlisioSharingState(undefined, env);

      expect(requesterState.devices.sharedWithMe).toEqual([]);
      expect(requesterState.outgoingRequests).toEqual([
        expect.objectContaining({
          requestId: request.requestId,
          status: "denied",
          scopes: ["read-only", "model-use", "exec"],
        }),
      ]);
      expect(requesterState.audit.map((entry) => entry.action)).toEqual([
        "request.denied",
        "request.created",
      ]);
    });
  });

  it("enforces organization external-use policy before allowing external requests", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await setStoredAlisioPlan(root, "plus");

      await switchStoredAlisioUser(root, {
        userId: "user-owner",
        username: "owner",
        displayName: "Org Owner",
        email: "owner@example.com",
        plan: "plus",
      });
      await setAlisioOrganizationState(
        {
          mode: "owner",
          organizationName: "Acme Labs",
        },
        env,
      );
      await getAlisioSharingState(
        {
          targets: [createSharingTarget("org-device", "Org Device")],
        },
        env,
      );

      await switchStoredAlisioUser(root, {
        userId: "user-external",
        username: "external",
        displayName: "External User",
        email: "external@example.com",
        plan: "plus",
      });
      await setAlisioOrganizationState({ mode: "none" }, env);

      await expect(
        requestAlisioSharingAccess(
          {
            targetId: "org-device",
          },
          env,
        ),
      ).rejects.toThrow("That device is not accepting external sharing requests right now.");

      await switchStoredAlisioUser(root, {
        userId: "user-owner",
        username: "owner",
        displayName: "Org Owner",
        email: "owner@example.com",
        plan: "plus",
      });
      await setAlisioOrganizationState(
        {
          mode: "owner",
          organizationName: "Acme Labs",
        },
        env,
      );
      await setAlisioSharingPolicy({ allowExternalUse: true }, env);

      await switchStoredAlisioUser(root, {
        userId: "user-external",
        username: "external",
        displayName: "External User",
        email: "external@example.com",
        plan: "plus",
      });
      await setAlisioOrganizationState({ mode: "none" }, env);

      const request = await requestAlisioSharingAccess(
        {
          targetId: "org-device",
          scopes: ["device.use"],
        },
        env,
      );
      expect(request).toEqual({
        ok: true,
        requestId: expect.any(String),
      });

      await switchStoredAlisioUser(root, {
        userId: "user-owner",
        username: "owner",
        displayName: "Org Owner",
        email: "owner@example.com",
        plan: "plus",
      });
      await setAlisioOrganizationState(
        {
          mode: "owner",
          organizationName: "Acme Labs",
        },
        env,
      );
      const ownerState = await getAlisioSharingState(undefined, env);
      expect(ownerState.policy.allowExternalUse).toBe(true);
      expect(ownerState.incomingRequests).toEqual([
        expect.objectContaining({
          requestId: request.requestId,
          targetId: "org-device",
          status: "pending",
        }),
      ]);
      expect(ownerState.audit.map((entry) => entry.action)).toEqual([
        "request.created",
        "policy.updated",
      ]);
    });
  });

  it("uses the cloud sharing tables as the source of truth when the Supabase session is active", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      const { fetchMock, tables } = createSharingCloudFetchMock();
      await setStoredAlisioPlan(root, "plus");

      vi.stubGlobal("fetch", fetchMock);
      try {
        await switchStoredAlisioCloudUser(root, {
          userId: "user-owner",
          username: "owner",
          displayName: "Owner User",
          email: "owner@example.com",
          accessToken: "owner-access-token",
          plan: "plus",
        });
        await getAlisioSharingState(
          {
            targets: [createSharingTarget("cloud-device", "Cloud Device")],
          },
          env,
        );

        await switchStoredAlisioCloudUser(root, {
          userId: "user-requester",
          username: "requester",
          displayName: "Requester User",
          email: "requester@example.com",
          accessToken: "requester-access-token",
          plan: "plus",
        });
        const request = await requestAlisioSharingAccess(
          {
            targetId: "cloud-device",
            scopes: ["exec"],
          },
          env,
        );

        await switchStoredAlisioCloudUser(root, {
          userId: "user-owner",
          username: "owner",
          displayName: "Owner User",
          email: "owner@example.com",
          accessToken: "owner-access-token",
          plan: "plus",
        });
        const approval = await approveAlisioSharingRequest(
          {
            requestId: request.requestId,
            scopes: ["read-only", "model-use"],
          },
          env,
        );

        await switchStoredAlisioCloudUser(root, {
          userId: "user-requester",
          username: "requester",
          displayName: "Requester User",
          email: "requester@example.com",
          accessToken: "requester-access-token",
          plan: "plus",
        });
        const requesterState = await getAlisioSharingState(undefined, env);

        expect(requesterState.devices.sharedWithMe).toEqual([
          expect.objectContaining({
            targetId: "cloud-device",
            deviceAccess: "shared",
            modelAccess: "shared",
            execAccess: "requestable",
            grantId: approval.grantId,
            grantScopes: ["read-only", "model-use"],
          }),
        ]);
        expect(requesterState.outgoingRequests).toEqual([
          expect.objectContaining({
            requestId: request.requestId,
            status: "approved",
            grantId: approval.grantId,
            scopes: ["read-only", "model-use"],
          }),
        ]);

        const persisted = JSON.parse(
          await fs.readFile(alisioStateFile(root), "utf8"),
        ) as AlisioStoredState;
        expect(persisted.sharing).toBeUndefined();
        expect([...tables.alisio_sharing_targets.values()]).toEqual([
          expect.objectContaining({
            target_id: "cloud-device",
            owner_key: "user:user-owner",
          }),
        ]);
        expect([...tables.alisio_sharing_requests.values()]).toEqual([
          expect.objectContaining({
            request_id: request.requestId,
            target_id: "cloud-device",
            status: "approved",
            scopes: ["read-only", "model-use"],
            grant_id: approval.grantId,
          }),
        ]);
        expect([...tables.alisio_sharing_grants.values()]).toEqual([
          expect.objectContaining({
            grant_id: approval.grantId,
            request_id: request.requestId,
            scopes: ["read-only", "model-use"],
          }),
        ]);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});

describe("beginAlisioConnectorSetup", () => {
  it("treats the connector token keychain as unavailable when macOS has no default user keychain", () => {
    const env = {
      HOME: "/Users/nuno",
    } as NodeJS.ProcessEnv;
    const execFileSyncMock = vi.fn(() => {
      throw new Error("A default keychain could not be found");
    });

    expect(
      __testing.hasUsableConnectorTokenKeychain(env, execFileSyncMock as never, "darwin"),
    ).toBe(false);
    expect(execFileSyncMock).toHaveBeenCalledWith(
      "security",
      ["default-keychain", "-d", "user"],
      expect.objectContaining({
        encoding: "utf8",
      }),
    );
  });

  it("accepts the connector token keychain when macOS reports a default user keychain", () => {
    const env = {
      HOME: "/Users/nuno",
    } as NodeJS.ProcessEnv;
    const execFileSyncMock = vi.fn(() => '"/Users/nuno/Library/Keychains/login.keychain-db"\n');

    expect(
      __testing.hasUsableConnectorTokenKeychain(env, execFileSyncMock as never, "darwin"),
    ).toBe(true);
  });

  it("looks up connector token keychain secrets under current and legacy state-dir accounts", () => {
    const env = {
      HOME: "/Users/nuno",
    } as NodeJS.ProcessEnv;
    const accountFor = (stateRoot: string) =>
      `state|${createHash("sha256").update(path.resolve(stateRoot)).digest("hex").slice(0, 16)}`;

    expect(__testing.resolveConnectorTokenKeychainAccounts(env)).toEqual([
      accountFor("/Users/nuno/.alisio"),
      accountFor("/Users/nuno/.openclaw"),
      accountFor("/Users/nuno/.clawdbot"),
    ]);
  });

  it("returns an honest setup fallback when OAuth client config is missing", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      const result = await beginAlisioConnectorSetup("google-docs", env);

      expect(result).toMatchObject({
        connectorId: "google-docs",
        availability: "ready",
        mode: "setup",
        provider: "google",
        providerLabel: "Google",
        statusReason: "missing_client_config",
        callbackPath: "/oauth/google/callback",
        requiredEnvVars: [
          "ALISIO_GOOGLE_CLIENT_ID",
          "ALISIO_GOOGLE_CLIENT_SECRET",
          "ALISIO_GOOGLE_REDIRECT_URI",
          "ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY",
        ],
      });
      expect(result?.setupUrl).toContain("developers.google.com");
    });
  });

  it("reports missing token encryption separately when OAuth client config exists but secure storage is unavailable", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: "",
      });
      const result = await beginAlisioConnectorSetup("google-docs", env);

      expect(result).toMatchObject({
        connectorId: "google-docs",
        availability: "ready",
        mode: "setup",
        provider: "google",
        providerLabel: "Google",
        statusReason: "missing_token_encryption",
        callbackPath: "/oauth/google/callback",
        requiredEnvVars: [
          "ALISIO_GOOGLE_CLIENT_ID",
          "ALISIO_GOOGLE_CLIENT_SECRET",
          "ALISIO_GOOGLE_REDIRECT_URI",
          "ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY",
        ],
      });
    });
  });

  it("builds a real Google OAuth authorization URL when client config exists", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const result = await beginAlisioConnectorSetup("gmail-send", env);

      expect(result).toMatchObject({
        connectorId: "gmail-send",
        availability: "ready",
        mode: "oauth",
        provider: "google",
        providerLabel: "Google",
        redirectUri: "http://127.0.0.1:8787/oauth/google/callback",
        statusReason: "ready_for_oauth",
        callbackPath: "/oauth/google/callback",
      });
      const launchUrl = new URL(result?.setupUrl ?? "");
      expect(`${launchUrl.origin}${launchUrl.pathname}`).toBe(
        "https://accounts.google.com/o/oauth2/v2/auth",
      );
      expect(launchUrl.searchParams.get("client_id")).toBe("google-client-id");
      expect(launchUrl.searchParams.get("redirect_uri")).toBe(
        "http://127.0.0.1:8787/oauth/google/callback",
      );
      expect(launchUrl.searchParams.get("response_type")).toBe("code");
      expect(launchUrl.searchParams.get("access_type")).toBe("offline");
      expect(launchUrl.searchParams.get("include_granted_scopes")).toBe("true");
      expect(launchUrl.searchParams.get("prompt")).toBe("select_account consent");
      expect(launchUrl.searchParams.get("code_challenge_method")).toBe("S256");
      expect(launchUrl.searchParams.get("scope")).toContain(
        "https://www.googleapis.com/auth/gmail.send",
      );
      expect(launchUrl.searchParams.get("scope")).toContain("openid");
      expect(launchUrl.searchParams.get("scope")).toContain("email");
      expect(launchUrl.searchParams.get("state")).toBeTruthy();
    });
  });

  it("builds a hardened GitHub OAuth authorization URL when client config exists", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GITHUB_CLIENT_ID: "github-client-id",
        ALISIO_GITHUB_CLIENT_SECRET: "github-client-secret",
        ALISIO_GITHUB_REDIRECT_URI: "http://127.0.0.1:8787/oauth/github/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const result = await beginAlisioConnectorSetup("github", env);

      expect(result).toMatchObject({
        connectorId: "github",
        availability: "ready",
        mode: "oauth",
        provider: "github",
        providerLabel: "GitHub",
        redirectUri: "http://127.0.0.1:8787/oauth/github/callback",
        statusReason: "ready_for_oauth",
        callbackPath: "/oauth/github/callback",
      });
      const launchUrl = new URL(result?.setupUrl ?? "");
      expect(`${launchUrl.origin}${launchUrl.pathname}`).toBe(
        "https://github.com/login/oauth/authorize",
      );
      expect(launchUrl.searchParams.get("client_id")).toBe("github-client-id");
      expect(launchUrl.searchParams.get("redirect_uri")).toBe(
        "http://127.0.0.1:8787/oauth/github/callback",
      );
      expect(launchUrl.searchParams.get("prompt")).toBe("select_account");
      expect(launchUrl.searchParams.get("code_challenge_method")).toBe("S256");
      expect(launchUrl.searchParams.get("scope")).toContain("repo");
      expect(launchUrl.searchParams.get("state")).toBeTruthy();
    });
  });

  it("blocks new connector connections on Free after the first connected app", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
      });
      const firstBegin = await beginAlisioConnectorSetup("google-calendar", env);
      const launchUrl = new URL(firstBegin?.setupUrl ?? "");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "google-access",
              refresh_token: "google-refresh",
              expires_in: 3600,
              token_type: "Bearer",
              scope: "openid email https://www.googleapis.com/auth/calendar",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              sub: "google-user-1",
              name: "Nuno Lopes",
              email: "nuno@example.com",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "google",
          stateToken: launchUrl.searchParams.get("state"),
          code: "google-code",
        },
        env,
        fetchMock,
      );

      await expect(beginAlisioConnectorSetup("gmail-send", env)).rejects.toThrow(
        "Free includes 1 connected app.",
      );
    });
  });

  it("blocks new connector connections on Free when the existing slot only needs reconnect", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
      });
      const firstBegin = await beginAlisioConnectorSetup("google-calendar", env);
      const launchUrl = new URL(firstBegin?.setupUrl ?? "");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "google-access",
              refresh_token: "google-refresh",
              expires_in: 3600,
              token_type: "Bearer",
              scope: "openid email https://www.googleapis.com/auth/calendar",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              sub: "google-user-1",
              name: "Nuno Lopes",
              email: "nuno@example.com",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "google",
          stateToken: launchUrl.searchParams.get("state"),
          code: "google-code",
        },
        env,
        fetchMock,
      );

      const statePath = alisioStateFile(root);
      const state = JSON.parse(await fs.readFile(statePath, "utf8")) as AlisioStoredState;
      state.authorizations["google-calendar"] = {
        ...state.authorizations["google-calendar"],
        state: "needs_reconnect",
        health: "needs_reconnect",
      };
      await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

      await expect(beginAlisioConnectorSetup("gmail-send", env)).rejects.toThrow(
        "Free includes 1 connected app.",
      );
    });
  });

  it("completes a Gmail Send callback with the exact Gmail send scope", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const begin = await beginAlisioConnectorSetup("gmail-send", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "gmail-send-access",
              refresh_token: "gmail-send-refresh",
              expires_in: 3600,
              token_type: "Bearer",
              scope: "https://www.googleapis.com/auth/gmail.send openid email",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              sub: "google-user-1",
              name: "Nuno Lopes",
              email: "nuno@example.com",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      const result = await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "google",
          stateToken: launchUrl.searchParams.get("state"),
          code: "google-code",
        },
        env,
        fetchMock,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.authorization.connectorId).toBe("gmail-send");
        expect(result.authorization.scopes).toEqual([
          "https://www.googleapis.com/auth/gmail.send",
          "openid",
          "email",
        ]);
        expect(result.authorization.connectedAccount?.email).toBe("nuno@example.com");
      }
      const persistedState = await fs.readFile(alisioStateFile(root), "utf8");
      expect(persistedState).not.toContain("gmail-send-access");
      expect(persistedState).not.toContain("gmail-send-refresh");
    });
  });

  it("accepts Google's canonical userinfo email scope alias during callback validation", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const begin = await beginAlisioConnectorSetup("gmail-send", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "gmail-send-access",
              refresh_token: "gmail-send-refresh",
              expires_in: 3600,
              token_type: "Bearer",
              scope:
                "https://www.googleapis.com/auth/gmail.send openid https://www.googleapis.com/auth/userinfo.email",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              sub: "google-user-1",
              email: "nuno@example.com",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      const result = await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "google",
          stateToken: launchUrl.searchParams.get("state"),
          code: "google-code",
        },
        env,
        fetchMock,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.authorization.scopes).toEqual([
          "https://www.googleapis.com/auth/gmail.send",
          "openid",
          "email",
        ]);
      }
    });
  });

  it("falls back to the Google ID token when userinfo is unavailable", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const begin = await beginAlisioConnectorSetup("gmail-send", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");
      const idToken = createJwt({
        sub: "google-user-1",
        email: "nuno@example.com",
        name: "Nuno Lopes",
      });
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "gmail-send-access",
              refresh_token: "gmail-send-refresh",
              expires_in: 3600,
              token_type: "Bearer",
              id_token: idToken,
              scope: "https://www.googleapis.com/auth/gmail.send",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          }),
        );

      const result = await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "google",
          stateToken: launchUrl.searchParams.get("state"),
          code: "google-code",
        },
        env,
        fetchMock,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.authorization.connectedAccount).toEqual({
          label: "Nuno Lopes",
          email: "nuno@example.com",
          handle: "google-user-1",
        });
        expect(result.authorization.scopes).toEqual(["https://www.googleapis.com/auth/gmail.send"]);
      }
    });
  });

  it("completes a Google OAuth callback and persists the authorization", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const begin = await beginAlisioConnectorSetup("google-calendar", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "google-access",
              refresh_token: "google-refresh",
              expires_in: 3600,
              token_type: "Bearer",
              scope: "openid email https://www.googleapis.com/auth/calendar",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              sub: "google-user-1",
              name: "Nuno Lopes",
              email: "nuno@example.com",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      const result = await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "google",
          stateToken: launchUrl.searchParams.get("state"),
          code: "google-code",
        },
        env,
        fetchMock,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.authorization.connectedAccount?.email).toBe("nuno@example.com");
      }
      const authorizations = await listAlisioConnectorAuthorizations(env);
      expect(authorizations.find((entry) => entry.connectorId === "google-calendar")?.state).toBe(
        "connected",
      );
      expect(
        authorizations.find((entry) => entry.connectorId === "google-calendar")?.scopes,
      ).toEqual(["openid", "email", "https://www.googleapis.com/auth/calendar"]);
      const persistedState = await fs.readFile(alisioStateFile(root), "utf8");
      expect(persistedState).not.toContain("google-access");
      expect(persistedState).not.toContain("google-refresh");
    });
  });

  it("fails cleanly when the token exchange request throws", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const begin = await beginAlisioConnectorSetup("google-calendar", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");

      const result = await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "google",
          stateToken: launchUrl.searchParams.get("state"),
          code: "google-code",
        },
        env,
        vi.fn<typeof fetch>().mockRejectedValue(new Error("network down")),
      );

      expect(result).toMatchObject({
        ok: false,
        reason: "token_exchange_failed",
      });
    });
  });

  it("completes a GitHub OAuth callback and uses the primary email fallback", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GITHUB_CLIENT_ID: "github-client-id",
        ALISIO_GITHUB_CLIENT_SECRET: "github-client-secret",
        ALISIO_GITHUB_REDIRECT_URI: "http://127.0.0.1:8787/oauth/github/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const begin = await beginAlisioConnectorSetup("github", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "github-access",
              token_type: "bearer",
              scope: "repo read:user user:email read:org gist",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              login: "nunolopes",
              name: "Nuno Lopes",
              email: null,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([{ email: "nuno@github.example", primary: true, verified: true }]),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      const result = await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "github",
          stateToken: launchUrl.searchParams.get("state"),
          code: "github-code",
        },
        env,
        fetchMock,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.authorization.connectedAccount?.handle).toBe("nunolopes");
        expect(result.authorization.connectedAccount?.email).toBe("nuno@github.example");
      }
    });
  });

  it("refreshes expired Google connector tokens before returning an access token", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const begin = await beginAlisioConnectorSetup("google-calendar", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");
      const initialFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "google-access",
              refresh_token: "google-refresh",
              expires_in: 3600,
              token_type: "Bearer",
              scope: "openid email https://www.googleapis.com/auth/calendar",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              sub: "google-user-1",
              name: "Nuno Lopes",
              email: "nuno@example.com",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "google",
          stateToken: launchUrl.searchParams.get("state"),
          code: "google-code",
        },
        env,
        initialFetch,
      );

      const statePath = alisioStateFile(root);
      const state = JSON.parse(await fs.readFile(statePath, "utf8")) as {
        oauthCredentials: Record<string, { expiresAt?: string }>;
      };
      state.oauthCredentials["google-calendar"].expiresAt = new Date(
        Date.now() - 5 * 60 * 1000,
      ).toISOString();
      await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

      const refreshFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "google-access-refreshed",
            expires_in: 1800,
            token_type: "Bearer",
            scope: "openid email https://www.googleapis.com/auth/calendar",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const token = await getAlisioConnectorAccessToken("google-calendar", env, refreshFetch);

      expect(token).toBe("google-access-refreshed");
      const persistedState = await fs.readFile(statePath, "utf8");
      expect(persistedState).not.toContain("google-access-refreshed");
      expect(persistedState).not.toContain("google-refresh");
    });
  });

  it("marks expired GitHub connector auth as needing reconnect when no refresh token exists", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GITHUB_CLIENT_ID: "github-client-id",
        ALISIO_GITHUB_CLIENT_SECRET: "github-client-secret",
        ALISIO_GITHUB_REDIRECT_URI: "http://127.0.0.1:8787/oauth/github/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const begin = await beginAlisioConnectorSetup("github", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "github-access",
              token_type: "bearer",
              scope: "repo read:user user:email read:org gist",
              expires_in: 1,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              login: "nunolopes",
              name: "Nuno Lopes",
              email: "nuno@github.example",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "github",
          stateToken: launchUrl.searchParams.get("state"),
          code: "github-code",
        },
        env,
        fetchMock,
      );

      const statePath = alisioStateFile(root);
      const state = JSON.parse(await fs.readFile(statePath, "utf8")) as {
        oauthCredentials: Record<string, { expiresAt?: string }>;
      };
      state.oauthCredentials.github.expiresAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

      const authorizations = await listAlisioConnectorAuthorizations(env);

      expect(authorizations.find((entry) => entry.connectorId === "github")).toMatchObject({
        state: "needs_reconnect",
        health: "needs_reconnect",
      });
    });
  });

  it("marks ready connectors as config missing when the gateway OAuth app is not configured", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const authorizations = await listAlisioConnectorAuthorizations({
        ALISIO_STATE_DIR: root,
      } as NodeJS.ProcessEnv);

      expect(authorizations.find((entry) => entry.connectorId === "gmail-send")).toMatchObject({
        state: "not_connected",
        health: "config_missing",
      });
      expect(authorizations.find((entry) => entry.connectorId === "github")).toMatchObject({
        state: "not_connected",
        health: "config_missing",
      });
      expect(authorizations.find((entry) => entry.connectorId === "facebook")).toMatchObject({
        state: "not_connected",
        health: "in_review",
      });
    });
  });

  it("rejects expired pending OAuth requests", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-01T10:00:00.000Z"));
      try {
        const env = await createReadyAlisioAccountEnv(root, {
          ALISIO_GITHUB_CLIENT_ID: "github-client-id",
          ALISIO_GITHUB_CLIENT_SECRET: "github-client-secret",
          ALISIO_GITHUB_REDIRECT_URI: "http://127.0.0.1:8787/oauth/github/callback",
          ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
        });
        const begin = await beginAlisioConnectorSetup("github", env);
        const launchUrl = new URL(begin?.setupUrl ?? "");

        vi.setSystemTime(new Date("2026-04-01T10:20:00.000Z"));

        const result = await completeAlisioConnectorAuthorizationFromCallback(
          {
            provider: "github",
            stateToken: launchUrl.searchParams.get("state"),
            code: "github-code",
          },
          env,
          vi.fn<typeof fetch>(),
        );

        expect(result).toMatchObject({
          ok: false,
          reason: "pending_not_found",
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("rejects callbacks when the redirect URI changed after begin", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GITHUB_CLIENT_ID: "github-client-id",
        ALISIO_GITHUB_CLIENT_SECRET: "github-client-secret",
        ALISIO_GITHUB_REDIRECT_URI: "http://127.0.0.1:8787/oauth/github/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const begin = await beginAlisioConnectorSetup("github", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");

      const result = await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "github",
          stateToken: launchUrl.searchParams.get("state"),
          code: "github-code",
        },
        {
          ...env,
          ALISIO_GITHUB_REDIRECT_URI: "http://127.0.0.1:9999/oauth/github/callback",
        } as NodeJS.ProcessEnv,
        vi.fn<typeof fetch>(),
      );

      expect(result).toMatchObject({
        ok: false,
        reason: "missing_client_config",
      });
    });
  });

  it("rejects callbacks honestly when secure token storage disappears before completion", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GITHUB_CLIENT_ID: "github-client-id",
        ALISIO_GITHUB_CLIENT_SECRET: "github-client-secret",
        ALISIO_GITHUB_REDIRECT_URI: "http://127.0.0.1:8787/oauth/github/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const begin = await beginAlisioConnectorSetup("github", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");
      delete env.ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY;

      const result = await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "github",
          stateToken: launchUrl.searchParams.get("state"),
          code: "github-code",
        },
        env,
        vi.fn<typeof fetch>(),
      );

      expect(result).toMatchObject({
        ok: false,
        reason: "missing_token_encryption",
      });
    });
  });

  it("revokes Google on disconnect before removing the local connector state", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const begin = await beginAlisioConnectorSetup("google-calendar", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");
      const setupFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "google-access",
              refresh_token: "google-refresh",
              expires_in: 3600,
              token_type: "Bearer",
              scope: "openid email https://www.googleapis.com/auth/calendar",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              sub: "google-user-1",
              name: "Nuno Lopes",
              email: "nuno@example.com",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "google",
          stateToken: launchUrl.searchParams.get("state"),
          code: "google-code",
        },
        env,
        setupFetch,
      );

      const revokeFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response("", { status: 200 }));
      const result = await revokeAlisioConnectorAuthorization("google-calendar", env, revokeFetch);

      expect(result).toMatchObject({
        connectorId: "google-calendar",
        state: "not_connected",
      });
      expect(revokeFetch).toHaveBeenCalledWith(
        "https://oauth2.googleapis.com/revoke",
        expect.objectContaining({
          method: "POST",
        }),
      );
      const persistedState = await fs.readFile(alisioStateFile(root), "utf8");
      expect(persistedState).not.toContain("google-calendar");
    });
  });

  it("keeps in-review connectors honest instead of pretending OAuth is ready", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      const [facebook, notion, vercel] = await Promise.all([
        beginAlisioConnectorSetup("facebook", env),
        beginAlisioConnectorSetup("notion", env),
        beginAlisioConnectorSetup("vercel", env),
      ]);

      expect(facebook).toMatchObject({
        connectorId: "facebook",
        availability: "in_review",
        mode: "setup",
        statusReason: "review_required",
      });
      expect(notion).toMatchObject({
        connectorId: "notion",
        availability: "in_review",
        mode: "setup",
        statusReason: "review_required",
        provider: "notion",
        providerLabel: "Notion",
        requiredEnvVars: [
          "ALISIO_NOTION_CLIENT_ID",
          "ALISIO_NOTION_CLIENT_SECRET",
          "ALISIO_NOTION_REDIRECT_URI",
        ],
      });
      expect(vercel).toMatchObject({
        connectorId: "vercel",
        availability: "in_review",
        mode: "setup",
        statusReason: "review_required",
        provider: "vercel",
        providerLabel: "Vercel",
        requiredEnvVars: [
          "ALISIO_VERCEL_CLIENT_ID",
          "ALISIO_VERCEL_CLIENT_SECRET",
          "ALISIO_VERCEL_REDIRECT_URI",
        ],
      });
    });
  });

  it("does not allow manual completion for connectors that are still in review", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      const result = await completeAlisioConnectorAuthorization(
        {
          connectorId: "notion",
        },
        env,
      );

      expect(result).toBeNull();
    });
  });

  it("does not allow manual completion for Google and GitHub connectors", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      const google = await completeAlisioConnectorAuthorization(
        {
          connectorId: "google-calendar",
        },
        env,
      );
      const github = await completeAlisioConnectorAuthorization(
        {
          connectorId: "github",
        },
        env,
      );

      expect(google).toBeNull();
      expect(github).toBeNull();
    });
  });

  it("builds a bootstrap snapshot with connector summary counts", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const snapshot = await loadAlisioBootstrapSnapshot({
        ALISIO_STATE_DIR: root,
      } as NodeJS.ProcessEnv);

      expect(snapshot.account.profile.username).toBeTruthy();
      expect(snapshot.organization.mode).toBe("none");
      expect(snapshot.connectors.catalog.length).toBeGreaterThan(0);
      expect(snapshot.connectors.authorizations.length).toBe(snapshot.connectors.catalog.length);
      expect(snapshot.connectors.summary.total).toBe(snapshot.connectors.catalog.length);
      expect(snapshot.connectors.summary.connected).toBe(0);
      expect(snapshot.connectors.summary.inReview).toBeGreaterThan(0);
    });
  });

  it("hides preserved organization and connector state after logout, then restores it for the same account", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      await setStoredAlisioPlan(root, "plus");
      await setAlisioOrganizationState(
        {
          mode: "owner",
          organizationName: "Alisio",
        },
        env,
      );
      const begin = await beginAlisioConnectorSetup("google-calendar", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "google-access",
              refresh_token: "google-refresh",
              expires_in: 3600,
              token_type: "Bearer",
              scope: "openid email https://www.googleapis.com/auth/calendar",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              sub: "google-user-1",
              name: "Nuno Lopes",
              email: "nuno@example.com",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "google",
          stateToken: launchUrl.searchParams.get("state"),
          code: "google-code",
        },
        env,
        fetchMock,
      );

      await signOutAlisioAccount(env);

      expect(await getAlisioOrganizationState(env)).toEqual({ mode: "none" });
      expect(
        (await listAlisioConnectorAuthorizations(env)).find(
          (entry) => entry.connectorId === "google-calendar",
        ),
      ).toMatchObject({
        state: "not_connected",
      });

      const signInFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "supabase-access",
              refresh_token: "supabase-refresh",
              expires_in: 3600,
              token_type: "bearer",
              user: {
                id: "user-1",
                email: "nuno@example.com",
                created_at: "2026-04-04T15:00:00.000Z",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              {
                user_id: "user-1",
                email: "nuno@example.com",
                display_name: "Nuno Lopes",
                username: "nuno",
                avatar_label: "N",
                joined_at: "2026-04-04T15:00:00.000Z",
                plan: "plus",
                profile_completed: true,
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      vi.stubGlobal("fetch", signInFetch);
      try {
        await signInAlisioAccount(
          {
            email: "nuno@example.com",
            password: "password123",
          },
          env,
        );
      } finally {
        vi.unstubAllGlobals();
      }

      expect(await getAlisioOrganizationState(env)).toEqual({
        mode: "owner",
        organizationName: "Alisio",
      });
      expect(
        (await listAlisioConnectorAuthorizations(env)).find(
          (entry) => entry.connectorId === "google-calendar",
        ),
      ).toMatchObject({
        state: "connected",
      });
    });
  });

  it("clears preserved organization and connector state when a different account signs in", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      await setStoredAlisioPlan(root, "plus");
      await setAlisioOrganizationState(
        {
          mode: "owner",
          organizationName: "Alisio",
        },
        env,
      );
      const begin = await beginAlisioConnectorSetup("google-calendar", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "google-access",
              refresh_token: "google-refresh",
              expires_in: 3600,
              token_type: "Bearer",
              scope: "openid email https://www.googleapis.com/auth/calendar",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              sub: "google-user-1",
              name: "Nuno Lopes",
              email: "nuno@example.com",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "google",
          stateToken: launchUrl.searchParams.get("state"),
          code: "google-code",
        },
        env,
        fetchMock,
      );

      const otherAccountFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              user: {
                id: "user-2",
                email: "other@example.com",
                created_at: "2026-04-04T16:00:00.000Z",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "other-access",
              refresh_token: "other-refresh",
              expires_in: 3600,
              token_type: "bearer",
              user: {
                id: "user-2",
                email: "other@example.com",
                created_at: "2026-04-04T16:00:00.000Z",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              {
                user_id: "user-2",
                email: "other@example.com",
                display_name: "Other",
                username: "other",
                avatar_label: "O",
                joined_at: "2026-04-04T16:00:00.000Z",
                plan: "Free Plan",
                profile_completed: false,
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              {
                user_id: "user-2",
                email: "other@example.com",
                display_name: "Other User",
                username: "other",
                avatar_label: "OU",
                joined_at: "2026-04-04T16:00:00.000Z",
                plan: "Free Plan",
                profile_completed: true,
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      vi.stubGlobal("fetch", otherAccountFetch);
      try {
        await signUpAlisioAccount(
          {
            email: "other@example.com",
            password: "password123",
          },
          env,
        );
        await updateAlisioAccountProfile(
          {
            username: "other",
            displayName: "Other User",
            email: "other@example.com",
            termsAcceptedAt: "2026-04-04T16:05:00.000Z",
          },
          env,
        );
      } finally {
        vi.unstubAllGlobals();
      }

      expect(await getAlisioOrganizationState(env)).toEqual({ mode: "none" });
      expect(
        (await listAlisioConnectorAuthorizations(env)).find(
          (entry) => entry.connectorId === "google-calendar",
        ),
      ).toMatchObject({
        state: "not_connected",
      });
    });
  });

  it("normalizes usernames to lowercase when saving the local account", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const account = await updateAlisioAccountProfile(
        {
          username: "Nuno.Lopes",
          displayName: "Nuno Lopes",
          email: "nuno@example.com",
          termsAcceptedAt: "2026-04-04T16:00:00.000Z",
        },
        {
          ALISIO_STATE_DIR: root,
        } as NodeJS.ProcessEnv,
      );

      expect(account.profile.username).toBe("nuno.lopes");
    });
  });

  it("persists a custom Alisio agent name on the local account profile", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = {
        ALISIO_STATE_DIR: root,
      } as NodeJS.ProcessEnv;

      const account = await updateAlisioAccountProfile(
        {
          username: "nuno",
          displayName: "Nuno Lopes",
          email: "nuno@example.com",
          agentName: "Muse",
          termsAcceptedAt: "2026-04-04T16:00:00.000Z",
        },
        env,
      );

      expect(account.profile.agentName).toBe("Muse");
      expect((await getAlisioAccountState(env)).profile.agentName).toBe("Muse");
    });
  });

  it("rejects invalid usernames for the local account", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      await expect(
        updateAlisioAccountProfile(
          {
            username: "nuno!",
            displayName: "Nuno Lopes",
            email: "nuno@example.com",
          },
          {
            ALISIO_STATE_DIR: root,
          } as NodeJS.ProcessEnv,
        ),
      ).rejects.toThrow("Use only letters, numbers, dots, and underscores.");
    });
  });

  it("keeps the Supabase auth email authoritative when saving account profile changes", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const statePath = alisioStateFile(root);
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      await fs.writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            account: {
              profile: {
                userId: "user-1",
                username: "nuno",
                displayName: "Nuno Lopes",
                email: "nuno@example.com",
                avatarLabel: "N",
                joinedAt: "2026-04-04T15:00:00.000Z",
                plan: "Free Plan",
                backend: "supabase",
              },
              preferences: {
                language: "pt-PT",
                theme: "dark",
              },
              session: {
                state: "signed_in",
                profileCompleted: true,
                signedInAt: "2026-04-04T15:00:00.000Z",
                backend: "supabase",
              },
              cloudSession: {
                backend: "supabase",
                state: "signed_in",
                userId: "user-1",
                email: "nuno@example.com",
                accessToken: "access-token",
                refreshToken: "refresh-token",
                signedInAt: "2026-04-04T15:00:00.000Z",
              },
            },
            organization: {
              mode: "none",
            },
            ai: {},
            authorizations: {},
            oauthCredentials: {},
            pendingAuthorizations: {},
          },
          null,
          2,
        ),
      );

      const env = {
        ALISIO_STATE_DIR: root,
        ALISIO_SUPABASE_URL: "https://example.supabase.co",
        ALISIO_SUPABASE_ANON_KEY: "anon-key",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      } as NodeJS.ProcessEnv;
      const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
        const payload = parseJsonBody(init?.body);
        expect(payload.email).toBe("nuno@example.com");
        return new Response(JSON.stringify([payload]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      vi.stubGlobal("fetch", fetchMock);
      try {
        const account = await updateAlisioAccountProfile(
          {
            displayName: "Nuno Cloud",
            email: "other@example.com",
          },
          env,
        );

        expect(account.profile.displayName).toBe("Nuno Cloud");
        expect(account.profile.email).toBe("nuno@example.com");
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it("keeps local preferences updates off the Supabase write path", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      const fetchMock = vi.fn<typeof fetch>();

      vi.stubGlobal("fetch", fetchMock);
      try {
        const account = await updateAlisioAccountProfile(
          {
            language: "en",
            theme: "system",
          },
          env,
        );

        expect(fetchMock).not.toHaveBeenCalled();
        expect(account.preferences).toMatchObject({
          language: "en",
          theme: "system",
        });
        expect(account.profile.displayName).toBe("Nuno Lopes");
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it("forwards the Alisio recovery callback URL to Supabase", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
        const url = resolveRequestUrl(input);
        expect(url.pathname).toBe("/auth/v1/recover");
        expect(url.searchParams.get("redirect_to")).toBe(
          "http://localhost:18789/logout/setup?step=account",
        );
        expect(parseJsonBody(init?.body)).toEqual({
          email: "nuno@example.com",
        });
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      vi.stubGlobal("fetch", fetchMock);
      try {
        const result = await requestAlisioAccountRecoveryEmail(
          {
            email: "Nuno@example.com",
            callbackUrl: "http://localhost:18789/logout/setup?step=account",
          },
          env,
        );

        expect(result).toEqual({
          ok: true,
          message: "If this Alisio account exists, a recovery email is on its way.",
        });
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it("starts a Supabase email change with the Alisio callback URL", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      const statePath = alisioStateFile(root);
      const persisted = JSON.parse(await fs.readFile(statePath, "utf8")) as AlisioStoredState;
      persisted.account.cloudSession = {
        backend: "supabase",
        state: "signed_in",
        authMethod: "email",
        userId: "user-1",
        email: "nuno@example.com",
        accessToken: "supabase-access",
        refreshToken: "supabase-refresh",
        signedInAt: "2026-04-04T15:00:00.000Z",
      };
      await fs.writeFile(statePath, JSON.stringify(persisted, null, 2));

      const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
        const url = resolveRequestUrl(input);
        expect(url.pathname).toBe("/auth/v1/user");
        expect(url.searchParams.get("redirect_to")).toBe("http://localhost:18789/logout/settings");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer supabase-access");
        expect(parseJsonBody(init?.body)).toEqual({
          email: "next@example.com",
        });
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      vi.stubGlobal("fetch", fetchMock);
      try {
        const result = await changeAlisioAccountEmail(
          {
            email: "Next@example.com",
            callbackUrl: "http://localhost:18789/logout/settings",
          },
          env,
        );

        expect(result).toEqual({
          ok: true,
          message: "Check your new email inbox to confirm the change.",
        });
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it("updates the Supabase password for a signed-in Alisio account", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      const statePath = alisioStateFile(root);
      const persisted = JSON.parse(await fs.readFile(statePath, "utf8")) as AlisioStoredState;
      persisted.account.cloudSession = {
        backend: "supabase",
        state: "signed_in",
        authMethod: "email",
        userId: "user-1",
        email: "nuno@example.com",
        accessToken: "supabase-access",
        refreshToken: "supabase-refresh",
        signedInAt: "2026-04-04T15:00:00.000Z",
      };
      await fs.writeFile(statePath, JSON.stringify(persisted, null, 2));

      const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
        const url = resolveRequestUrl(input);
        expect(url.pathname).toBe("/auth/v1/user");
        expect(url.searchParams.get("redirect_to")).toBeNull();
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer supabase-access");
        expect(parseJsonBody(init?.body)).toEqual({
          password: "password123",
        });
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      vi.stubGlobal("fetch", fetchMock);
      try {
        const result = await updateAlisioAccountPassword(
          {
            password: "password123",
          },
          env,
        );

        expect(result).toEqual({
          ok: true,
          message: "Your Alisio password was updated.",
        });
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it("repairs an incomplete cloud profile from the stored account when the same user signs in", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      const statePath = alisioStateFile(root);
      const persisted = JSON.parse(await fs.readFile(statePath, "utf8")) as AlisioStoredState;
      persisted.account.session = {
        state: "signed_out",
        profileCompleted: true,
        backend: "supabase",
        signedOutAt: "2026-04-05T09:00:00.000Z",
      };
      persisted.account.cloudSession = {
        backend: "supabase",
        state: "signed_out",
        userId: "user-1",
        email: "nuno@example.com",
        signedOutAt: "2026-04-05T09:00:00.000Z",
      };
      await fs.writeFile(statePath, JSON.stringify(persisted, null, 2));

      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "supabase-access",
              refresh_token: "supabase-refresh",
              expires_in: 3600,
              token_type: "bearer",
              user: {
                id: "user-1",
                email: "nuno@example.com",
                created_at: "2026-04-04T15:00:00.000Z",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              {
                user_id: "user-1",
                email: "nuno@example.com",
                display_name: "Cloud Seed",
                username: "cloud.seed",
                avatar_label: "CS",
                joined_at: "2026-04-04T15:00:00.000Z",
                plan: "Free Plan",
                profile_completed: false,
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockImplementationOnce(async (_input, init) => {
          const payload = parseJsonBody(init?.body);
          expect(payload.email).toBe("nuno@example.com");
          expect(payload.display_name).toBe("Nuno Lopes");
          expect(payload.username).toBe("nuno");
          expect(payload.profile_completed).toBe(true);
          return new Response(JSON.stringify([payload]), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        });

      vi.stubGlobal("fetch", fetchMock);
      try {
        const account = await signInAlisioAccount(
          {
            email: "nuno@example.com",
            password: "password123",
          },
          env,
        );

        expect(account.session).toMatchObject({
          state: "signed_in",
          profileCompleted: true,
          backend: "supabase",
        });
        expect(account.profile).toMatchObject({
          email: "nuno@example.com",
          displayName: "Nuno Lopes",
          username: "nuno",
        });
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it("normalizes legacy stored plan labels to canonical Alisio plans", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const statePath = alisioStateFile(root);
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      await fs.writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            account: {
              profile: {
                userId: "user-1",
                username: "nuno",
                displayName: "Nuno Lopes",
                email: "nuno@example.com",
                avatarLabel: "N",
                joinedAt: "2026-04-04T15:00:00.000Z",
                plan: "Free Plan",
                backend: "supabase",
              },
              preferences: {
                language: "pt-PT",
                theme: "dark",
              },
              session: {
                state: "signed_out",
                profileCompleted: false,
                backend: "supabase",
              },
            },
            organization: {
              mode: "none",
            },
            ai: {},
            authorizations: {},
            oauthCredentials: {},
            pendingAuthorizations: {},
          },
          null,
          2,
        ),
      );

      const account = await getAlisioAccountState({
        ALISIO_STATE_DIR: root,
      } as NodeJS.ProcessEnv);

      expect(account.profile.plan).toBe("free");
    });
  });

  it("cleans stored Supabase tokens after a failed session refresh", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const statePath = alisioStateFile(root);
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      await fs.writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            account: {
              profile: {
                userId: "user-1",
                username: "nuno",
                displayName: "Nuno Lopes",
                email: "nuno@example.com",
                avatarLabel: "N",
                joinedAt: "2026-04-04T15:00:00.000Z",
                plan: "Free Plan",
                backend: "supabase",
              },
              preferences: {
                language: "pt-PT",
                theme: "dark",
              },
              session: {
                state: "signed_in",
                profileCompleted: true,
                signedInAt: "2026-04-04T15:00:00.000Z",
                backend: "supabase",
              },
              cloudSession: {
                backend: "supabase",
                state: "signed_in",
                userId: "user-1",
                email: "nuno@example.com",
                accessToken: "access-token",
                refreshToken: "refresh-token",
                expiresAt: "2026-04-04T15:00:01.000Z",
                tokenType: "bearer",
                signedInAt: "2026-04-04T15:00:00.000Z",
              },
            },
            organization: {
              mode: "none",
            },
            ai: {},
            authorizations: {},
            oauthCredentials: {},
            pendingAuthorizations: {},
          },
          null,
          2,
        ),
      );

      const env = {
        ALISIO_STATE_DIR: root,
        ALISIO_SUPABASE_URL: "https://example.supabase.co",
        ALISIO_SUPABASE_ANON_KEY: "anon-key",
      } as NodeJS.ProcessEnv;

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "refresh failed" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      );

      vi.stubGlobal("fetch", fetchMock);
      try {
        const account = await getAlisioAccountState(env);

        expect(account.session.state).toBe("signed_out");
      } finally {
        vi.unstubAllGlobals();
      }

      const persistedState = JSON.parse(await fs.readFile(statePath, "utf8")) as {
        account: {
          cloudSession: Record<string, unknown>;
        };
      };
      expect(persistedState.account.cloudSession).toMatchObject({
        backend: "supabase",
        state: "signed_out",
        userId: "user-1",
        email: "nuno@example.com",
        signedInAt: "2026-04-04T15:00:00.000Z",
        signedOutAt: expect.any(String),
      });
      expect(persistedState.account.cloudSession).not.toHaveProperty("accessToken");
      expect(persistedState.account.cloudSession).not.toHaveProperty("refreshToken");
      expect(persistedState.account.cloudSession).not.toHaveProperty("expiresAt");
      expect(persistedState.account.cloudSession).not.toHaveProperty("tokenType");
    });
  });

  it("encrypts persisted Supabase and OpenAI tokens when local token encryption is configured", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const statePath = alisioStateFile(root);
      const workerId = `local:${os.hostname().trim().toLowerCase() || "this device"}`;
      const openAiAccessToken = createJwt({
        sub: "google-oauth2|shared-user",
        "https://api.openai.com/auth": {
          chatgpt_account_id: "acct_team_1",
          chatgpt_account_user_id: "account-user-team-1",
          chatgpt_user_id: "google-oauth2|shared-user",
          chatgpt_plan_type: "team",
        },
        "https://api.openai.com/profile": {
          email: "nuno7lopes@gmail.com",
        },
      });
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      await fs.writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            account: {
              profile: {
                userId: "user-1",
                username: "nuno",
                displayName: "Nuno Lopes",
                email: "nuno@example.com",
                avatarLabel: "N",
                joinedAt: "2026-04-04T15:00:00.000Z",
                plan: "Free Plan",
                backend: "supabase",
              },
              preferences: {
                language: "pt-PT",
                theme: "dark",
              },
              session: {
                state: "signed_in",
                profileCompleted: true,
                signedInAt: "2026-04-04T15:00:00.000Z",
                backend: "supabase",
              },
              cloudSession: {
                backend: "supabase",
                state: "signed_in",
                userId: "user-1",
                email: "nuno@example.com",
                accessToken: "supabase-access-token",
                refreshToken: "supabase-refresh-token",
                expiresAt: "2099-04-04T15:00:00.000Z",
                tokenType: "bearer",
                signedInAt: "2026-04-04T15:00:00.000Z",
              },
            },
            organization: {
              mode: "none",
            },
            ai: {
              aiProfiles: {
                "alisio-openai:user-1": {
                  provider: "openai",
                  scope: "user",
                  ownerKey: "user:user-1",
                  canonicalIdentityKey: "account_user_id:account-user-team-1",
                  identity: {
                    accountId: "acct_team_1",
                    accountUserId: "account-user-team-1",
                    userId: "google-oauth2|shared-user",
                    email: "nuno7lopes@gmail.com",
                    canonicalIdentityKey: "account_user_id:account-user-team-1",
                    source: "account_user_id",
                  },
                  createdAt: "2026-04-04T15:00:00.000Z",
                },
              },
              workerCredentials: {
                "worker-credential-1": {
                  provider: "openai",
                  aiProfileId: "alisio-openai:user-1",
                  workerId,
                  authProfileId: "openai-codex:alisio-main",
                  runtimeState: "connected",
                  accessToken: openAiAccessToken,
                  refreshToken: "openai-refresh-token",
                  expiresAt: "2099-04-04T15:00:00.000Z",
                  email: "nuno7lopes@gmail.com",
                  accountId: "acct_team_1",
                  accountUserId: "account-user-team-1",
                  userId: "google-oauth2|shared-user",
                  connectedAt: "2026-04-04T15:00:00.000Z",
                  createdAt: "2026-04-04T15:00:00.000Z",
                  localTelemetry: {
                    source: "official",
                    observedAt: "2099-04-04T15:00:00.000Z",
                    staleAt: "2099-04-04T15:10:00.000Z",
                    planType: "team",
                    primaryWindow: {
                      label: "5h",
                      durationMinutes: 300,
                      usedPercent: 10,
                      remainingPercent: 90,
                    },
                  },
                },
              },
              runtimeBindings: {
                [workerId]: {
                  workerId,
                  workerCredentialId: "worker-credential-1",
                  authProfileId: "openai-codex:alisio-main",
                  boundAt: "2026-04-04T15:00:00.000Z",
                },
              },
            },
            authorizations: {},
            oauthCredentials: {},
            pendingAuthorizations: {},
          },
          null,
          2,
        ),
      );

      const env = {
        ALISIO_STATE_DIR: root,
        ALISIO_SUPABASE_URL: "https://example.supabase.co",
        ALISIO_SUPABASE_ANON_KEY: "anon-key",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      } as NodeJS.ProcessEnv;

      const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
        const payload = parseJsonBody(init?.body);
        return new Response(
          JSON.stringify([
            {
              user_id: "user-1",
              email: payload.email,
              display_name: payload.display_name,
              username: payload.username,
              avatar_label: payload.avatar_label,
              avatar_url: payload.avatar_url,
              joined_at: payload.joined_at,
              plan: payload.plan,
              profile_completed: payload.profile_completed,
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });

      vi.stubGlobal("fetch", fetchMock);
      try {
        await updateAlisioAccountProfile(
          {
            displayName: "Nuno Lopes",
          },
          env,
        );
      } finally {
        vi.unstubAllGlobals();
      }

      const persistedRaw = await fs.readFile(statePath, "utf8");
      expect(persistedRaw).not.toContain("supabase-access-token");
      expect(persistedRaw).not.toContain("supabase-refresh-token");
      expect(persistedRaw).not.toContain("openai-refresh-token");

      const persistedState = JSON.parse(persistedRaw) as AlisioStoredState;
      expect(persistedState.account.cloudSession).toMatchObject({
        backend: "supabase",
        state: "signed_in",
        userId: "user-1",
        email: "nuno@example.com",
      });
      expect(persistedState.account.cloudSession).toHaveProperty("accessTokenEncrypted");
      expect(persistedState.account.cloudSession).toHaveProperty("refreshTokenEncrypted");
      expect(persistedState.account.cloudSession).not.toHaveProperty("accessToken");
      expect(persistedState.account.cloudSession).not.toHaveProperty("refreshToken");

      const persistedAiCredential = Object.values(persistedState.ai?.workerCredentials ?? {})[0] as
        | {
            authProfileId?: string;
            accountUserId?: string;
          }
        | undefined;
      expect(persistedAiCredential).toMatchObject({
        authProfileId: "openai-codex:alisio-main",
        accountUserId: "account-user-team-1",
      });
      expect(persistedAiCredential).toHaveProperty("accessTokenEncrypted");
      expect(persistedAiCredential).toHaveProperty("refreshTokenEncrypted");
      expect(persistedAiCredential).not.toHaveProperty("accessToken");
      expect(persistedAiCredential).not.toHaveProperty("refreshToken");
    });
  });

  it("migrates legacy local-dev account state to signed-out Supabase mode", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const statePath = alisioStateFile(root);
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      await fs.writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            account: {
              profile: {
                userId: "legacy-user",
                username: "nuno7lopes",
                displayName: "Nuno7lopes",
                email: "nuno7lopes@gmail.com",
                avatarLabel: "N",
                joinedAt: "2026-04-02T17:32:33.688Z",
                plan: "Free Plan",
                backend: "local-dev",
              },
              preferences: {
                language: "pt-PT",
                theme: "system",
              },
              session: {
                state: "signed_in",
                profileCompleted: true,
                backend: "local-dev",
                signedInAt: "2026-04-02T17:32:33.688Z",
              },
              cloudSession: {
                backend: "local-dev",
                state: "signed_in",
                userId: "legacy-user",
                email: "nuno7lopes@gmail.com",
                signedInAt: "2026-04-02T17:32:33.688Z",
              },
              passwordCredential: {
                email: "nuno7lopes@gmail.com",
                salt: "salt",
                hash: "hash",
              },
            },
            organization: {
              mode: "owner",
              organizationName: "Legacy Org",
            },
            ai: {
              pending: {
                callbackUrl: "https://example.com/callback",
                codeVerifier: "code",
                stateToken: "state",
                createdAt: "2026-04-04T15:00:00.000Z",
              },
            },
            authorizations: {
              github: {
                connectorId: "github",
                state: "connected",
                health: "healthy",
                scopes: ["repo"],
              },
            },
            oauthCredentials: {
              github: {
                provider: "github",
                accessToken: "token",
                createdAt: "2026-04-04T15:00:00.000Z",
              },
            },
            pendingAuthorizations: {
              state: {
                connectorId: "github",
                provider: "github",
                redirectUri: "https://example.com",
                requestedScopes: ["repo"],
                createdAt: "2026-04-04T15:00:00.000Z",
              },
            },
          },
          null,
          2,
        ),
      );

      const account = await getAlisioAccountState({
        ALISIO_STATE_DIR: root,
        ALISIO_SUPABASE_URL: "https://example.supabase.co",
        ALISIO_SUPABASE_ANON_KEY: "anon-key",
      } as NodeJS.ProcessEnv);

      expect(account.session).toMatchObject({
        state: "signed_out",
        profileCompleted: false,
        backend: "supabase",
      });
      expect(account.profile.email).toBe("nuno7lopes@gmail.com");
      expect(account.profile.backend).toBe("supabase");

      const persistedState = JSON.parse(await fs.readFile(statePath, "utf8")) as AlisioStoredState;
      expect(persistedState.account.session).toMatchObject({
        state: "signed_out",
        profileCompleted: false,
        backend: "supabase",
      });
      expect(persistedState.account.cloudSession).toMatchObject({
        state: "signed_out",
        backend: "supabase",
        email: "nuno7lopes@gmail.com",
      });
      expect(persistedState.account.profile).not.toHaveProperty("userId");
      expect(persistedState.account).not.toHaveProperty("passwordCredential");
      expect(persistedState.organization).toEqual({ mode: "none" });
      expect(persistedState.authorizations).toEqual({});
      expect(persistedState.oauthCredentials).toEqual({});
      expect(persistedState.pendingAuthorizations).toEqual({});
    });
  });

  it("warns when local token encryption is missing for persisted account or AI sessions", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const statePath = alisioStateFile(root);
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      await fs.writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            account: {
              profile: {
                userId: "user-1",
                username: "nuno",
                displayName: "Nuno Lopes",
                email: "nuno@example.com",
                avatarLabel: "N",
                joinedAt: "2026-04-04T15:00:00.000Z",
                plan: "Free Plan",
                backend: "supabase",
              },
              preferences: {
                language: "pt-PT",
                theme: "dark",
              },
              session: {
                state: "signed_in",
                profileCompleted: true,
                signedInAt: "2026-04-04T15:00:00.000Z",
                backend: "supabase",
              },
            },
            organization: {
              mode: "none",
            },
            ai: {
              aiProfiles: {
                "alisio-openai:user-1": {
                  provider: "openai",
                  scope: "user",
                  ownerKey: "user:user-1",
                  canonicalIdentityKey: "account_user_id:account-user-team-1",
                  identity: {
                    accountId: "acct_team_1",
                    accountUserId: "account-user-team-1",
                    userId: "google-oauth2|shared-user",
                    email: "nuno7lopes@gmail.com",
                    canonicalIdentityKey: "account_user_id:account-user-team-1",
                    source: "account_user_id",
                  },
                  createdAt: "2026-04-04T15:00:00.000Z",
                },
              },
              workerCredentials: {
                "worker-credential-1": {
                  provider: "openai",
                  aiProfileId: "alisio-openai:user-1",
                  workerId: `local:${os.hostname().trim().toLowerCase() || "this device"}`,
                  authProfileId: "openai-codex:alisio-main",
                  runtimeState: "connected",
                  accessTokenEncrypted: createEncryptedStoredToken(
                    createJwt({
                      sub: "google-oauth2|shared-user",
                      "https://api.openai.com/auth": {
                        chatgpt_account_id: "acct_team_1",
                        chatgpt_account_user_id: "account-user-team-1",
                        chatgpt_user_id: "google-oauth2|shared-user",
                        chatgpt_plan_type: "team",
                      },
                      "https://api.openai.com/profile": {
                        email: "nuno7lopes@gmail.com",
                      },
                    }),
                  ),
                  refreshTokenEncrypted: createEncryptedStoredToken("openai-refresh-token"),
                  expiresAt: "2099-04-04T15:00:00.000Z",
                  connectedAt: "2026-04-04T15:00:00.000Z",
                  createdAt: "2026-04-04T15:00:00.000Z",
                  localTelemetry: {
                    source: "official",
                    observedAt: "2099-04-04T15:00:00.000Z",
                    staleAt: "2099-04-04T15:10:00.000Z",
                    planType: "team",
                    primaryWindow: {
                      label: "5h",
                      durationMinutes: 300,
                      usedPercent: 10,
                      remainingPercent: 90,
                    },
                  },
                },
              },
            },
            authorizations: {},
            oauthCredentials: {},
            pendingAuthorizations: {},
          },
          null,
          2,
        ),
      );

      const summary = await getAlisioDoctorSummary({
        env: {
          ALISIO_STATE_DIR: root,
        } as NodeJS.ProcessEnv,
        providerReady: false,
        gatewayHealthy: true,
      });

      expect(summary.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "local_token_encryption_not_configured",
            severity: "warning",
          }),
        ]),
      );
    });
  });

  it("builds an Alisio bootstrap summary from account, organization, and connector state", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const summary = await getAlisioBootstrapSummary({
        env: {
          ALISIO_STATE_DIR: root,
        } as NodeJS.ProcessEnv,
        providerReady: false,
        wizardRunning: true,
      });

      expect(summary).toMatchObject({
        connectionRequired: false,
        wizardRequired: false,
        wizardRunning: true,
        providerReady: false,
        accountReady: false,
        startupState: "needs_profile",
        nextStep: "account",
      });
      expect(summary.organizationState.mode).toBe("none");
      expect(summary.connectorSummary.total).toBeGreaterThan(0);
      expect(summary.connectorSummary.ready).toBe(0);
      expect(summary.connectorSummary.connected).toBe(0);
    });
  });

  it("builds an Alisio doctor summary with actionable setup issues", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const summary = await getAlisioDoctorSummary({
        env: {
          ALISIO_STATE_DIR: root,
        } as NodeJS.ProcessEnv,
        providerReady: false,
        wizardRunning: false,
      });

      expect(summary.ok).toBe(false);
      expect(summary.bootstrap.nextStep).toBe("account");
      expect(summary.issues.map((issue) => issue.code)).toContain("account_not_ready");
      expect(summary.issues.map((issue) => issue.code)).toContain("runtime_not_ready");
      expect(summary.checks.runtime).toBe(false);
      expect(summary.checks.account).toBe(false);
    });
  });

  it("reports missing required Supabase env vars in the doctor summary", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const summary = await getAlisioDoctorSummary({
        env: {
          ALISIO_STATE_DIR: root,
        } as NodeJS.ProcessEnv,
        providerReady: false,
        gatewayHealthy: true,
      });

      expect(summary.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "account_backend_env_missing",
            severity: "warning",
          }),
        ]),
      );
      expect(summary.checks.permissions).toBe(true);
    });
  });

  it("treats alternative model runtimes as ready when providerReady is true", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      const summary = await getAlisioBootstrapSummary({
        env,
        providerReady: true,
      });

      expect(summary.providerReady).toBe(true);
      expect(summary.startupState).toBe("ready");
      expect(summary.nextStep).toBe("organization");
    });
  });

  it("does not report a runtime error when an alternative model runtime is ready", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      const summary = await getAlisioDoctorSummary({
        env,
        providerReady: true,
        gatewayHealthy: true,
      });

      expect(summary.issues.map((issue) => issue.code)).not.toContain("runtime_not_ready");
      expect(summary.checks.runtime).toBe(true);
    });
  });

  it("summarizes reconnecting authorizations once", () => {
    const summary = summarizeAlisioConnectorAuthorizations([
      {
        connectorId: "google-calendar",
        state: "needs_reconnect",
        health: "needs_reconnect",
        scopes: ["openid"],
      },
    ]);

    expect(summary).toMatchObject({
      connected: 0,
      needsReconnect: 1,
      inReview: expect.any(Number),
      unavailable: expect.any(Number),
    });
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.ready).toBeGreaterThan(0);
    expect(summary.available).toBe(summary.total - summary.unavailable);
  });

  it("does not route ready accounts into an empty connectors step when OAuth config is missing", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await setStoredAlisioPlan(root, "plus");
      await setAlisioOrganizationState(
        {
          mode: "owner",
          organizationName: "Alisio",
        },
        env,
      );

      const summary = await getAlisioBootstrapSummary({
        env,
        providerReady: true,
      });

      expect(summary.startupState).toBe("ready");
      expect(summary.connectorSummary.connected).toBe(0);
      expect(summary.connectorSummary.ready).toBe(0);
      expect(summary.nextStep).toBe(process.platform === "darwin" ? "permissions" : "ready");
    });
  });
});

describe("Alisio OpenAI profiles", () => {
  it("refreshes every current-worker OpenAI profile when refreshing limits globally", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      const statePath = alisioStateFile(root);
      const workerId = `local:${os.hostname().trim().toLowerCase() || "this device"}`;
      const observedAt = new Date().toISOString();
      const staleAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const personalToken = createJwt({
        sub: "google-oauth2|personal-user",
        "https://api.openai.com/auth": {
          chatgpt_account_id: "acct_personal",
          chatgpt_account_user_id: "account-user-personal",
          chatgpt_user_id: "google-oauth2|personal-user",
          chatgpt_plan_type: "team",
        },
        "https://api.openai.com/profile": {
          email: "personal@example.com",
        },
      });
      const workToken = createJwt({
        sub: "google-oauth2|work-user",
        "https://api.openai.com/auth": {
          chatgpt_account_id: "acct_work",
          chatgpt_account_user_id: "account-user-work",
          chatgpt_user_id: "google-oauth2|work-user",
          chatgpt_plan_type: "enterprise",
        },
        "https://api.openai.com/profile": {
          email: "work@example.com",
        },
      });
      await fs.writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            account: {
              profile: {
                userId: "user-1",
                username: "nuno",
                displayName: "Nuno Lopes",
                email: "nuno@example.com",
                avatarLabel: "N",
                joinedAt: "2026-04-04T15:00:00.000Z",
                plan: "Free Plan",
                backend: "supabase",
              },
              preferences: {
                language: "pt-PT",
                theme: "dark",
              },
              session: {
                state: "signed_in",
                profileCompleted: true,
                signedInAt: "2026-04-04T15:00:00.000Z",
                backend: "supabase",
              },
              cloudSession: {
                backend: "supabase",
                state: "signed_out",
                userId: "user-1",
                email: "nuno@example.com",
                signedInAt: "2026-04-04T15:00:00.000Z",
                signedOutAt: "2026-04-04T15:05:00.000Z",
              },
            },
            organization: {
              mode: "none",
            },
            ai: {
              aiProfiles: {
                "alisio-openai:personal": {
                  provider: "openai",
                  scope: "user",
                  ownerKey: "user:nuno@example.com",
                  canonicalIdentityKey: "account_user_id:account-user-personal",
                  identity: {
                    accountId: "acct_personal",
                    accountUserId: "account-user-personal",
                    userId: "google-oauth2|personal-user",
                    email: "personal@example.com",
                    canonicalIdentityKey: "account_user_id:account-user-personal",
                    source: "account_user_id",
                  },
                  createdAt: "2026-04-03T20:00:00.000Z",
                },
                "alisio-openai:work": {
                  provider: "openai",
                  scope: "organization",
                  ownerKey: "organization:alisio",
                  canonicalIdentityKey: "account_user_id:account-user-work",
                  identity: {
                    accountId: "acct_work",
                    accountUserId: "account-user-work",
                    userId: "google-oauth2|work-user",
                    email: "work@example.com",
                    canonicalIdentityKey: "account_user_id:account-user-work",
                    source: "account_user_id",
                  },
                  createdAt: "2026-04-03T20:05:00.000Z",
                },
              },
              workerCredentials: {
                "worker-credential-personal": {
                  provider: "openai",
                  aiProfileId: "alisio-openai:personal",
                  workerId,
                  authProfileId: "openai-codex:personal",
                  runtimeState: "connected",
                  accessToken: personalToken,
                  refreshToken: "refresh-personal",
                  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                  email: "personal@example.com",
                  accountId: "acct_personal",
                  accountUserId: "account-user-personal",
                  userId: "google-oauth2|personal-user",
                  connectedAt: "2026-04-03T20:00:00.000Z",
                  createdAt: "2026-04-03T20:00:00.000Z",
                  localTelemetry: {
                    source: "official",
                    observedAt,
                    staleAt,
                    planType: "starter",
                    primaryWindow: {
                      label: "5h",
                      durationMinutes: 300,
                      usedPercent: 10,
                      remainingPercent: 90,
                    },
                  },
                },
                "worker-credential-work": {
                  provider: "openai",
                  aiProfileId: "alisio-openai:work",
                  workerId,
                  authProfileId: "openai-codex:work",
                  runtimeState: "connected",
                  accessToken: workToken,
                  refreshToken: "refresh-work",
                  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                  email: "work@example.com",
                  accountId: "acct_work",
                  accountUserId: "account-user-work",
                  userId: "google-oauth2|work-user",
                  connectedAt: "2026-04-03T20:05:00.000Z",
                  createdAt: "2026-04-03T20:05:00.000Z",
                  localTelemetry: {
                    source: "official",
                    observedAt,
                    staleAt,
                    planType: "starter",
                    primaryWindow: {
                      label: "5h",
                      durationMinutes: 300,
                      usedPercent: 15,
                      remainingPercent: 85,
                    },
                  },
                },
              },
              runtimeBindings: {
                [workerId]: {
                  workerId,
                  workerCredentialId: "worker-credential-personal",
                  authProfileId: "openai-codex:personal",
                  boundAt: "2026-04-03T20:00:00.000Z",
                },
              },
            },
            authorizations: {},
            oauthCredentials: {},
            pendingAuthorizations: {},
          },
          null,
          2,
        ),
      );

      const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers =
          init?.headers instanceof Headers
            ? Object.fromEntries(init.headers.entries())
            : ((init?.headers as Record<string, string> | undefined) ?? {});
        const authHeader = headers.Authorization ?? headers.authorization;
        if (authHeader === `Bearer ${personalToken}`) {
          return new Response(
            JSON.stringify({
              plan_type: "team",
              rate_limit: {
                primary_window: {
                  limit_window_seconds: 18_000,
                  used_percent: 80,
                  reset_at: Math.round(Date.now() / 1000) + 1_800,
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (authHeader === `Bearer ${workToken}`) {
          return new Response(
            JSON.stringify({
              plan_type: "enterprise",
              rate_limit: {
                primary_window: {
                  limit_window_seconds: 18_000,
                  used_percent: 20,
                  reset_at: Math.round(Date.now() / 1000) + 3_600,
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        throw new Error(`unexpected authorization header: ${String(authHeader)}`);
      });

      const result = await refreshAlisioAiLimits(undefined, env, fetchImpl as typeof fetch);

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(
        result.profiles?.find((profile) => profile.email === "personal@example.com")
          ?.aggregatedTelemetry?.primaryWindow?.usedPercent,
      ).toBe(80);
      expect(
        result.profiles?.find((profile) => profile.email === "personal@example.com")?.planLabel,
      ).toBe("team");
      expect(
        result.profiles?.find((profile) => profile.email === "work@example.com")
          ?.aggregatedTelemetry?.primaryWindow?.usedPercent,
      ).toBe(20);
      expect(
        result.profiles?.find((profile) => profile.email === "work@example.com")?.planLabel,
      ).toBe("enterprise");
    });
  });

  it("rehydrates stored worker credentials with real token identity and hides technical labels", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const statePath = alisioStateFile(root);
      const workerId = `local:${os.hostname().trim().toLowerCase() || "this device"}`;
      const accessToken = createJwt({
        sub: "google-oauth2|shared-user",
        "https://api.openai.com/auth": {
          chatgpt_account_id: "acct_team_1",
          chatgpt_account_user_id: "account-user-team-1",
          chatgpt_user_id: "google-oauth2|shared-user",
          chatgpt_plan_type: "team",
        },
        "https://api.openai.com/profile": {
          email: "nuno7lopes@gmail.com",
        },
      });
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      await fs.writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            account: {
              profile: {
                username: "nuno",
                displayName: "Nuno Lopes",
                email: "nuno@example.com",
                avatarLabel: "N",
                joinedAt: "2026-04-03T20:00:00.000Z",
                plan: "Free Plan",
              },
              session: {
                state: "signed_in",
                profileCompleted: true,
              },
            },
            ai: {
              aiProfiles: {
                "legacy-profile": {
                  provider: "openai",
                  scope: "user",
                  ownerKey: "user:nuno@example.com",
                  canonicalIdentityKey: "account_id:acct_team_1",
                  identity: {
                    accountId: "acct_team_1",
                    canonicalIdentityKey: "account_id:acct_team_1",
                    source: "account_id",
                  },
                  label: "9e05e4cd-454b-485c-847c-274bf93afa77",
                  createdAt: "2026-04-03T20:00:00.000Z",
                },
              },
              workerCredentials: {
                "legacy-credential": {
                  provider: "openai",
                  aiProfileId: "legacy-profile",
                  workerId,
                  authProfileId: "openai-codex:legacy",
                  runtimeState: "connected",
                  accessToken,
                  connectedAt: "2026-04-03T20:00:00.000Z",
                  createdAt: "2026-04-03T20:00:00.000Z",
                  localTelemetry: {
                    source: "official",
                    observedAt: "2026-04-04T15:00:00.000Z",
                    staleAt: "2099-04-04T15:10:00.000Z",
                    primaryWindow: {
                      label: "5h",
                      durationMinutes: 300,
                      usedPercent: 68,
                      remainingPercent: 32,
                    },
                  },
                },
              },
              runtimeBindings: {
                [workerId]: {
                  workerId,
                  workerCredentialId: "legacy-credential",
                  authProfileId: "openai-codex:legacy",
                  boundAt: "2026-04-03T20:00:00.000Z",
                },
              },
            },
          },
          null,
          2,
        ),
      );

      const aiState = await getAlisioAiState({
        ALISIO_STATE_DIR: root,
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      } as NodeJS.ProcessEnv);

      expect(aiState.activeProfileId).toBeTruthy();
      expect(aiState.email).toBe("nuno7lopes@gmail.com");
      expect(aiState.planLabel).toBe("team");
      expect(aiState.profiles).toHaveLength(1);
      expect(aiState.profiles?.[0]).toMatchObject({
        email: "nuno7lopes@gmail.com",
        accountUserId: "account-user-team-1",
        userId: "google-oauth2|shared-user",
        label: "nuno7lopes@gmail.com",
        planLabel: "team",
      });
      expect(aiState.profiles?.[0]?.canonicalIdentityKey).toBe(
        "account_user_id:account-user-team-1",
      );

      const persisted = JSON.parse(await fs.readFile(statePath, "utf8")) as {
        ai?: {
          aiProfiles?: Record<string, { canonicalIdentityKey?: string }>;
          workerCredentials?: Record<
            string,
            { email?: string; accountUserId?: string; userId?: string }
          >;
        };
      };
      const persistedProfile = Object.values(persisted.ai?.aiProfiles ?? {})[0];
      const persistedCredential = Object.values(persisted.ai?.workerCredentials ?? {})[0];
      expect(persistedProfile?.canonicalIdentityKey).toBe("account_user_id:account-user-team-1");
      expect((persistedProfile as { label?: string } | undefined)?.label).toBe(
        "9e05e4cd-454b-485c-847c-274bf93afa77",
      );
      expect(persistedCredential).toMatchObject({
        email: "nuno7lopes@gmail.com",
        accountUserId: "account-user-team-1",
        userId: "google-oauth2|shared-user",
      });
    });
  });

  it("renames a stored OpenAI profile without touching the others", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const statePath = alisioStateFile(root);
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      await fs.writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            account: {
              profile: {
                username: "nuno",
                displayName: "Nuno Lopes",
                email: "nuno@example.com",
                avatarLabel: "N",
                joinedAt: "2026-04-03T20:00:00.000Z",
                plan: "Free Plan",
              },
              session: {
                state: "signed_in",
                profileCompleted: true,
              },
            },
            ai: {
              activeProfileId: "alisio-openai:nuno",
              profiles: {
                "alisio-openai:nuno": {
                  status: "connected",
                  email: "nuno@example.com",
                  label: "Personal",
                  connectedAt: "2026-04-03T20:00:00.000Z",
                },
                "alisio-openai:work": {
                  status: "connected",
                  email: "nuno@work.example",
                  label: "Work",
                  connectedAt: "2026-04-03T20:05:00.000Z",
                },
              },
            },
          },
          null,
          2,
        ),
      );
      const initialState = await getAlisioAiState({
        ALISIO_STATE_DIR: root,
      } as NodeJS.ProcessEnv);
      const targetProfileId = initialState.profiles?.find(
        (profile) => profile.email === "nuno@example.com",
      )?.profileId;
      expect(targetProfileId).toBeTruthy();

      const result = await renameAlisioAiProfile(
        {
          profileId: targetProfileId ?? "",
          label: "Main OpenAI",
        },
        {
          ALISIO_STATE_DIR: root,
        } as NodeJS.ProcessEnv,
      );

      expect(result.activeProfileId).toBe(initialState.activeProfileId);
      expect(result.profiles?.find((profile) => profile.email === "nuno@example.com")?.label).toBe(
        "Main OpenAI",
      );
      expect(result.profiles?.find((profile) => profile.email === "nuno@work.example")?.label).toBe(
        "Work",
      );
    });
  });

  it("keeps fallback emails out of the stored profile label when deriving AI state", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const statePath = alisioStateFile(root);
      const workerId = `local:${os.hostname().trim().toLowerCase() || "this device"}`;
      const accessToken = createJwt({
        sub: "google-oauth2|shared-user",
        "https://api.openai.com/auth": {
          chatgpt_account_id: "acct_team_1",
          chatgpt_account_user_id: "account-user-team-1",
          chatgpt_user_id: "google-oauth2|shared-user",
          chatgpt_plan_type: "team",
        },
        "https://api.openai.com/profile": {
          email: "nuno7lopes@gmail.com",
        },
      });
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      await fs.writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            account: {
              profile: {
                username: "nuno",
                displayName: "Nuno Lopes",
                email: "nuno@example.com",
                avatarLabel: "N",
                joinedAt: "2026-04-03T20:00:00.000Z",
                plan: "Free Plan",
              },
              session: {
                state: "signed_in",
                profileCompleted: true,
              },
            },
            ai: {
              aiProfiles: {
                "alisio-openai:nuno": {
                  provider: "openai",
                  scope: "user",
                  ownerKey: "user:user-1",
                  canonicalIdentityKey: "account_user_id:account-user-team-1",
                  identity: {
                    accountId: "acct_team_1",
                    accountUserId: "account-user-team-1",
                    userId: "google-oauth2|shared-user",
                    email: "nuno7lopes@gmail.com",
                    canonicalIdentityKey: "account_user_id:account-user-team-1",
                    source: "account_user_id",
                  },
                  createdAt: "2026-04-03T20:00:00.000Z",
                },
              },
              workerCredentials: {
                "worker-credential-1": {
                  provider: "openai",
                  aiProfileId: "alisio-openai:nuno",
                  workerId,
                  authProfileId: "openai-codex:alisio-main",
                  runtimeState: "connected",
                  accessToken,
                  connectedAt: "2026-04-03T20:00:00.000Z",
                  createdAt: "2026-04-03T20:00:00.000Z",
                  localTelemetry: {
                    source: "official",
                    observedAt: "2099-04-04T15:00:00.000Z",
                    staleAt: "2099-04-04T15:10:00.000Z",
                    planType: "team",
                    primaryWindow: {
                      label: "5h",
                      durationMinutes: 300,
                      usedPercent: 10,
                      remainingPercent: 90,
                    },
                  },
                },
              },
              runtimeBindings: {
                [workerId]: {
                  workerId,
                  workerCredentialId: "worker-credential-1",
                  authProfileId: "openai-codex:alisio-main",
                  boundAt: "2026-04-03T20:00:00.000Z",
                },
              },
            },
          },
          null,
          2,
        ),
      );

      const result = await getAlisioAiState({
        ALISIO_STATE_DIR: root,
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      } as NodeJS.ProcessEnv);

      expect(result.profiles?.[0]?.label).toBe("nuno7lopes@gmail.com");

      const persisted = JSON.parse(await fs.readFile(statePath, "utf8")) as {
        ai?: {
          aiProfiles?: Record<string, { label?: string }>;
        };
      };
      expect(persisted.ai?.aiProfiles?.["alisio-openai:nuno"]?.label).toBeUndefined();
    });
  });

  it("rehydrates the best OpenAI profile when no runtime binding exists yet", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const statePath = alisioStateFile(root);
      const workerId = `local:${os.hostname().trim().toLowerCase() || "this device"}`;
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      await fs.writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            account: {
              profile: {
                username: "nuno",
                displayName: "Nuno Lopes",
                email: "nuno@example.com",
                avatarLabel: "N",
                joinedAt: "2026-04-03T20:00:00.000Z",
                plan: "Free Plan",
              },
              session: {
                state: "signed_in",
                profileCompleted: true,
              },
            },
            ai: {
              aiProfiles: {
                "alisio-openai:nuno": {
                  provider: "openai",
                  scope: "user",
                  ownerKey: "user:user-1",
                  canonicalIdentityKey: "email:nuno@example.com",
                  identity: {
                    email: "nuno@example.com",
                    canonicalIdentityKey: "email:nuno@example.com",
                    source: "email",
                  },
                  createdAt: "2026-04-03T20:00:00.000Z",
                },
              },
              workerCredentials: {
                "worker-credential-1": {
                  provider: "openai",
                  aiProfileId: "alisio-openai:nuno",
                  workerId,
                  authProfileId: "openai-codex:alisio-main",
                  runtimeState: "connected",
                  connectedAt: "2026-04-03T20:00:00.000Z",
                  createdAt: "2026-04-03T20:00:00.000Z",
                  email: "nuno@example.com",
                },
              },
            },
          },
          null,
          2,
        ),
      );

      const result = await getAlisioAiState({
        ALISIO_STATE_DIR: root,
      } as NodeJS.ProcessEnv);

      expect(result.activeProfileId).toBeTruthy();
      expect(result.profiles).toHaveLength(1);
      expect(["connected", "limits_unavailable"]).toContain(result.profiles?.[0]?.status);
    });
  });

  it("falls back to the next stored profile when the active profile is removed", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const statePath = alisioStateFile(root);
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      await fs.writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            account: {
              profile: {
                username: "nuno",
                displayName: "Nuno Lopes",
                email: "nuno@example.com",
                avatarLabel: "N",
                joinedAt: "2026-04-03T20:00:00.000Z",
                plan: "Free Plan",
              },
              session: {
                state: "signed_in",
                profileCompleted: true,
              },
            },
            ai: {
              activeProfileId: "alisio-openai:nuno",
              profiles: {
                "alisio-openai:nuno": {
                  status: "connected",
                  email: "nuno@example.com",
                  label: "Personal",
                  connectedAt: "2026-04-03T20:00:00.000Z",
                },
                "alisio-openai:work": {
                  status: "connected",
                  email: "nuno@work.example",
                  label: "Work",
                  connectedAt: "2026-04-03T20:05:00.000Z",
                },
              },
            },
          },
          null,
          2,
        ),
      );
      const initialState = await getAlisioAiState({
        ALISIO_STATE_DIR: root,
      } as NodeJS.ProcessEnv);
      const targetProfileId = initialState.profiles?.find(
        (profile) => profile.email === "nuno@example.com",
      )?.profileId;
      expect(targetProfileId).toBeTruthy();

      const state = await disconnectAlisioAi(
        {
          profileId: targetProfileId ?? "",
        },
        {
          ALISIO_STATE_DIR: root,
        } as NodeJS.ProcessEnv,
      );
      expect(state.activeProfileId).not.toBe(targetProfileId);
      expect(state.profiles?.map((profile) => profile.email)).toEqual(["nuno@work.example"]);
    });
  });
});

describe("Alisio remote model servers", () => {
  it("rejects duplicate remote endpoints for the same kind", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await setStoredAlisioPlan(root, "plus");

      await saveAlisioRemoteModelServer(
        {
          label: "GPU Box",
          kind: "openai-compatible",
          baseUrl: "https://models.example.com/v1/",
        },
        env,
      );

      await expect(
        saveAlisioRemoteModelServer(
          {
            label: "GPU Box 2",
            kind: "openai-compatible",
            baseUrl: "https://models.example.com/v1",
          },
          env,
        ),
      ).rejects.toThrow("That server has already been added.");

      const servers = await listAlisioRemoteModelServers(env);
      expect(servers).toHaveLength(1);
      expect(servers[0]?.baseUrl).toBe("https://models.example.com/v1");
    });
  });

  it("blocks saving remote model servers on Free", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);

      await expect(
        saveAlisioRemoteModelServer(
          {
            label: "GPU Box",
            kind: "openai-compatible",
            baseUrl: "https://models.example.com/v1",
          },
          env,
        ),
      ).rejects.toThrow("Custom remote model servers are available on Plus.");
    });
  });

  it("blocks selecting a saved remote model server on Free", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      const statePath = alisioStateFile(root);
      const state = JSON.parse(await fs.readFile(statePath, "utf8")) as AlisioStoredState;
      state.modelServers = {
        "server-1": {
          serverId: "server-1",
          label: "GPU Box",
          kind: "openai-compatible",
          baseUrl: "https://models.example.com/v1",
          active: true,
          createdAt: "2026-04-06T10:00:00.000Z",
          updatedAt: "2026-04-06T10:00:00.000Z",
        },
      };
      await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

      await expect(
        selectAlisioRemoteModelServer(
          {
            serverId: "server-1",
          },
          env,
        ),
      ).rejects.toThrow("Custom remote model servers are available on Plus.");
    });
  });

  it("requires secure storage before persisting remote server API keys", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: "",
      });
      await setStoredAlisioPlan(root, "plus");

      await expect(
        saveAlisioRemoteModelServer(
          {
            label: "GPU Box",
            kind: "openai-compatible",
            baseUrl: "https://models.example.com/v1",
            apiKey: "secret-token",
          },
          env,
        ),
      ).rejects.toThrow("Secure local token storage is required.");
    });
  });
});
