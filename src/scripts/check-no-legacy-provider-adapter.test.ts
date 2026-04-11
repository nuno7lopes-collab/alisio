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
          ['const a = "', ["server-", "openai"].join(""), '";'].join(""),
          ['const b = "', ["openai", "compatible"].join("-"), '";'].join(""),
          ['const c = "', ["remote model", " servers"].join(""), '";'].join(""),
          ['const d = "', ["model", "Servers"].join(""), '";'].join(""),
          ['const e = "', ["local", " servers"].join(""), '";'].join(""),
          "",
        ].join("\n"),
      },
    ]);

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: ["openai", "compatible"].join("-"), line: 3 }),
        expect.objectContaining({ label: "legacy remote endpoint copy", line: 4 }),
        expect.objectContaining({ label: "legacy model state field", line: 5 }),
        expect.objectContaining({ label: ["local", " servers"].join(""), line: 6 }),
        expect.objectContaining({ label: "legacy server openai token", line: 2 }),
      ]),
    );
    expect(violations).toHaveLength(5);
  });
});
