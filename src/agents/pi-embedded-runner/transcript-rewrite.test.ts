import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const acquireSessionWriteLockReleaseMock = vi.hoisted(() => vi.fn(async () => {}));
const acquireSessionWriteLockMock = vi.hoisted(() =>
  vi.fn(async (_params?: unknown) => ({ release: acquireSessionWriteLockReleaseMock })),
);

vi.mock("../session-write-lock.js", () => ({
  acquireSessionWriteLock: (params: unknown) => acquireSessionWriteLockMock(params),
}));

let rewriteTranscriptEntriesInSessionFile: typeof import("./transcript-rewrite.js").rewriteTranscriptEntriesInSessionFile;
let rewriteTranscriptEntriesInSessionManager: typeof import("./transcript-rewrite.js").rewriteTranscriptEntriesInSessionManager;
let restoreTranscriptLeafInSessionFile: typeof import("./transcript-rewrite.js").restoreTranscriptLeafInSessionFile;
let restoreTranscriptLeafInSessionManager: typeof import("./transcript-rewrite.js").restoreTranscriptLeafInSessionManager;
let findLatestUserMessageEntryMatchingPrompt: typeof import("./transcript-rewrite.js").findLatestUserMessageEntryMatchingPrompt;
let replaceUserMessageTextPreservingMedia: typeof import("./transcript-rewrite.js").replaceUserMessageTextPreservingMedia;
let rewriteLatestUserPromptInMessages: typeof import("./transcript-rewrite.js").rewriteLatestUserPromptInMessages;
let onSessionTranscriptUpdate: typeof import("../../sessions/transcript-events.js").onSessionTranscriptUpdate;
let installSessionToolResultGuard: typeof import("../session-tool-result-guard.js").installSessionToolResultGuard;

async function loadFreshTranscriptRewriteModuleForTest() {
  vi.resetModules();
  vi.doMock("../session-write-lock.js", () => ({
    acquireSessionWriteLock: (params: unknown) => acquireSessionWriteLockMock(params),
  }));
  ({ onSessionTranscriptUpdate } = await import("../../sessions/transcript-events.js"));
  ({ installSessionToolResultGuard } = await import("../session-tool-result-guard.js"));
  ({
    findLatestUserMessageEntryMatchingPrompt,
    replaceUserMessageTextPreservingMedia,
    rewriteTranscriptEntriesInSessionFile,
    rewriteTranscriptEntriesInSessionManager,
    rewriteLatestUserPromptInMessages,
    restoreTranscriptLeafInSessionFile,
    restoreTranscriptLeafInSessionManager,
  } = await import("./transcript-rewrite.js"));
}

type AppendMessage = Parameters<SessionManager["appendMessage"]>[0];

function asAppendMessage(message: unknown): AppendMessage {
  return message as AppendMessage;
}

function getBranchMessages(sessionManager: SessionManager): AgentMessage[] {
  return sessionManager
    .getBranch()
    .filter((entry) => entry.type === "message")
    .map((entry) => entry.message);
}

function appendSessionMessages(
  sessionManager: SessionManager,
  messages: AppendMessage[],
): string[] {
  return messages.map((message) => sessionManager.appendMessage(message));
}

function createTextContent(text: string) {
  return [{ type: "text", text }];
}

function createReadRewriteSession(options?: { tailAssistantText?: string }) {
  const sessionManager = SessionManager.inMemory();
  const entryIds = appendSessionMessages(sessionManager, [
    asAppendMessage({
      role: "user",
      content: "read file",
      timestamp: 1,
    }),
    asAppendMessage({
      role: "assistant",
      content: [{ type: "toolCall", id: "call_1", name: "read", arguments: {} }],
      timestamp: 2,
    }),
    asAppendMessage({
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "read",
      content: createTextContent("x".repeat(8_000)),
      isError: false,
      timestamp: 3,
    }),
    asAppendMessage({
      role: "assistant",
      content: createTextContent(options?.tailAssistantText ?? "summarized"),
      timestamp: 4,
    }),
  ]);
  return {
    sessionManager,
    toolResultEntryId: entryIds[2],
    tailAssistantEntryId: entryIds[3],
  };
}

