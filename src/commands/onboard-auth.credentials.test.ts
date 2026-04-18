import { afterEach, describe, expect, it } from "vitest";
import {
  createAuthTestLifecycle,
  readAuthProfilesForAgent,
  setupAuthTestEnv,
} from "../../test/helpers/auth-wizard.js";
import { upsertAuthProfile } from "../agents/auth-profiles.js";
import type { SecretInput } from "../config/types.secrets.js";
import {
  buildApiKeyCredential,
  type ApiKeyStorageOptions,
} from "../plugins/provider-auth-helpers.js";

function upsertProviderApiKeyProfile(params: {
  provider: string;
  key: SecretInput;
  agentDir?: string;
  options?: ApiKeyStorageOptions;
  profileId?: string;
  metadata?: Record<string, string>;
}) {
  upsertAuthProfile({
    profileId: params.profileId ?? `${params.provider}:default`,
    credential: buildApiKeyCredential(params.provider, params.key, params.metadata, params.options),
    agentDir: params.agentDir,
  });
}

function createProviderApiKeySetter(provider: string) {
  return async (key: SecretInput, agentDir?: string, options?: ApiKeyStorageOptions) => {
    upsertProviderApiKeyProfile({ provider, key, agentDir, options });
  };
}

const setMoonshotApiKey = createProviderApiKeySetter("moonshot");
const setOpenaiApiKey = createProviderApiKeySetter("openai");
const setVolcengineApiKey = createProviderApiKeySetter("volcengine");
const setByteplusApiKey = createProviderApiKeySetter("byteplus");

async function setCloudflareAiGatewayConfig(
  accountId: string,
  gatewayId: string,
  apiKey: SecretInput,
  agentDir?: string,
  options?: ApiKeyStorageOptions,
) {
  upsertProviderApiKeyProfile({
    provider: "cloudflare-ai-gateway",
    key: apiKey,
    agentDir,
    options,
    metadata: {
      accountId: accountId.trim(),
      gatewayId: gatewayId.trim(),
    },
  });
}

async function setOpencodeZenApiKey(
  key: SecretInput,
  agentDir?: string,
  options?: ApiKeyStorageOptions,
) {
  for (const provider of ["opencode", "opencode-go"] as const) {
    upsertProviderApiKeyProfile({ provider, key, agentDir, options });
  }
}

