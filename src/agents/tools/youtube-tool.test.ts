import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAlisioYouTubeChannelProfileMock,
  listAlisioYouTubeUploadsMock,
  readAlisioYouTubeVideoMock,
} = vi.hoisted(() => ({
  getAlisioYouTubeChannelProfileMock: vi.fn(),
  listAlisioYouTubeUploadsMock: vi.fn(),
  readAlisioYouTubeVideoMock: vi.fn(),
}));

vi.mock("../../infra/alisio-youtube.js", () => ({
  getAlisioYouTubeChannelProfile: getAlisioYouTubeChannelProfileMock,
  listAlisioYouTubeUploads: listAlisioYouTubeUploadsMock,
  readAlisioYouTubeVideo: readAlisioYouTubeVideoMock,
}));

describe("createYouTubeTool", () => {
  beforeEach(() => {
    vi.resetModules();
    getAlisioYouTubeChannelProfileMock.mockReset();
    listAlisioYouTubeUploadsMock.mockReset();
    readAlisioYouTubeVideoMock.mockReset();
  });

  it("reads the authenticated channel", async () => {
    const { createYouTubeTool } = await import("./youtube-tool.js");
    getAlisioYouTubeChannelProfileMock.mockResolvedValue({
      ok: true,
      status: "channel",
      connectorId: "youtube",
      channel: {
        channelId: "channel-1",
        title: "Alisio",
        channelUrl: "https://youtube.com/@alisio",
      },
    });

    const result = await createYouTubeTool().execute?.("tool-1", {
      action: "channel",
    });

    expect(getAlisioYouTubeChannelProfileMock).toHaveBeenCalledWith();
    expect(result?.details).toMatchObject({
      status: "channel",
      connectorId: "youtube",
    });
  });

  it("lists uploads", async () => {
    const { createYouTubeTool } = await import("./youtube-tool.js");
    listAlisioYouTubeUploadsMock.mockResolvedValue({
      ok: true,
      status: "listed",
      connectorId: "youtube",
      channel: {
        channelId: "channel-1",
        title: "Alisio",
        channelUrl: "https://youtube.com/@alisio",
      },
      videos: [],
    });

    const result = await createYouTubeTool().execute?.("tool-1", {
      action: "list_uploads",
      maxResults: 3,
    });

    expect(listAlisioYouTubeUploadsMock).toHaveBeenCalledWith({
      maxResults: 3,
    });
    expect(result?.details).toMatchObject({
      status: "listed",
      connectorId: "youtube",
    });
  });

  it("reads video metadata", async () => {
    const { createYouTubeTool } = await import("./youtube-tool.js");
    readAlisioYouTubeVideoMock.mockResolvedValue({
      ok: true,
      status: "read",
      connectorId: "youtube",
      video: {
        videoId: "video-1",
        title: "Porto",
        videoUrl: "https://www.youtube.com/watch?v=video-1",
      },
    });

    const result = await createYouTubeTool().execute?.("tool-1", {
      action: "video",
      videoId: "video-1",
    });

    expect(readAlisioYouTubeVideoMock).toHaveBeenCalledWith({
      videoId: "video-1",
    });
    expect(result?.details).toMatchObject({
      status: "read",
      connectorId: "youtube",
    });
  });
});
