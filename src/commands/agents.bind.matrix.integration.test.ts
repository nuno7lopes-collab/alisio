import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import {
  createBindingResolverTestPlugin,
  createTestRegistry,
} from "../test-utils/channel-plugins.js";
import { mergeMockedModule } from "../test-utils/vitest-module-mocks.js";
import {
  baseConfigSnapshot,
  createTestRuntime,
} from "./test-runtime-config-helpers.js";

type ReplaceConfigFileResult = Awaited<
  ReturnType<(typeof import("../config/config.js"))["replaceConfigFile"]>
>;

const readConfigFileSnapshotMock = vi.fn();
const writeConfigFileMock = vi.fn().mockResolvedValue(undefined);
const replaceConfigFileMock = vi.fn(
  async (params: {
    nextConfig: import("../config/config.js").AlisioConfig;
  }): Promise<ReplaceConfigFileResult> => {
    await writeConfigFileMock(params.nextConfig);
    return {
      path: "/tmp/alisio.json",
      previousHash: null,
      snapshot: {} as never,
      nextConfig: params.nextConfig,
    };
  },
);

vi.mock("../config/config.js", async (importOriginal) => {
  return await mergeMockedModule(
    await importOriginal<typeof import("../config/config.js")>(),
    () => ({
      readConfigFileSnapshot: readConfigFileSnapshotMock,
      writeConfigFile: writeConfigFileMock,
      replaceConfigFile: replaceConfigFileMock,
    }),
  );
});

const runtime = createTestRuntime();

async function loadFreshAgentsCommandModuleForTest() {
  vi.resetModules();
  return await import("./agents.js");
}

function resetAgentsBindTestHarness(): void {
  readConfigFileSnapshotMock.mockClear();
  writeConfigFileMock.mockClear();
  replaceConfigFileMock.mockClear();
  runtime.log.mockClear();
  runtime.error.mockClear();
  runtime.exit.mockClear();
}

const matrixBindingPlugin = createBindingResolverTestPlugin({
  id: "matrix",
  resolveBindingAccountId: ({ accountId, agentId }) => {
    const explicit = accountId?.trim();
    if (explicit) {
      return explicit;
    }
    const agent = agentId?.trim();
    return agent || "default";
  },
});

let agentsBindCommand: typeof import("./agents.js").agentsBindCommand;

describe("agents bind matrix integration", () => {
  beforeEach(async () => {
    ({ agentsBindCommand } = await loadFreshAgentsCommandModuleForTest());
    resetAgentsBindTestHarness();

    setActivePluginRegistry(
      createTestRegistry([{ pluginId: "matrix", plugin: matrixBindingPlugin, source: "test" }]),
    );
  });

  afterEach(() => {
    setActivePluginRegistry(createTestRegistry());
  });

  it("uses matrix plugin binding resolver when accountId is omitted", async () => {
    readConfigFileSnapshotMock.mockResolvedValue({
      ...baseConfigSnapshot,
      config: {},
    });

    await agentsBindCommand({ agent: "main", bind: ["matrix"] }, runtime);

    expect(writeConfigFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bindings: [
          { type: "route", agentId: "main", match: { channel: "matrix", accountId: "main" } },
        ],
      }),
    );
    expect(runtime.exit).not.toHaveBeenCalled();
  });
});
