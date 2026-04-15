import { describe, expect, it, vi } from "vitest";

const { createAlisioGoogleDocumentMock, readAlisioGoogleDocumentMock } = vi.hoisted(() => ({
  createAlisioGoogleDocumentMock: vi.fn(),
  readAlisioGoogleDocumentMock: vi.fn(),
}));

vi.mock("../../infra/alisio-google-docs.js", () => ({
  createAlisioGoogleDocument: createAlisioGoogleDocumentMock,
  readAlisioGoogleDocument: readAlisioGoogleDocumentMock,
}));

describe("createGoogleDocsTool", () => {
  it("creates documents through the Google Docs connector", async () => {
    const { createGoogleDocsTool } = await import("./google-docs-tool.js");
    createAlisioGoogleDocumentMock.mockResolvedValue({
      ok: true,
      status: "created",
      connectorId: "google-docs",
      documentId: "doc-1",
      title: "porto",
      documentUrl: "https://docs.google.com/document/d/doc-1/edit",
      contentLength: 5,
    });

    const result = await createGoogleDocsTool().execute?.("tool-1", {
      action: "create",
      title: "porto",
      content: "porto",
    });

    expect(createAlisioGoogleDocumentMock).toHaveBeenCalledWith({
      title: "porto",
      content: "porto",
    });
    expect(result?.details).toMatchObject({
      status: "created",
      connectorId: "google-docs",
    });
  });

  it("reads documents through the Google Docs connector", async () => {
    const { createGoogleDocsTool } = await import("./google-docs-tool.js");
    readAlisioGoogleDocumentMock.mockResolvedValue({
      ok: true,
      status: "read",
      connectorId: "google-docs",
      documentId: "doc-1",
      title: "porto",
      documentUrl: "https://docs.google.com/document/d/doc-1/edit",
      text: "porto",
      truncated: false,
    });

    const result = await createGoogleDocsTool().execute?.("tool-1", {
      action: "read",
      documentId: "doc-1",
      maxChars: 120,
    });

    expect(readAlisioGoogleDocumentMock).toHaveBeenCalledWith({
      documentId: "doc-1",
      maxChars: 120,
    });
    expect(result?.details).toMatchObject({
      status: "read",
      connectorId: "google-docs",
    });
  });
});