function createExecRewriteSession() {
  const sessionManager = SessionManager.inMemory();
  const entryIds = appendSessionMessages(sessionManager, [
    asAppendMessage({
      role: "user",
      content: "run tool",
      timestamp: 1,
    }),
    asAppendMessage({
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "exec",
      content: createTextContent("before rewrite"),
      isError: false,
      timestamp: 2,
    }),
    asAppendMessage({
      role: "assistant",
      content: createTextContent("summarized"),
      timestamp: 3,
    }),
  ]);
  return {
    sessionManager,
    toolResultEntryId: entryIds[1],
  };
}

function createToolResultReplacement(toolName: string, text: string, timestamp: number) {
  return {
    role: "toolResult",
    toolCallId: "call_1",
    toolName,
    content: createTextContent(text),
    isError: false,
    timestamp,
  } as AgentMessage;
}

function findAssistantEntryByText(sessionManager: SessionManager, text: string) {
  return sessionManager
    .getBranch()
    .find(
      (entry) =>
        entry.type === "message" &&
        entry.message.role === "assistant" &&
        Array.isArray(entry.message.content) &&
        entry.message.content.some((part) => part.type === "text" && part.text === text),
    );
}

beforeEach(async () => {
  acquireSessionWriteLockMock.mockClear();
  acquireSessionWriteLockReleaseMock.mockClear();
  await loadFreshTranscriptRewriteModuleForTest();
});

describe("rewriteTranscriptEntriesInSessionManager", () => {
  it("branches from the first replaced message and re-appends the remaining suffix", () => {
    const { sessionManager, toolResultEntryId } = createReadRewriteSession();

    const result = rewriteTranscriptEntriesInSessionManager({
      sessionManager,
      replacements: [
        {
          entryId: toolResultEntryId,
          message: createToolResultReplacement("read", "[externalized file_123]", 3),
        },
      ],
    });

    expect(result).toMatchObject({
      changed: true,
      rewrittenEntries: 1,
    });
    expect(result.bytesFreed).toBeGreaterThan(0);

    const branchMessages = getBranchMessages(sessionManager);
    expect(branchMessages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
    ]);
    const rewrittenToolResult = branchMessages[2] as Extract<AgentMessage, { role: "toolResult" }>;
    expect(rewrittenToolResult.content).toEqual([
      { type: "text", text: "[externalized file_123]" },
    ]);
  });

  it("preserves active-branch labels after rewritten entries are re-appended", () => {
    const { sessionManager, toolResultEntryId } = createReadRewriteSession();
    const summaryEntry = findAssistantEntryByText(sessionManager, "summarized");
    expect(summaryEntry).toBeDefined();
    sessionManager.appendLabelChange(summaryEntry!.id, "bookmark");

    const result = rewriteTranscriptEntriesInSessionManager({
      sessionManager,
      replacements: [
        {
          entryId: toolResultEntryId,
          message: createToolResultReplacement("read", "[externalized file_123]", 3),
        },
      ],
    });

    expect(result.changed).toBe(true);
    const rewrittenSummaryEntry = findAssistantEntryByText(sessionManager, "summarized");
    expect(rewrittenSummaryEntry).toBeDefined();
    expect(sessionManager.getLabel(rewrittenSummaryEntry!.id)).toBe("bookmark");
    expect(sessionManager.getBranch().some((entry) => entry.type === "label")).toBe(true);
  });

  it("remaps compaction keep markers when rewritten entries change ids", () => {
    const {
      sessionManager,
      toolResultEntryId,
      tailAssistantEntryId: keptAssistantEntryId,
    } = createReadRewriteSession({ tailAssistantText: "keep me" });
    sessionManager.appendCompaction("summary", keptAssistantEntryId, 123);

    const result = rewriteTranscriptEntriesInSessionManager({
      sessionManager,
      replacements: [
        {
          entryId: toolResultEntryId,
          message: createToolResultReplacement("read", "[externalized file_123]", 3),
        },
      ],
    });

    expect(result.changed).toBe(true);
    const branch = sessionManager.getBranch();
    const keptAssistantEntry = branch.find(
      (entry) =>
        entry.type === "message" &&
        entry.message.role === "assistant" &&
        Array.isArray(entry.message.content) &&
        entry.message.content.some((part) => part.type === "text" && part.text === "keep me"),
    );
    const compactionEntry = branch.find((entry) => entry.type === "compaction");

    expect(keptAssistantEntry).toBeDefined();
    expect(compactionEntry).toBeDefined();
    expect(compactionEntry?.firstKeptEntryId).toBe(keptAssistantEntry?.id);
    expect(compactionEntry?.firstKeptEntryId).not.toBe(keptAssistantEntryId);
  });

  it("bypasses persistence hooks when replaying rewritten messages", () => {
    const { sessionManager, toolResultEntryId } = createExecRewriteSession();
    installSessionToolResultGuard(sessionManager, {
      transformToolResultForPersistence: (message) => ({
        ...(message as Extract<AgentMessage, { role: "toolResult" }>),
        content: [{ type: "text", text: "[hook transformed]" }],
      }),
      beforeMessageWriteHook: ({ message }) =>
        message.role === "assistant" ? { block: true } : undefined,
    });

    const result = rewriteTranscriptEntriesInSessionManager({
      sessionManager,
      replacements: [
        {
          entryId: toolResultEntryId,
          message: createToolResultReplacement("exec", "[exact replacement]", 2),
        },
      ],
    });

    expect(result.changed).toBe(true);
    const branchMessages = getBranchMessages(sessionManager);
    expect(branchMessages.map((message) => message.role)).toEqual([
      "user",
      "toolResult",
      "assistant",
    ]);
    expect((branchMessages[1] as Extract<AgentMessage, { role: "toolResult" }>).content).toEqual([
      { type: "text", text: "[exact replacement]" },
    ]);
    expect(branchMessages[2]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "summarized" }],
    });
  });
});

