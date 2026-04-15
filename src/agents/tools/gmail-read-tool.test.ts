import { describe, expect, it, vi } from "vitest";

const { readAlisioGmailMessageMock, searchAlisioGmailMessagesMock } = vi.hoisted(() => ({
  readAlisioGmailMessageMock: vi.fn(),
  searchAlisioGmailMessagesMock: vi.fn(),
}));

vi.mock("../../infra/alisio-gmail.js", () => ({
  readAlisioGmailMessage: readAlisioGmailMessageMock,
  searchAlisioGmailMessages: searchAlisioGmailMessagesMock,
}));

describe("createGmailReadTool", () => {
  it("searches Gmail messages", async () => {
    const { createGmailReadTool } = await import("./gmail-read-tool.js");
    searchAlisioGmailMessagesMock.mockResolvedValue({
      ok: true,
      status: "listed",
      connectorId: "gmail-modify",
      resultSizeEstimate: 1,
      messages: [{ messageId: "msg-1", subject: "Porto" }],
    });

    const result = await createGmailReadTool().execute?.("tool-1", {
      action: "search",
      query: "porto",
      labelIds: ["INBOX", "STARRED"],
      maxResults: 3,
      includeSpamTrash: true,
    });

    expect(searchAlisioGmailMessagesMock).toHaveBeenCalledWith({
      query: "porto",
      labelIds: ["INBOX", "STARRED"],
      maxResults: 3,
      includeSpamTrash: true,
    });
    expect(result?.details).toMatchObject({
      status: "listed",
      connectorId: "gmail-modify",
    });
  });

  it("reads a Gmail message", async () => {
    const { createGmailReadTool } = await import("./gmail-read-tool.js");
    readAlisioGmailMessageMock.mockResolvedValue({
      ok: true,
      status: "read",
      connectorId: "gmail-read",
      message: { messageId: "msg-1", bodyText: "porto", truncated: false },
    });

    const result = await createGmailReadTool().execute?.("tool-1", {
      action: "get",
      messageId: "msg-1",
      maxChars: 500,
    });

    expect(readAlisioGmailMessageMock).toHaveBeenCalledWith({
      messageId: "msg-1",
      maxChars: 500,
    });
    expect(result?.details).toMatchObject({
      status: "read",
      connectorId: "gmail-read",
    });
  });
});
