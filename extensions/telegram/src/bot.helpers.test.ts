import type { AlisioConfig } from "alisio/plugin-sdk/config-runtime";
import { describe, expect, it } from "vitest";
import { resolveTelegramStreamMode } from "./bot/helpers.js";
import { resolveTelegramDraftStreamingChunking } from "./draft-chunking.js";

describe("resolveTelegramStreamMode", () => {
  it("defaults to partial when telegram streaming is unset", () => {
    expect(resolveTelegramStreamMode(undefined)).toBe("partial");
    expect(resolveTelegramStreamMode({})).toBe("partial");
  });

  it("accepts explicit streaming enum values", () => {
    expect(resolveTelegramStreamMode({ streaming: "off" })).toBe("off");
    expect(resolveTelegramStreamMode({ streaming: "partial" })).toBe("partial");
    expect(resolveTelegramStreamMode({ streaming: "block" })).toBe("block");
  });

  it("maps unified progress mode to partial on Telegram", () => {
    expect(resolveTelegramStreamMode({ streaming: "progress" })).toBe("partial");
  });
});

describe("resolveTelegramDraftStreamingChunking", () => {
  it("uses smaller defaults than block streaming", () => {
    const chunking = resolveTelegramDraftStreamingChunking(undefined, "default");
    expect(chunking).toEqual({
      minChars: 200,
      maxChars: 800,
      breakPreference: "paragraph",
    });
  });

  it("clamps to telegram.textChunkLimit", () => {
    const cfg: AlisioConfig = {
      channels: { telegram: { allowFrom: ["*"], textChunkLimit: 150 } },
    };
    const chunking = resolveTelegramDraftStreamingChunking(cfg, "default");
    expect(chunking).toEqual({
      minChars: 150,
      maxChars: 150,
      breakPreference: "paragraph",
    });
  });

  it("supports per-account overrides", () => {
    const cfg: AlisioConfig = {
      channels: {
        telegram: {
          allowFrom: ["*"],
          accounts: {
            default: {
              allowFrom: ["*"],
              draftChunk: {
                minChars: 10,
                maxChars: 20,
                breakPreference: "sentence",
              },
            },
          },
        },
      },
    };
    const chunking = resolveTelegramDraftStreamingChunking(cfg, "default");
    expect(chunking).toEqual({
      minChars: 10,
      maxChars: 20,
      breakPreference: "sentence",
    });
  });
});