describe("user prompt canonicalization helpers", () => {
  it("finds the latest appended user turn by its persisted prompt text", () => {
    const sessionManager = SessionManager.inMemory();
    const [firstUserId, , latestUserId] = appendSessionMessages(sessionManager, [
      asAppendMessage({ role: "user", content: "older ask", timestamp: 1 }),
      asAppendMessage({
        role: "assistant",
        content: createTextContent("older answer"),
        timestamp: 2,
      }),
      asAppendMessage({
        role: "user",
        content: [
          {
            type: "text",
            text: "System: [2026-04-14 23:31:26 GMT+1] reason connect\n\n[Tue 2026-04-14 23:45 GMT+1] ola",
          },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
        ],
        timestamp: 3,
      }),
    ]);

    const matched = findLatestUserMessageEntryMatchingPrompt({
      sessionManager,
      afterEntryId: firstUserId,
      promptText:
        "System: [2026-04-14 23:31:26 GMT+1] reason connect\n\n[Tue 2026-04-14 23:45 GMT+1] ola",
    });

    expect(matched?.id).toBe(latestUserId);
  });

  it("matches the latest user turn by stripped persisted text when the stored prompt contains inbound metadata", () => {
    const sessionManager = SessionManager.inMemory();
    const [, latestUserId] = appendSessionMessages(sessionManager, [
      asAppendMessage({
        role: "assistant",
        content: createTextContent("older answer"),
        timestamp: 1,
      }),
      asAppendMessage({
        role: "user",
        content: [
          {
            type: "text",
            text:
              'Sender (untrusted metadata):\n```json\n{"label":"alisio-control-ui"}\n```\n\n[Thu 2026-04-16 15:02 GMT+1] abre o google',
          },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
        ],
        timestamp: 2,
      }),
    ]);

    const matched = findLatestUserMessageEntryMatchingPrompt({
      sessionManager,
      promptText: "System prompt facing wrapper that no longer matches the stored turn",
      candidateTexts: ["abre o google"],
    });

    expect(matched?.id).toBe(latestUserId);
  });

  it("replaces only the text blocks while preserving user media blocks", () => {
    const rewritten = replaceUserMessageTextPreservingMedia(
      {
        role: "user",
        content: [
          { type: "text", text: "System: [t] connect\n\n[Tue 2026-04-14 23:45 GMT+1] ola" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
        ],
        timestamp: 1,
      },
      "ola",
    );

    expect(rewritten).toEqual({
      role: "user",
      content: [
        { type: "text", text: "ola" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
      ],
      timestamp: 1,
    });
  });

  it("rewrites the latest matching user prompt in in-memory snapshots", () => {
    const messages = rewriteLatestUserPromptInMessages({
      messages: [
        { role: "user", content: "older ask", timestamp: 1 },
        { role: "assistant", content: createTextContent("older answer"), timestamp: 2 },
        {
          role: "user",
          content: [
            { type: "text", text: "System: [t] connect\n\n[Tue 2026-04-14 23:45 GMT+1] ola" },
          ],
          timestamp: 3,
        },
      ] as AgentMessage[],
      promptText: "System: [t] connect\n\n[Tue 2026-04-14 23:45 GMT+1] ola",
      replacementText: "ola",
    });

    expect(messages.at(-1)).toEqual({
      role: "user",
      content: [{ type: "text", text: "ola" }],
      timestamp: 3,
    });
  });

  it("rewrites the latest matching user prompt by stripped persisted text in in-memory snapshots", () => {
    const messages = rewriteLatestUserPromptInMessages({
      messages: [
        { role: "assistant", content: createTextContent("older answer"), timestamp: 1 },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                'Sender (untrusted metadata):\n```json\n{"label":"alisio-control-ui"}\n```\n\n[Thu 2026-04-16 15:02 GMT+1] abre o google',
            },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
          ],
          timestamp: 2,
        },
      ] as AgentMessage[],
      promptText: "model-facing prompt wrapper that differs from the persisted transcript",
      candidateTexts: ["abre o google"],
      replacementText: "abre o google",
    });

    expect(messages.at(-1)).toEqual({
      role: "user",
      content: [
        { type: "text", text: "abre o google" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
      ],
      timestamp: 2,
    });
  });
});

