import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopWorkerServer } from "./server.js";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createTempDir() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "desktop-worker-"));
  createdDirs.push(directory);
  return directory;
}

describe("createDesktopWorkerServer", () => {
  it("serve a shell web glass com tabs dedicadas", async () => {
    const storageDir = await createTempDir();
    const server = await createDesktopWorkerServer({
      port: 43288,
      storageDir,
    });

    const response = await fetch(server.baseUrl);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Iniciar sessão");
    expect(html).toContain("Pergunta alguma coisa");
    expect(html).toContain("Estado");
    expect(html).toContain('id="sync-status"');
    expect(html).toContain('id="initial-state"');
    expect(html).toContain('class="tab-page chat-page active"');

    await server.close();
  });

  it("persiste a sessão mockada e devolve estado do worker", async () => {
    const storageDir = await createTempDir();
    const server = await createDesktopWorkerServer({
      port: 43289,
      storageDir,
    });

    const registerResponse = await fetch(`${server.baseUrl}/auth/mock/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Nuno",
        email: "nuno@example.com",
      }),
    });
    const registerPayload = await registerResponse.json();
    expect(registerPayload.session.email).toBe("nuno@example.com");

    const statusResponse = await fetch(`${server.baseUrl}/worker/status`);
    const statusPayload = await statusResponse.json();
    expect(statusPayload.state).toBe("ready");
    expect(statusPayload.hasSession).toBe(true);

    await server.close();

    const reopened = await createDesktopWorkerServer({
      port: 43290,
      storageDir,
    });
    const sessionResponse = await fetch(`${reopened.baseUrl}/auth/mock/session`);
    const sessionPayload = await sessionResponse.json();
    expect(sessionPayload.session.email).toBe("nuno@example.com");
    await reopened.close();
  });

  it("envia uma mensagem de chat e devolve transcript", async () => {
    const storageDir = await createTempDir();
    const server = await createDesktopWorkerServer(
      {
        port: 43291,
        storageDir,
      },
      {
        prepareModel: vi.fn().mockResolvedValue({
          error: "chave em falta",
        }),
      },
    );

    await fetch(`${server.baseUrl}/auth/mock/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Nuno",
        email: "nuno@example.com",
      }),
    });

    const response = await fetch(`${server.baseUrl}/chat/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "Olá",
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.transcript).toHaveLength(2);
    expect(payload.transcript[0].role).toBe("user");
    expect(payload.transcript[1].role).toBe("assistant");

    await server.close();
  });

  it("expõe o estado do OpenAI OAuth e aceita iniciar o fluxo local", async () => {
    const storageDir = await createTempDir();
    const oauth = {
      getSnapshot: vi.fn().mockReturnValue({
        phase: "idle",
        connected: false,
      }),
      start: vi.fn().mockResolvedValue({
        phase: "waiting_browser",
        connected: false,
        authUrl: "https://example.com/oauth",
        message: "Abre a janela de login.",
      }),
      submitManual: vi.fn().mockReturnValue({
        phase: "success",
        connected: true,
        profileId: "profile-123",
        email: "nuno@example.com",
      }),
    };

    const server = await createDesktopWorkerServer(
      {
        port: 43292,
        storageDir,
      },
      {
        oauth,
      },
    );

    const settingsResponse = await fetch(`${server.baseUrl}/settings`);
    const settingsPayload = await settingsResponse.json();
    expect(settingsPayload.settings.oauth.phase).toBe("idle");

    const startResponse = await fetch(`${server.baseUrl}/auth/openai-codex/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const startPayload = await startResponse.json();
    expect(startPayload.oauth.authUrl).toBe("https://example.com/oauth");

    const manualResponse = await fetch(`${server.baseUrl}/auth/openai-codex/manual`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        value: "manual-code",
      }),
    });
    const manualPayload = await manualResponse.json();
    expect(manualPayload.oauth.connected).toBe(true);
    expect(oauth.submitManual).toHaveBeenCalledWith("manual-code");

    await server.close();
  });

  it("serve a página intermédia de lançamento do OAuth", async () => {
    const storageDir = await createTempDir();
    const server = await createDesktopWorkerServer({
      port: 43294,
      storageDir,
    });

    const response = await fetch(`${server.baseUrl}/auth/openai-codex/launch`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Ligar OpenAI");
    expect(body).toContain("/auth/openai-codex/start");
    expect(body).toContain("/auth/openai-codex/status");

    await server.close();
  });

  it("usa OpenAI Codex automaticamente quando o OAuth já está ligado", async () => {
    const storageDir = await createTempDir();
    const oauth = {
      getSnapshot: vi.fn().mockReturnValue({
        phase: "idle",
        connected: true,
        profileId: "openai-codex:default",
        email: "nuno@example.com",
      }),
      start: vi.fn(),
      submitManual: vi.fn(),
    };
    const prepareModel = vi.fn().mockResolvedValue({
      error: "chave em falta",
    });

    const server = await createDesktopWorkerServer(
      {
        port: 43293,
        storageDir,
      },
      {
        oauth,
        prepareModel,
      },
    );

    await fetch(`${server.baseUrl}/auth/mock/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Nuno",
        email: "nuno@example.com",
      }),
    });

    const settingsResponse = await fetch(`${server.baseUrl}/settings`);
    const settingsPayload = await settingsResponse.json();
    expect(settingsPayload.settings.provider).toBe("openai-codex");

    await fetch(`${server.baseUrl}/chat/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "Olá",
      }),
    });

    expect(prepareModel).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai-codex",
        openAiCodexAuthProfileId: "openai-codex:default",
      }),
    );

    await server.close();
  });
});
