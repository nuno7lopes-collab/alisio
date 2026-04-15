import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_ACCENTS, DEFAULT_THEME_FAMILY } from "../shared/alisio-appearance.js";
import { withTempDir } from "../test-helpers/temp-dir.js";
import {
  beginAlisioConnectorSetup,
  completeAlisioConnectorAuthorizationFromCallback,
} from "./alisio-store.js";
import {
  getAlisioYouTubeChannelProfile,
  listAlisioYouTubeUploads,
  readAlisioYouTubeVideo,
} from "./alisio-youtube.js";

const CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");

function readFetchCallUrl(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  if (input instanceof Request) {
    return input.url;
  }
  return JSON.stringify(input);
}

async function createReadyAlisioAccountEnv(root: string) {
  const env = {
    ALISIO_STATE_DIR: root,
    ALISIO_SUPABASE_URL: "https://example.supabase.co",
    ALISIO_SUPABASE_ANON_KEY: "anon-key",
    ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
    ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
    ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
    ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
  } as NodeJS.ProcessEnv;
  const statePath = path.join(root, "alisio", "state.json");
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(
    statePath,
    JSON.stringify(
      {
        version: 1,
        account: {
          profile: {
            userId: "user-1",
            username: "nuno",
            displayName: "Nuno Lopes",
            email: "nuno@example.com",
            avatarLabel: "N",
            joinedAt: "2026-04-04T15:00:00.000Z",
            plan: "free",
            backend: "supabase",
          },
          preferences: {
            language: "pt-PT",
            themeFamily: DEFAULT_THEME_FAMILY,
            themeMode: "dark",
            themeAccents: DEFAULT_THEME_ACCENTS,
          },
          session: {
            state: "signed_in",
            profileCompleted: true,
            signedInAt: "2026-04-04T15:00:00.000Z",
            backend: "supabase",
          },
        },
        organization: {
          mode: "none",
        },
        ai: {},
        authorizations: {},
        oauthCredentials: {},
        pendingAuthorizations: {},
      },
      null,
      2,
    ),
  );
  return env;
}

async function connectYouTube(env: NodeJS.ProcessEnv) {
  const begin = await beginAlisioConnectorSetup("youtube", env);
  const launchUrl = new URL(begin?.setupUrl ?? "");
  const authFetch = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "youtube-access",
          refresh_token: "youtube-refresh",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "https://www.googleapis.com/auth/youtube.readonly openid email",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          sub: "google-user-1",
          name: "Nuno Lopes",
          email: "nuno@example.com",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

  await completeAlisioConnectorAuthorizationFromCallback(
    {
      provider: "google",
      stateToken: launchUrl.searchParams.get("state"),
      code: "google-code",
    },
    env,
    authFetch,
  );
}

describe("alisio youtube runtime", () => {
  it("reads the authenticated YouTube channel", async () => {
    await withTempDir({ prefix: "alisio-youtube-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectYouTube(env);

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                id: "channel-1",
                snippet: {
                  title: "Alisio",
                  description: "Videos",
                  customUrl: "@alisio",
                  publishedAt: "2026-01-01T00:00:00Z",
                },
                contentDetails: {
                  relatedPlaylists: {
                    uploads: "uploads-1",
                  },
                },
                statistics: {
                  viewCount: "100",
                  subscriberCount: "50",
                  videoCount: "10",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const result = await getAlisioYouTubeChannelProfile(env, fetchMock);

      expect(result).toMatchObject({
        ok: true,
        status: "channel",
        connectorId: "youtube",
      });
      if (result.ok && result.status === "channel") {
        expect(result.channel).toMatchObject({
          channelId: "channel-1",
          title: "Alisio",
          uploadsPlaylistId: "uploads-1",
          subscriberCount: 50,
        });
      }
      expect(readFetchCallUrl(fetchMock.mock.calls[0]?.[0])).toContain("/youtube/v3/channels");
      expect(readFetchCallUrl(fetchMock.mock.calls[0]?.[0])).toContain("mine=true");
    });
  });

  it("lists uploaded YouTube videos", async () => {
    await withTempDir({ prefix: "alisio-youtube-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectYouTube(env);

      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              items: [
                {
                  id: "channel-1",
                  snippet: {
                    title: "Alisio",
                  },
                  contentDetails: {
                    relatedPlaylists: {
                      uploads: "uploads-1",
                    },
                  },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              nextPageToken: "next-1",
              items: [
                {
                  contentDetails: {
                    videoId: "video-1",
                  },
                  snippet: {
                    title: "Porto",
                    description: "City guide",
                    publishedAt: "2026-04-01T00:00:00Z",
                    channelTitle: "Alisio",
                    resourceId: {
                      videoId: "video-1",
                    },
                  },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      const result = await listAlisioYouTubeUploads({ maxResults: 3 }, env, fetchMock);

      expect(result).toMatchObject({
        ok: true,
        status: "listed",
        connectorId: "youtube",
        nextPageToken: "next-1",
      });
      if (result.ok && result.status === "listed") {
        expect(result.videos[0]).toMatchObject({
          videoId: "video-1",
          title: "Porto",
        });
      }
      expect(readFetchCallUrl(fetchMock.mock.calls[1]?.[0])).toContain("/youtube/v3/playlistItems");
      expect(readFetchCallUrl(fetchMock.mock.calls[1]?.[0])).toContain("playlistId=uploads-1");
      expect(readFetchCallUrl(fetchMock.mock.calls[1]?.[0])).toContain("maxResults=3");
    });
  });

  it("reads a YouTube video by URL", async () => {
    await withTempDir({ prefix: "alisio-youtube-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectYouTube(env);

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                id: "video-1",
                snippet: {
                  title: "Porto",
                  description: "City guide",
                  publishedAt: "2026-04-01T00:00:00Z",
                  channelTitle: "Alisio",
                },
                contentDetails: {
                  duration: "PT10M",
                },
                statistics: {
                  viewCount: "100",
                  likeCount: "10",
                  commentCount: "2",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const result = await readAlisioYouTubeVideo(
        { videoId: "https://www.youtube.com/watch?v=video-1" },
        env,
        fetchMock,
      );

      expect(result).toMatchObject({
        ok: true,
        status: "read",
        connectorId: "youtube",
      });
      if (result.ok && result.status === "read") {
        expect(result.video).toMatchObject({
          videoId: "video-1",
          title: "Porto",
          duration: "PT10M",
          viewCount: 100,
        });
      }
    });
  });
});