describe("restoreTranscriptLeafInSessionManager", () => {
  it("branches the active transcript back to the requested entry", () => {
    const { sessionManager } = createReadRewriteSession();
    const branch = sessionManager.getBranch();
    const targetEntryId = branch[1]?.id ?? null;
    expect(targetEntryId).toBeTruthy();

    const result = restoreTranscriptLeafInSessionManager({
      sessionManager,
      targetEntryId,
    });

    expect(result).toMatchObject({
      changed: true,
      restoredToEntryId: targetEntryId,
    });
    expect(sessionManager.getLeafEntry()?.id).toBe(targetEntryId);
    expect(getBranchMessages(sessionManager).map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
  });

  it("resets to the root when asked to restore a null leaf", () => {
    const { sessionManager } = createExecRewriteSession();

    const result = restoreTranscriptLeafInSessionManager({
      sessionManager,
      targetEntryId: null,
    });

    expect(result).toMatchObject({
      changed: true,
      restoredToEntryId: null,
    });
    expect(sessionManager.getBranch()).toEqual([]);
    expect(sessionManager.getLeafEntry()).toBeUndefined();
  });
});

describe("rewriteTranscriptEntriesInSessionFile", () => {
  it("emits transcript updates when the active branch changes", async () => {
    const sessionFile = "/tmp/session.jsonl";
    const { sessionManager, toolResultEntryId } = createExecRewriteSession();

    const openSpy = vi
      .spyOn(SessionManager, "open")
      .mockReturnValue(sessionManager as unknown as ReturnType<typeof SessionManager.open>);
    const listener = vi.fn();
    const cleanup = onSessionTranscriptUpdate(listener);

    try {
      const result = await rewriteTranscriptEntriesInSessionFile({
        sessionFile,
        sessionKey: "agent:main:test",
        request: {
          replacements: [
            {
              entryId: toolResultEntryId,
              message: createToolResultReplacement("exec", "[file_ref:file_abc]", 2),
            },
          ],
        },
      });

      expect(result.changed).toBe(true);
      expect(acquireSessionWriteLockMock).toHaveBeenCalledWith({
        sessionFile,
      });
      expect(acquireSessionWriteLockReleaseMock).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ sessionFile });

      const rewrittenToolResult = getBranchMessages(sessionManager)[1] as Extract<
        AgentMessage,
        { role: "toolResult" }
      >;
      expect(rewrittenToolResult.content).toEqual([{ type: "text", text: "[file_ref:file_abc]" }]);
    } finally {
      cleanup();
      openSpy.mockRestore();
    }
  });
});

