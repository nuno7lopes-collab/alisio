import { describe, expect, it } from "vitest";
import { collectNoLegacyProviderAdapterViolationsFromEntries } from "../../scripts/check-no-legacy-provider-adapter.mjs";

describe("check-no-legacy-provider-adapter", () => {
  it("accepts the converged provider adapter surface", () => {
    expect(
      collectNoLegacyProviderAdapterViolationsFromEntries([
        {
          filePath: "src/provider-adapters/alisio-provider-adapters.ts",
          content: `
            export type SourceKind = "managed-local" | "linked-node";
            export type ProviderAdapterEvent = { type: "text-delta"; text: string };
          `,
        },
      ]),
    ).toEqual([]);
  });

  it("flags blocked legacy provider tokens", () => {
    const violations = collectNoLegacyProviderAdapterViolationsFromEntries([
      {
        filePath: "src/provider-adapters/alisio-provider-adapters.ts",
        content: [
          "",
          'const a = "server-\u006fpenai";',
          'const b = "ollama";',
          'const c = "remote model servers";',
          'const d = "model\u0053ervers";',
          "",
        ].join("\n"),
      },
    ]);

    expect(violations).toEqual([
      expect.objectContaining({ label: "ollama", line: 3 }),
      expect.objectContaining({ label: "remote model servers", line: 4 }),
      expect.objectContaining({ label: "legacy model state field", line: 5 }),
      expect.objectContaining({ label: "legacy server openai token", line: 2 }),
    ]);
  });
});
