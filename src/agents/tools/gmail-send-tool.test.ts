import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendAlisioGmailMessageMock } = vi.hoisted(() => ({
  sendAlisioGmailMessageMock: vi.fn(),
}));

vi.mock("../../infra/alisio-store.js", () => ({
  sendAlisioGmailMessage: sendAlisioGmailMessageMock,
}));

describe("createGmailSendTool", () => {
  beforeEach(() => {
    sendAlisioGmailMessageMock.mockReset();
  });

  it("is registered as an owner-only tool", async () => {
    const { createGmailSendTool } = await import("./gmail-send-tool.js");
    const tool = createGmailSendTool();

    expect(tool.ownerOnly).toBe(true);
    expect(tool.name).toBe("gmail_send");
  });

  it("returns the provider payload on success", async () => {
    sendAlisioGmailMessageMock.mockResolvedValue({
      ok: true,
      status: "sent",
      connectorId: "gmail-send",
      messageId: "gmail-message-1",
      threadId: "gmail-thread-1",
      to: ["nuno@example.com"],
      subject: "Hello",
    });

    const { createGmailSendTool } = await import("./gmail-send-tool.js");
    const tool = createGmailSendTool();
    const result = await tool.execute("call-1", {
      to: "nuno@example.com",
      subject: "Hello",
      body: "Body",
      body_format: "html",
    });

    expect(sendAlisioGmailMessageMock).toHaveBeenCalledWith({
      to: "nuno@example.com",
      subject: "Hello",
      body: "Body",
      bodyFormat: "html",
    });
    expect(result.details).toMatchObject({
      ok: true,
      status: "sent",
      messageId: "gmail-message-1",
    });
  });

  it("returns an auth-required payload instead of throwing when Gmail is disconnected", async () => {
    sendAlisioGmailMessageMock.mockResolvedValue({
      ok: false,
      status: "auth_required",
      connectorId: "gmail-send",
      message: "Connect Gmail Send first.",
      reconnectRequired: false,
    });

    const { createGmailSendTool } = await import("./gmail-send-tool.js");
    const tool = createGmailSendTool();
    const result = await tool.execute("call-2", {
      to: "nuno@example.com",
      subject: "Hello",
      body: "Body",
    });

    expect(result.content).toEqual([{ type: "text", text: "Connect Gmail Send first." }]);
    expect(result.details).toMatchObject({
      ok: false,
      status: "auth_required",
      reconnectRequired: false,
    });
  });
});