describe("restoreTranscriptLeafInSessionFile", () => {
  it("emits transcript updates when the active leaf rewinds", async () => {
    const sessionFile = "/tmp/session-rewind.jsonl";
    const { sessionManager } = createReadRewriteSession();
    const targetEntryId = sessionManager.getBranch()[1]?.id ?? null;
    expect(targetEntryId).toBeTruthy();

    const openSpy = vi
      .spyOn(SessionManager, "open")
      .mockReturnValue(sessionManager as unknown as ReturnType<typeof SessionManager.open>);
    const listener = vi.fn();
    const cleanup = onSessionTranscriptUpdate(listener);

    try {
      const result = await restoreTranscriptLeafInSessionFile({
        sessionFile,
        sessionKey: "agent:main:test",
        targetEntryId,
      });

      expect(result).toMatchObject({
        changed: true,
        restoredToEntryId: targetEntryId,
      });
      expect(acquireSessionWriteLockMock).toHaveBeenCalledWith({
        sessionFile,
      });
      expect(acquireSessionWriteLockReleaseMock).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ sessionFile });
      expect(getBranchMessages(sessionManager).map((message) => message.role)).toEqual([
        "user",
        "assistant",
      ]);
      expect(sessionManager.getLeafEntry()).toMatchObject({
        type: "custom",
        customType: "alisio:transcript-rewind",
        parentId: targetEntryId,
      });
    } finally {
      cleanup();
      openSpy.mockRestore();
    }
  });

  it("persists the rewound leaf by appending a non-LLM custom anchor entry", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-transcript-rewind-"));
    const sessionManager = SessionManager.create(tempRoot, tempRoot);
    const sessionFile = sessionManager.getSessionFile()!;
    const [userEntryId, assistantEntryId] = appendSessionMessages(sessionManager, [
      asAppendMessage({
        role: "user",
        content: "abre o google",
        timestamp: 1,
      }),
      asAppendMessage({
        role: "assistant",
        content: createTextContent("Abri o Google."),
        timestamp: 2,
      }),
    ]);
    const replayedUserEntryId = sessionManager.appendMessage(
      asAppendMessage({
        role: "user",
        content: "abre o google",
        timestamp: 3,
      }),
    );

    expect(userEntryId).toBeTruthy();
    expect(assistantEntryId).toBeTruthy();
    expect(replayedUserEntryId).toBeTruthy();

    try {
      const result = await restoreTranscriptLeafInSessionFile({
        sessionFile,
        sessionKey: "main",
        targetEntryId: assistantEntryId,
      });

      expect(result).toMatchObject({
        changed: true,
        restoredToEntryId: assistantEntryId,
      });

      const reopened = SessionManager.open(sessionFile);
      const branch = reopened.getBranch();
      expect(branch.map((entry) => entry.type)).toEqual(["message", "message", "custom"]);
      expect(branch.at(-1)).toMatchObject({
        type: "custom",
        customType: "alisio:transcript-rewind",
        parentId: assistantEntryId,
      });
      expect(reopened.buildSessionContext().messages).toEqual([
        { role: "user", content: "abre o google", timestamp: 1 },
        { role: "assistant", content: createTextContent("Abri o Google."), timestamp: 2 },
      ]);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
