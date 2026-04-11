import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeAttemptResult } from "./run.overflow-compaction.fixture.js";
import {
  loadRunOverflowCompactionHarness,
  mockedClassifyFailoverReason,
  mockedFormatAssistantErrorText,
  mockedIsFailoverAssistantError,
  mockedResolveAuthProfileOrder,
  mockedRestoreTranscriptLeafInSessionFile,
  mockedRunEmbeddedAttempt,
  overflowBaseRunParams,
  resetRunOverflowCompactionHarnessMocks,
} from "./run.overflow-compaction.harness.js";
import type { EmbeddedRunAttemptResult } from "./run/types.js";

let runEmbeddedPiAgent: typeof import("./run.js").runEmbeddedPiAgent;

describe("runEmbeddedPiAgent transcript rewind before retry", () => {
  beforeAll(async () => {
    ({ runEmbeddedPiAgent } = await loadRunOverflowCompactionHarness());
  });

  beforeEach(() => {
    resetRunOverflowCompactionHarnessMocks();
  });

  it("rewinds the failed turn before rotating auth profiles on assistant rate limits", async () => {
    mockedResolveAuthProfileOrder.mockReturnValue(["profile-a", "profile-b"]);
    mockedClassifyFailoverReason.mockReturnValue("rate_limit");
    mockedIsFailoverAssistantError.mockReturnValue(true);
    mockedFormatAssistantErrorText.mockReturnValue(
      "⚠️ You have hit your ChatGPT usage limit (team plan). Try again in ~174 min.",
    );

    mockedRunEmbeddedAttempt
      .mockResolvedValueOnce(
        makeAttemptResult({
          prePromptTranscriptLeafId: "assistant-1",
          assistantTexts: [],
          lastAssistant: {
            stopReason: "error",
            errorMessage:
              "You have hit your ChatGPT usage limit (team plan). Try again in ~174 min.",
            provider: "openai-codex",
            model: "gpt-5.3-codex",
          } as EmbeddedRunAttemptResult["lastAssistant"],
        }),
      )
      .mockResolvedValueOnce(
        makeAttemptResult({
          prePromptTranscriptLeafId: "assistant-1",
          promptError: null,
          assistantTexts: ["Resposta final"],
        }),
      );

    await runEmbeddedPiAgent(overflowBaseRunParams);

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(2);
    expect(mockedRestoreTranscriptLeafInSessionFile).toHaveBeenCalledTimes(1);
    expect(mockedRestoreTranscriptLeafInSessionFile).toHaveBeenCalledWith({
      sessionFile: "/tmp/session.json",
      sessionId: "test-session",
      sessionKey: "test-key",
      targetEntryId: "assistant-1",
    });
  });
});
