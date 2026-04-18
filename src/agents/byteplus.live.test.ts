import { completeSimple, type Model } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import {
  buildBytePlusModelDefinition,
  BYTEPLUS_CODING_BASE_URL,
  BYTEPLUS_CODING_MODEL_CATALOG,
} from "../plugin-sdk/byteplus.js";
import {
  createSingleUserPromptMessage,
  extractNonEmptyAssistantText,
  isLiveTestEnabled,
} from "./live-test-helpers.js";

const BYTEPLUS_KEY = process.env.BYTEPLUS_API_KEY ?? "";
const BYTEPLUS_CODING_MODEL = process.env.BYTEPLUS_CODING_MODEL?.trim() || "ark-code-latest";
const LIVE = isLiveTestEnabled(["BYTEPLUS_LIVE_TEST"]);

const describeLive = LIVE && BYTEPLUS_KEY ? describe : describe.skip;

function isBytePlusSubscriptionError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("coding plan subscription") ||
    lower.includes("subscription has expired") ||
    (lower.includes("subscription") && lower.includes("renewal"))
  );
}

describeLive("byteplus coding plan live", () => {
  it("returns assistant text", async () => {
    const codingCatalogEntry =
      BYTEPLUS_CODING_MODEL_CATALOG.find((entry) => entry.id === BYTEPLUS_CODING_MODEL) ??
      BYTEPLUS_CODING_MODEL_CATALOG[0];
    if (!codingCatalogEntry) {
      throw new Error("BytePlus coding catalog is empty");
    }

    const definition = buildBytePlusModelDefinition(codingCatalogEntry);
    const model: Model<"openai-completions"> = {
      ...definition,
      id: BYTEPLUS_CODING_MODEL,
      name: `BytePlus Coding ${BYTEPLUS_CODING_MODEL}`,
      api: "openai-completions",
      provider: "byteplus-plan",
      baseUrl: BYTEPLUS_CODING_BASE_URL,
    };

    const res = await completeSimple(
      model,
      {
        messages: createSingleUserPromptMessage(),
      },
      { apiKey: BYTEPLUS_KEY, maxTokens: 64 },
    );

    if (res.stopReason === "error") {
      const message = res.errorMessage ?? "";
      if (isBytePlusSubscriptionError(message)) {
        expect(message.toLowerCase()).toContain("subscription");
        return;
      }
      throw new Error(message || "byteplus returned error with no message");
    }

    const text = extractNonEmptyAssistantText(res.content);
    expect(text.length).toBeGreaterThan(0);
  }, 30000);
});
