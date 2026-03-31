import { describe, expect, it, vi } from "vitest";
import { invokeToolAlias, resolveToolCommand } from "./tool-aliases.js";

describe("resolveToolCommand", () => {
  it("usa whoami no macOS", () => {
    expect(resolveToolCommand("system.whoami", "darwin")).toEqual({
      command: "whoami",
      args: [],
    });
  });

  it("usa whoami.exe no Windows", () => {
    expect(resolveToolCommand("system.whoami", "win32")).toEqual({
      command: "whoami.exe",
      args: [],
    });
  });
});

describe("invokeToolAlias", () => {
  it("devolve output quando o comando termina com sucesso", async () => {
    const execFile = vi.fn().mockResolvedValue({
      stdout: "nuno\n",
      stderr: "",
    });

    const result = await invokeToolAlias(
      { alias: "system.whoami" },
      {
        execFile,
        platform: "darwin",
      },
    );

    expect(result).toEqual({
      alias: "system.whoami",
      output: "nuno",
      exitCode: 0,
      isError: false,
    });
  });

  it("devolve erro normalizado quando o comando falha", async () => {
    const execFile = vi.fn().mockRejectedValue({
      stderr: "falhou",
      code: 127,
    });

    const result = await invokeToolAlias(
      { alias: "system.whoami" },
      {
        execFile,
        platform: "darwin",
      },
    );

    expect(result).toEqual({
      alias: "system.whoami",
      output: "falhou",
      exitCode: 127,
      isError: true,
    });
  });
});