describe("onboard auth credentials secret refs", () => {
  const lifecycle = createAuthTestLifecycle([
    "ALISIO_STATE_DIR",
    "ALISIO_AGENT_DIR",
    "PI_CODING_AGENT_DIR",
    "MOONSHOT_API_KEY",
    "OPENAI_API_KEY",
    "CLOUDFLARE_AI_GATEWAY_API_KEY",
    "VOLCANO_ENGINE_API_KEY",
    "BYTEPLUS_API_KEY",
    "OPENCODE_API_KEY",
  ]);

  afterEach(async () => {
    await lifecycle.cleanup();
  });

  type AuthProfileEntry = { key?: string; keyRef?: unknown; metadata?: unknown };

  async function withAuthEnv(
    prefix: string,
    run: (env: Awaited<ReturnType<typeof setupAuthTestEnv>>) => Promise<void>,
  ) {
    const env = await setupAuthTestEnv(prefix);
    lifecycle.setStateDir(env.stateDir);
    await run(env);
  }

  async function readProfile(
    agentDir: string,
    profileId: string,
  ): Promise<AuthProfileEntry | undefined> {
    const parsed = await readAuthProfilesForAgent<{
      profiles?: Record<string, AuthProfileEntry>;
    }>(agentDir);
    return parsed.profiles?.[profileId];
  }

  async function expectStoredAuthKey(params: {
    prefix: string;
    envVar?: string;
    envValue?: string;
    profileId: string;
    apply: (agentDir: string) => Promise<void>;
    expected: AuthProfileEntry;
    absent?: Array<keyof AuthProfileEntry>;
  }) {
    await withAuthEnv(params.prefix, async (env) => {
      if (params.envVar && params.envValue !== undefined) {
        process.env[params.envVar] = params.envValue;
      }
      await params.apply(env.agentDir);
      const profile = await readProfile(env.agentDir, params.profileId);
      expect(profile).toMatchObject(params.expected);
      for (const key of params.absent ?? []) {
        expect(profile?.[key]).toBeUndefined();
      }
    });
  }

  it("keeps env-backed moonshot key as plaintext by default", async () => {
    await expectStoredAuthKey({
      prefix: "alisio-onboard-auth-credentials-",
      envVar: "MOONSHOT_API_KEY",
      envValue: "sk-moonshot-env",
      profileId: "moonshot:default",
      apply: async () => {
        await setMoonshotApiKey("sk-moonshot-env");
      },
      expected: {
        key: "sk-moonshot-env",
      },
      absent: ["keyRef"],
    });
  });

  it("stores env-backed moonshot key as keyRef when secret-input-mode=ref", async () => {
    await expectStoredAuthKey({
      prefix: "alisio-onboard-auth-credentials-ref-",
      envVar: "MOONSHOT_API_KEY",
      envValue: "sk-moonshot-env",
      profileId: "moonshot:default",
      apply: async (agentDir) => {
        await setMoonshotApiKey("sk-moonshot-env", agentDir, { secretInputMode: "ref" }); // pragma: allowlist secret
      },
      expected: {
        keyRef: { source: "env", provider: "default", id: "MOONSHOT_API_KEY" },
      },
      absent: ["key"],
    });
  });

  it("stores ${ENV} moonshot input as keyRef even when env value is unset", async () => {
    await expectStoredAuthKey({
      prefix: "alisio-onboard-auth-credentials-inline-ref-",
      profileId: "moonshot:default",
      apply: async () => {
        await setMoonshotApiKey("${MOONSHOT_API_KEY}");
      },
      expected: {
        keyRef: { source: "env", provider: "default", id: "MOONSHOT_API_KEY" },
      },
      absent: ["key"],
    });
  });

  it("keeps plaintext moonshot key when no env ref applies", async () => {
    await expectStoredAuthKey({
      prefix: "alisio-onboard-auth-credentials-plaintext-",
      envVar: "MOONSHOT_API_KEY",
      envValue: "sk-moonshot-other",
      profileId: "moonshot:default",
      apply: async () => {
        await setMoonshotApiKey("sk-moonshot-plaintext");
      },
      expected: {
        key: "sk-moonshot-plaintext",
      },
      absent: ["keyRef"],
    });
  });

  it("preserves cloudflare metadata when storing keyRef", async () => {
    const env = await setupAuthTestEnv("alisio-onboard-auth-credentials-cloudflare-");
    lifecycle.setStateDir(env.stateDir);
    process.env.CLOUDFLARE_AI_GATEWAY_API_KEY = "cf-secret"; // pragma: allowlist secret

    await setCloudflareAiGatewayConfig("account-1", "gateway-1", "cf-secret", env.agentDir, {
      secretInputMode: "ref", // pragma: allowlist secret
    });

    const parsed = await readAuthProfilesForAgent<{
      profiles?: Record<string, { key?: string; keyRef?: unknown; metadata?: unknown }>;
    }>(env.agentDir);
    expect(parsed.profiles?.["cloudflare-ai-gateway:default"]).toMatchObject({
      keyRef: { source: "env", provider: "default", id: "CLOUDFLARE_AI_GATEWAY_API_KEY" },
      metadata: { accountId: "account-1", gatewayId: "gateway-1" },
    });
    expect(parsed.profiles?.["cloudflare-ai-gateway:default"]?.key).toBeUndefined();
  });

  it("keeps env-backed openai key as plaintext by default", async () => {
    await expectStoredAuthKey({
      prefix: "alisio-onboard-auth-credentials-openai-",
      envVar: "OPENAI_API_KEY",
      envValue: "sk-openai-env",
      profileId: "openai:default",
      apply: async () => {
        await setOpenaiApiKey("sk-openai-env");
      },
      expected: {
        key: "sk-openai-env",
      },
      absent: ["keyRef"],
    });
  });

  it("stores env-backed openai key as keyRef in ref mode", async () => {
    await expectStoredAuthKey({
      prefix: "alisio-onboard-auth-credentials-openai-ref-",
      envVar: "OPENAI_API_KEY",
      envValue: "sk-openai-env",
      profileId: "openai:default",
      apply: async (agentDir) => {
        await setOpenaiApiKey("sk-openai-env", agentDir, { secretInputMode: "ref" }); // pragma: allowlist secret
      },
      expected: {
        keyRef: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
      },
      absent: ["key"],
    });
  });

  it("stores env-backed volcengine and byteplus keys as keyRef in ref mode", async () => {
    const env = await setupAuthTestEnv("alisio-onboard-auth-credentials-volc-byte-");
    lifecycle.setStateDir(env.stateDir);
    process.env.VOLCANO_ENGINE_API_KEY = "volcengine-secret"; // pragma: allowlist secret
    process.env.BYTEPLUS_API_KEY = "byteplus-secret"; // pragma: allowlist secret

    await setVolcengineApiKey("volcengine-secret", env.agentDir, { secretInputMode: "ref" }); // pragma: allowlist secret
    await setByteplusApiKey("byteplus-secret", env.agentDir, { secretInputMode: "ref" }); // pragma: allowlist secret

    const parsed = await readAuthProfilesForAgent<{
      profiles?: Record<string, { key?: string; keyRef?: unknown }>;
    }>(env.agentDir);

    expect(parsed.profiles?.["volcengine:default"]).toMatchObject({
      keyRef: { source: "env", provider: "default", id: "VOLCANO_ENGINE_API_KEY" },
    });
    expect(parsed.profiles?.["volcengine:default"]?.key).toBeUndefined();

    expect(parsed.profiles?.["byteplus:default"]).toMatchObject({
      keyRef: { source: "env", provider: "default", id: "BYTEPLUS_API_KEY" },
    });
    expect(parsed.profiles?.["byteplus:default"]?.key).toBeUndefined();
  });

  it("stores shared OpenCode credentials for both runtime providers", async () => {
    const env = await setupAuthTestEnv("alisio-onboard-auth-credentials-opencode-");
    lifecycle.setStateDir(env.stateDir);
    process.env.OPENCODE_API_KEY = "sk-opencode-env"; // pragma: allowlist secret

    await setOpencodeZenApiKey("sk-opencode-env", env.agentDir, {
      secretInputMode: "ref", // pragma: allowlist secret
    });

    const parsed = await readAuthProfilesForAgent<{
      profiles?: Record<string, { key?: string; keyRef?: unknown }>;
    }>(env.agentDir);

    expect(parsed.profiles?.["opencode:default"]).toMatchObject({
      keyRef: { source: "env", provider: "default", id: "OPENCODE_API_KEY" },
    });
    expect(parsed.profiles?.["opencode-go:default"]).toMatchObject({
      keyRef: { source: "env", provider: "default", id: "OPENCODE_API_KEY" },
    });
  });
});
