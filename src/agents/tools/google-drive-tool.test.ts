import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createAlisioGoogleDriveTextFileMock,
  readAlisioGoogleDriveFileMock,
  searchAlisioGoogleDriveFilesMock,
} = vi.hoisted(() => ({
  createAlisioGoogleDriveTextFileMock: vi.fn(),
  readAlisioGoogleDriveFileMock: vi.fn(),
  searchAlisioGoogleDriveFilesMock: vi.fn(),
}));

vi.mock("../../infra/alisio-google-drive.js", () => ({
  createAlisioGoogleDriveTextFile: createAlisioGoogleDriveTextFileMock,
  readAlisioGoogleDriveFile: readAlisioGoogleDriveFileMock,
  searchAlisioGoogleDriveFiles: searchAlisioGoogleDriveFilesMock,
}));

describe("createGoogleDriveTool", () => {
  beforeEach(() => {
    vi.resetModules();
    createAlisioGoogleDriveTextFileMock.mockReset();
    readAlisioGoogleDriveFileMock.mockReset();
    searchAlisioGoogleDriveFilesMock.mockReset();
  });

  it("searches Google Drive files", async () => {
    const { createGoogleDriveTool } = await import("./google-drive-tool.js");
    searchAlisioGoogleDriveFilesMock.mockResolvedValue({
      ok: true,
      status: "listed",
      connectorId: "google-drive",
      files: [{ fileId: "file-1", name: "porto.txt", mimeType: "text/plain" }],
    });

    const result = await createGoogleDriveTool().execute?.("tool-1", {
      action: "search",
      query: "porto",
      folderId: "folder-1",
      maxResults: 3,
    });

    expect(searchAlisioGoogleDriveFilesMock).toHaveBeenCalledWith({
      query: "porto",
      folderId: "folder-1",
      maxResults: 3,
    });
    expect(result?.details).toMatchObject({
      status: "listed",
      connectorId: "google-drive",
    });
  });

  it("reads Google Drive files", async () => {
    const { createGoogleDriveTool } = await import("./google-drive-tool.js");
    readAlisioGoogleDriveFileMock.mockResolvedValue({
      ok: true,
      status: "read",
      connectorId: "google-drive",
      file: { fileId: "file-1", name: "porto.txt", mimeType: "text/plain" },
      text: "porto",
      truncated: false,
    });

    const result = await createGoogleDriveTool().execute?.("tool-1", {
      action: "read",
      fileId: "file-1",
      maxChars: 120,
    });

    expect(readAlisioGoogleDriveFileMock).toHaveBeenCalledWith({
      fileId: "file-1",
      maxChars: 120,
    });
    expect(result?.details).toMatchObject({
      status: "read",
      connectorId: "google-drive",
    });
  });

  it("creates text files in Google Drive", async () => {
    const { createGoogleDriveTool } = await import("./google-drive-tool.js");
    createAlisioGoogleDriveTextFileMock.mockResolvedValue({
      ok: true,
      status: "created",
      connectorId: "google-drive",
      file: { fileId: "file-1", name: "porto.md", mimeType: "text/markdown" },
      contentLength: 5,
    });

    const result = await createGoogleDriveTool().execute?.("tool-1", {
      action: "create_text",
      name: "porto.md",
      content: "porto",
      folderId: "folder-1",
      mimeType: "text/markdown",
    });

    expect(createAlisioGoogleDriveTextFileMock).toHaveBeenCalledWith({
      name: "porto.md",
      content: "porto",
      folderId: "folder-1",
      mimeType: "text/markdown",
    });
    expect(result?.details).toMatchObject({
      status: "created",
      connectorId: "google-drive",
    });
  });
});
