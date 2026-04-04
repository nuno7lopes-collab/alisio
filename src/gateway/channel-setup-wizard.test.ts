import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  applyPluginAutoEnable: vi.fn(),
  writeConfigFile: vi.fn(),
  createCollector: vi.fn(),
  runHooks: vi.fn(),
  setupChannels: vi.fn(),
}));

vi.mock("../config/config.js", async () => {
  const actual = await vi.importActual<typeof import("../config/config.js")>("../config/config.js");
  return {
    ...actual,
    loadConfig: mocks.loadConfig,
    writeConfigFile: mocks.writeConfigFile,
  };
});

vi.mock("../config/plugin-auto-enable.js", () => ({
  applyPluginAutoEnable: mocks.applyPluginAutoEnable,
}));

vi.mock("../flows/channel-setup.js", () => ({
  createChannelOnboardingPostWriteHookCollector: mocks.createCollector,
  runCollectedChannelOnboardingPostWriteHooks: mocks.runHooks,
  setupChannels: mocks.setupChannels,
}));

import { runChannelSetupWizard } from "./channel-setup-wizard.js";

describe("runChannelSetupWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfig.mockReturnValue({});
    mocks.applyPluginAutoEnable.mockImplementation(({ config }) => ({ config, changes: [] }));
    mocks.writeConfigFile.mockResolvedValue(undefined);
    mocks.runHooks.mockResolvedValue(undefined);
    mocks.createCollector.mockReturnValue({
      collect: vi.fn(),
      drain: vi.fn(() => []),
    });
  });

  it("aceita telegram como chat channel e arranca o canal configurado", async () => {
    const nextConfig = { channels: { telegram: { botToken: "123:abc" } } };
    mocks.setupChannels.mockImplementation(async (_cfg, _runtime, _prompter, options) => {
      options?.onAccountId?.("telegram", "default");
      return nextConfig;
    });

    const outro = vi.fn(async () => undefined);
    const startChannel = vi.fn(async () => undefined);

    await runChannelSetupWizard({
      opts: { channel: "telegram" },
      runtime: {} as never,
      prompter: { outro } as never,
      startChannel,
    });

    expect(mocks.setupChannels).toHaveBeenCalledWith(
      {},
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        skipSelectionPrompt: true,
        initialSelection: ["telegram"],
      }),
    );
    expect(mocks.writeConfigFile).toHaveBeenCalledWith(nextConfig);
    expect(startChannel).toHaveBeenCalledWith("telegram", "default");
    expect(outro).toHaveBeenCalledWith(
      "Configuração guardada. O canal vai aparecer na página de Canais assim que estiver pronto.",
    );
  });

  it("mostra a mensagem QR quando o canal é whatsapp", async () => {
    mocks.setupChannels.mockImplementation(async (_cfg, _runtime, _prompter, options) => {
      options?.onAccountId?.("whatsapp", "default");
      return { channels: { whatsapp: { accounts: { default: { enabled: true } } } } };
    });

    const outro = vi.fn(async () => undefined);
    const startChannel = vi.fn(async () => undefined);

    await runChannelSetupWizard({
      opts: { channel: "whatsapp" },
      runtime: {} as never,
      prompter: { outro } as never,
      startChannel,
    });

    expect(startChannel).toHaveBeenCalledWith("whatsapp", "default");
    expect(outro).toHaveBeenCalledWith(
      "Configuração guardada. Continua no QR para concluir a ligação do WhatsApp.",
    );
  });
});
