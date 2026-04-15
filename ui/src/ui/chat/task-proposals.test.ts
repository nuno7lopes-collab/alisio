import { describe, expect, it } from "vitest";
import { extractTaskProposalBlocks, findPersistedTaskProposal } from "./task-proposals.ts";

describe("chat task proposals", () => {
  it("extracts valid alisio-task blocks and strips them from markdown", () => {
    const result = extractTaskProposalBlocks({
      markdown: [
        "I can track this for you.",
        "",
        "```alisio-task",
        "{",
        '  "title": "Ship task inbox",',
        '  "summary": "Track the inbox flow",',
        '  "acceptance": ["Inbox exists", "Chat cards work"]',
        "}",
        "```",
      ].join("\n"),
      requesterSessionKey: "agent:main:main",
      message: { role: "assistant", id: "message-1", timestamp: 1000 },
    });

    expect(result.cleanedMarkdown).toBe("I can track this for you.");
    expect(result.proposals).toEqual([
      {
        clientKey: "msg:message-1:0",
        requesterSessionKey: "agent:main:main",
        sourceMessageId: "message-1",
        kind: "task",
        title: "Ship task inbox",
        summary: "Track the inbox flow",
        acceptance: ["Inbox exists", "Chat cards work"],
        createdBy: "assistant",
      },
    ]);
  });

  it("keeps invalid blocks in markdown and ignores them", () => {
    const markdown = ["```alisio-task", "{ not valid json }", "```"].join("\n");
    const result = extractTaskProposalBlocks({
      markdown,
      requesterSessionKey: "agent:main:main",
      message: { role: "assistant", timestamp: 1000 },
    });

    expect(result.cleanedMarkdown).toBe(markdown);
    expect(result.proposals).toEqual([]);
  });

  it("finds persisted proposals by requester session and client key", () => {
    const extracted = extractTaskProposalBlocks({
      markdown: ["```alisio-task", '{ "title": "Ship task inbox" }', "```"].join("\n"),
      requesterSessionKey: "agent:main:main",
      message: { role: "assistant", id: "message-2", timestamp: 2000 },
    });
    const draft = extracted.proposals[0];

    expect(
      findPersistedTaskProposal(
        [
          {
            proposalId: "proposal-1",
            clientKey: draft.clientKey,
            requesterSessionKey: draft.requesterSessionKey,
            kind: "task",
            title: "Ship task inbox",
            acceptance: [],
            createdBy: "assistant",
            decision: "approved",
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        draft,
      ),
    ).toMatchObject({ proposalId: "proposal-1", decision: "approved" });
  });

  it("normalizes numeric message ids into stable client keys", () => {
    const result = extractTaskProposalBlocks({
      markdown: ["```alisio-task", '{ "title": "Ship task inbox" }', "```"].join("\n"),
      requesterSessionKey: "agent:main:main",
      message: { role: "assistant", id: 42, timestamp: 3000 },
    });

    expect(result.proposals[0]?.clientKey).toBe("msg:42:0");
    expect(result.proposals[0]?.sourceMessageId).toBe("42");
  });
});
