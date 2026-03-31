import { describe, expect, it } from "vitest";
import {
  bindWorkerAiCredential,
  connectOpenAICodexCredential,
  rebuildAiAccountState,
} from "./ai-accounts.js";
import { createEmptyState, createMockSession } from "./storage.js";

function createStore(
  profiles: Record<string, { email?: string; accountId?: string; expires?: number }>,
) {
  return {
    version: 1,
    profiles: Object.fromEntries(
      Object.entries(profiles).map(([profileId, profile]) => [
        profileId,
        {
          type: "oauth" as const,
          provider: "openai-codex",
          access: "access-token",
          refresh: "refresh-token",
          expires: profile.expires ?? Date.now() + 60_000,
          email: profile.email,
          accountId: profile.accountId,
        },
      ]),
    ),
    usageStats: {},
  };
}

describe("desktop worker AI accounts", () => {
  it("reutiliza o mesmo AiProfile quando a mesma conta volta a autenticar no mesmo dono", () => {
    const firstState = {
      ...createEmptyState(100),
      session: createMockSession({
        name: "Nuno",
        email: "nuno@example.com",
        now: 100,
      }),
    };

    const connected = rebuildAiAccountState(
      connectOpenAICodexCredential({
        state: firstState,
        authProfileId: "openai-codex:primeiro",
        email: "nuno@openai.test",
        accountId: "acct_123",
        now: 101,
      }),
      createStore({
        "openai-codex:primeiro": {
          email: "nuno@openai.test",
          accountId: "acct_123",
        },
      }),
      101,
    );

    const reauthed = rebuildAiAccountState(
      connectOpenAICodexCredential({
        state: connected,
        authProfileId: "openai-codex:segundo",
        email: "nuno@openai.test",
        accountId: "acct_123",
        now: 102,
      }),
      createStore({
        "openai-codex:segundo": {
          email: "nuno@openai.test",
          accountId: "acct_123",
        },
      }),
      102,
    );

    expect(reauthed.aiProfiles).toHaveLength(1);
    expect(reauthed.workerAiCredentials).toHaveLength(1);
    expect(reauthed.workerAiCredentials[0]?.authProfileId).toBe("openai-codex:segundo");
    expect(reauthed.runtimeBinding?.workerAiCredentialId).toBe(reauthed.workerAiCredentials[0]?.id);
  });

  it("não deduplica globalmente a mesma conta entre donos diferentes", () => {
    const firstOwnerState = {
      ...createEmptyState(200),
      session: createMockSession({
        name: "Ana",
        email: "ana@example.com",
        now: 200,
      }),
    };
    const secondOwnerState = {
      ...createEmptyState(200),
      session: createMockSession({
        name: "João",
        email: "joao@example.com",
        now: 200,
      }),
    };

    const firstConnected = rebuildAiAccountState(
      connectOpenAICodexCredential({
        state: firstOwnerState,
        authProfileId: "openai-codex:ana",
        email: "shared@openai.test",
        accountId: "acct_shared",
        now: 201,
      }),
      createStore({
        "openai-codex:ana": {
          email: "shared@openai.test",
          accountId: "acct_shared",
        },
      }),
      201,
    );

    const secondConnected = rebuildAiAccountState(
      connectOpenAICodexCredential({
        state: secondOwnerState,
        authProfileId: "openai-codex:joao",
        email: "shared@openai.test",
        accountId: "acct_shared",
        now: 201,
      }),
      createStore({
        "openai-codex:joao": {
          email: "shared@openai.test",
          accountId: "acct_shared",
        },
      }),
      201,
    );

    expect(firstConnected.aiProfiles[0]?.canonicalIdentity).toBe(
      secondConnected.aiProfiles[0]?.canonicalIdentity,
    );
    expect(firstConnected.aiProfiles[0]?.ownerUserId).not.toBe(
      secondConnected.aiProfiles[0]?.ownerUserId,
    );
    expect(firstConnected.aiProfiles[0]?.id).not.toBe(secondConnected.aiProfiles[0]?.id);
  });

  it("muda o binding ativo entre credenciais locais sem colapsar as outras", () => {
    const initialState = {
      ...createEmptyState(300),
      session: createMockSession({
        name: "Nuno",
        email: "nuno@example.com",
        now: 300,
      }),
    };
    const once = connectOpenAICodexCredential({
      state: initialState,
      authProfileId: "openai-codex:a",
      email: "a@openai.test",
      accountId: "acct_a",
      now: 301,
    });
    const twice = connectOpenAICodexCredential({
      state: once,
      authProfileId: "openai-codex:b",
      email: "b@openai.test",
      accountId: "acct_b",
      now: 302,
    });
    const withStore = rebuildAiAccountState(
      twice,
      createStore({
        "openai-codex:a": { email: "a@openai.test", accountId: "acct_a" },
        "openai-codex:b": { email: "b@openai.test", accountId: "acct_b" },
      }),
      302,
    );
    const firstCredential = withStore.workerAiCredentials.find(
      (credential) => credential.authProfileId === "openai-codex:a",
    );
    const secondCredential = withStore.workerAiCredentials.find(
      (credential) => credential.authProfileId === "openai-codex:b",
    );

    const rebound = rebuildAiAccountState(
      bindWorkerAiCredential({
        state: withStore,
        workerAiCredentialId: firstCredential!.id,
        now: 303,
      }),
      createStore({
        "openai-codex:a": { email: "a@openai.test", accountId: "acct_a" },
        "openai-codex:b": { email: "b@openai.test", accountId: "acct_b" },
      }),
      303,
    );

    expect(rebound.runtimeBinding?.workerAiCredentialId).toBe(firstCredential?.id);
    expect(
      rebound.workerAiCredentials.find((credential) => credential.id === firstCredential?.id)
        ?.runtimeState,
    ).toBe("active");
    expect(
      rebound.workerAiCredentials.find((credential) => credential.id === secondCredential?.id)
        ?.runtimeState,
    ).toBe("standby");
  });

  it("mantém o AiProfile destacado quando a última credencial local desaparece", () => {
    const initialState = {
      ...createEmptyState(400),
      session: createMockSession({
        name: "Nuno",
        email: "nuno@example.com",
        now: 400,
      }),
    };
    const connected = rebuildAiAccountState(
      connectOpenAICodexCredential({
        state: initialState,
        authProfileId: "openai-codex:detached",
        email: "detached@openai.test",
        accountId: "acct_detached",
        now: 401,
      }),
      createStore({
        "openai-codex:detached": {
          email: "detached@openai.test",
          accountId: "acct_detached",
        },
      }),
      401,
    );

    const detached = rebuildAiAccountState(connected, createStore({}), 402);

    expect(detached.workerAiCredentials).toHaveLength(0);
    expect(detached.aiProfiles).toHaveLength(1);
    expect(detached.aiProfiles[0]?.attachmentState).toBe("detached");
    expect(detached.aiProfiles[0]?.healthStatus).toBe("unavailable");
  });
});
