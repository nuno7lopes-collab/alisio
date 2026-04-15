import { describe, expect, it, vi } from "vitest";

const { modifyAlisioGmailMessageMock } = vi.hoisted(() => ({
  modifyAlisioGmailMessageMock: vi.fn(),
}));

vi.mock("../../infra/alisio-gmail.js", () => ({
  modifyAlisioGmailMessage: modifyAlisioGmailMessageMock,
}));

describe("createGmailModifyTool", () => {
  it("archives Gmail messages", async () => {
    const { createGmailModifyTool } = await import("./gmail-modify-tool.js");
    modifyAlisioGmailMessageMock.mockResolvedValue({
      ok: true,
      status: "modified",
      connectorId: "gmail-modify",
      action: "archive",
      messageId: "msg-1",
      removedLabelIds: ["INBOX"],
    });

    const result = await createGmailModifyTool().execute?.("tool-1", {
      action: "archive",
      messageId: "msg-1",
    });

    expect(modifyAlisioGmailMessageMock).toHaveBeenCalledWith({
      action: "archive",
      messageId: "msg-1",
    });
    expect(result?.details).toMatchObject({
      status: "modified",
      connectorId: "gmail-modify",
    });
  });

  it("passes label ids for label updates", async () => {
    const { createGmailModifyTool } = await import("./gmail-modify-tool.js");
    modifyAlisioGmailMessageMock.mockResolvedValue({
      ok: true,
      status: "modified",
      connectorId: "gmail-modify",
      action: "add_labels",
      messageId: "msg-1",
      addedLabelIds: ["Label_1"],
    });

    await createGmailModifyTool().execute?.("tool-1", {
      action: "add_labels",
      messageId: "msg-1",
      labelIds: ["Label_1"],
    });

    expect(modifyAlisioGmailMessageMock).toHaveBeenCalledWith({
      action: "add_labels",
      messageId: "msg-1",
      labelIds: ["Label_1"],
    });
  });
});
