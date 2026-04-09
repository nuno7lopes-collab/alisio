import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveNodeHostCapabilities } from "./capabilities.js";

describe("resolveNodeHostCapabilities", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("anuncia apenas as capabilities do nó e do runtime llama.cpp", async () => {
    const capabilities = await resolveNodeHostCapabilities({ browserProxyEnabled: false });
    const capabilityIds = capabilities.map((capability) => capability.id);

    expect(capabilityIds).toEqual([
      "exec.shell.v1",
      "model.catalog.llamacpp.v1",
      "model.manage.llamacpp.v1",
      "model.chat.llamacpp.v1",
    ]);
  });
});
