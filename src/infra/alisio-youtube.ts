import {
  extractGoogleApiProviderErrorMessage,
  extractGoogleApiProviderReason,
  isGoogleApiReconnectRequired,
  resolveAlisioConnectorRuntimeAccess,
} from "./alisio-connector-runtime.js";

const YOUTUBE_CONNECTOR_ID = "youtube";
const YOUTUBE_API_ROOT = "https://www.googleapis.com/youtube/v3";

export type AlisioYouTubeChannelProfile = {
  channelId: string;
  title: string;
  description?: string;
  customUrl?: string;
  publishedAt?: string;
  viewCount?: number;
  subscriberCount?: number;
  videoCount?: number;
  uploadsPlaylistId?: string;
  channelUrl: string;
};

export type AlisioYouTubeVideoSummary = {
  videoId: string;
  title: string;
  description?: string;
  publishedAt?: string;
  channelTitle?: string;
  duration?: string;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  videoUrl: string;
};

export type AlisioYouTubeResult =
  | {
      ok: true;
      status: "channel";
      connectorId: "youtube";
      channel: AlisioYouTubeChannelProfile;
    }
  | {
      ok: true;
      status: "listed";
      connectorId: "youtube";
      channel: AlisioYouTubeChannelProfile;
      videos: AlisioYouTubeVideoSummary[];
      nextPageToken?: string;
    }
  | {
      ok: true;
      status: "read";
      connectorId: "youtube";
      video: AlisioYouTubeVideoSummary;
    }
  | {
      ok: false;
      status: "auth_required" | "read_failed";
      connectorId: "youtube";
      message: string;
      reconnectRequired?: boolean;
      providerReason?: string;
    };

function buildYouTubeVideoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function buildYouTubeChannelUrl(channelId: string, customUrl?: string): string {
  return customUrl?.trim()
    ? `https://www.youtube.com/${customUrl.trim().replace(/^\/+/, "")}`
    : `https://www.youtube.com/channel/${encodeURIComponent(channelId)}`;
}

function normalizeYouTubeVideoId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname === "youtu.be") {
      return parsed.pathname.split("/").filter(Boolean)[0] ?? null;
    }
    const explicitId = parsed.searchParams.get("v");
    if (explicitId?.trim()) {
      return explicitId.trim();
    }
    const pathSegments = parsed.pathname.split("/").filter(Boolean);
    if (pathSegments[0] === "shorts" || pathSegments[0] === "embed" || pathSegments[0] === "live") {
      return pathSegments[1] ?? null;
    }
  } catch {
    // Treat plain ids as-is.
  }
  return trimmed;
}

function normalizeYouTubeCount(value: unknown): number | undefined {
  const parsed =
    typeof value === "string"
      ? Number.parseInt(value, 10)
      : typeof value === "number" && Number.isFinite(value)
        ? Math.trunc(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeYouTubeChannel(
  body: Record<string, unknown>,
): AlisioYouTubeChannelProfile | null {
  const channelId = typeof body.id === "string" && body.id.trim() ? body.id.trim() : null;
  const snippet =
    typeof body.snippet === "object" && body.snippet
      ? (body.snippet as Record<string, unknown>)
      : null;
  const statistics =
    typeof body.statistics === "object" && body.statistics
      ? (body.statistics as Record<string, unknown>)
      : null;
  const contentDetails =
    typeof body.contentDetails === "object" && body.contentDetails
      ? (body.contentDetails as Record<string, unknown>)
      : null;
  const relatedPlaylists =
    contentDetails &&
    typeof contentDetails.relatedPlaylists === "object" &&
    contentDetails.relatedPlaylists
      ? (contentDetails.relatedPlaylists as Record<string, unknown>)
      : null;
  const title =
    snippet && typeof snippet.title === "string" && snippet.title.trim()
      ? snippet.title.trim()
      : null;
  if (!channelId || !title) {
    return null;
  }
  const customUrl =
    snippet && typeof snippet.customUrl === "string" && snippet.customUrl.trim()
      ? snippet.customUrl.trim()
      : undefined;
  return {
    channelId,
    title,
    ...(snippet && typeof snippet.description === "string" && snippet.description.trim()
      ? { description: snippet.description.trim() }
      : {}),
    ...(customUrl ? { customUrl } : {}),
    ...(snippet && typeof snippet.publishedAt === "string" && snippet.publishedAt.trim()
      ? { publishedAt: snippet.publishedAt.trim() }
      : {}),
    ...(typeof statistics?.viewCount !== "undefined"
      ? { viewCount: normalizeYouTubeCount(statistics.viewCount) }
      : {}),
    ...(typeof statistics?.subscriberCount !== "undefined"
      ? { subscriberCount: normalizeYouTubeCount(statistics.subscriberCount) }
      : {}),
    ...(typeof statistics?.videoCount !== "undefined"
      ? { videoCount: normalizeYouTubeCount(statistics.videoCount) }
      : {}),
    ...(typeof relatedPlaylists?.uploads === "string" && relatedPlaylists.uploads.trim()
      ? { uploadsPlaylistId: relatedPlaylists.uploads.trim() }
      : {}),
    channelUrl: buildYouTubeChannelUrl(channelId, customUrl),
  };
}

function normalizeYouTubeVideo(body: Record<string, unknown>): AlisioYouTubeVideoSummary | null {
  const videoId =
    typeof body.id === "string" && body.id.trim()
      ? body.id.trim()
      : typeof body.contentDetails === "object" &&
          body.contentDetails &&
          typeof (body.contentDetails as { videoId?: unknown }).videoId === "string" &&
          (body.contentDetails as { videoId: string }).videoId.trim()
        ? (body.contentDetails as { videoId: string }).videoId.trim()
        : typeof body.snippet === "object" &&
            body.snippet &&
            typeof (body.snippet as { resourceId?: unknown }).resourceId === "object" &&
            (body.snippet as { resourceId: { videoId?: unknown } }).resourceId &&
            typeof (body.snippet as { resourceId: { videoId?: unknown } }).resourceId.videoId ===
              "string" &&
            (body.snippet as { resourceId: { videoId: string } }).resourceId.videoId.trim()
          ? (body.snippet as { resourceId: { videoId: string } }).resourceId.videoId.trim()
          : null;
  const snippet =
    typeof body.snippet === "object" && body.snippet
      ? (body.snippet as Record<string, unknown>)
      : null;
  const contentDetails =
    typeof body.contentDetails === "object" && body.contentDetails
      ? (body.contentDetails as Record<string, unknown>)
      : null;
  const statistics =
    typeof body.statistics === "object" && body.statistics
      ? (body.statistics as Record<string, unknown>)
      : null;
  const title =
    snippet && typeof snippet.title === "string" && snippet.title.trim()
      ? snippet.title.trim()
      : null;
  if (!videoId || !title) {
    return null;
  }
  return {
    videoId,
    title,
    ...(snippet && typeof snippet.description === "string" && snippet.description.trim()
      ? { description: snippet.description.trim() }
      : {}),
    ...(snippet && typeof snippet.publishedAt === "string" && snippet.publishedAt.trim()
      ? { publishedAt: snippet.publishedAt.trim() }
      : {}),
    ...(snippet && typeof snippet.channelTitle === "string" && snippet.channelTitle.trim()
      ? { channelTitle: snippet.channelTitle.trim() }
      : {}),
    ...(contentDetails &&
    typeof contentDetails.duration === "string" &&
    contentDetails.duration.trim()
      ? { duration: contentDetails.duration.trim() }
      : {}),
    ...(typeof statistics?.viewCount !== "undefined"
      ? { viewCount: normalizeYouTubeCount(statistics.viewCount) }
      : {}),
    ...(typeof statistics?.likeCount !== "undefined"
      ? { likeCount: normalizeYouTubeCount(statistics.likeCount) }
      : {}),
    ...(typeof statistics?.commentCount !== "undefined"
      ? { commentCount: normalizeYouTubeCount(statistics.commentCount) }
      : {}),
    videoUrl: buildYouTubeVideoUrl(videoId),
  };
}

function buildYouTubeAuthError(params: { reconnectRequired: boolean }): AlisioYouTubeResult {
  return {
    ok: false,
    status: "auth_required",
    connectorId: YOUTUBE_CONNECTOR_ID,
    message: params.reconnectRequired
      ? "YouTube authorization is no longer valid. Reconnect YouTube in Apps."
      : "YouTube is not connected in Alisio. Connect YouTube in Apps first.",
    reconnectRequired: params.reconnectRequired,
  };
}

async function fetchYouTubeChannel(
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<
  | { ok: true; channel: AlisioYouTubeChannelProfile }
  | {
      ok: false;
      status: "auth_required" | "read_failed";
      message: string;
      reconnectRequired?: boolean;
      providerReason?: string;
    }
> {
  try {
    const response = await fetchImpl(
      `${YOUTUBE_API_ROOT}/channels?part=snippet,contentDetails,statistics&mine=true`,
      {
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        },
      },
    );
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const providerReason = extractGoogleApiProviderReason(body);
    if (!response.ok || !body || !Array.isArray(body.items)) {
      const reconnectRequired = isGoogleApiReconnectRequired(response.status, providerReason);
      const message =
        providerReason === "insufficientPermissions"
          ? "YouTube needs to be reconnected with YouTube read access."
          : reconnectRequired
            ? "YouTube authorization is no longer valid. Reconnect YouTube in Apps."
            : extractGoogleApiProviderErrorMessage(body, "YouTube rejected the channel request.");
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "read_failed",
        message,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        ...(providerReason ? { providerReason } : {}),
      };
    }
    const normalized = body.items.flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }
      const parsed = normalizeYouTubeChannel(item as Record<string, unknown>);
      return parsed ? [parsed] : [];
    })[0];
    if (!normalized) {
      return {
        ok: false,
        status: "read_failed",
        message: "YouTube returned no accessible channel for the connected account.",
      };
    }
    return {
      ok: true,
      channel: normalized,
    };
  } catch {
    return {
      ok: false,
      status: "read_failed",
      message: "YouTube could not be reached right now. Try again in a moment.",
    };
  }
}

export async function getAlisioYouTubeChannelProfile(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioYouTubeResult> {
  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [YOUTUBE_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return buildYouTubeAuthError({ reconnectRequired: authorization.reconnectRequired });
  }
  const channel = await fetchYouTubeChannel(authorization.accessToken, fetchImpl);
  if (!channel.ok) {
    return {
      ok: false,
      status: channel.status,
      connectorId: YOUTUBE_CONNECTOR_ID,
      message: channel.message,
      ...(channel.reconnectRequired ? { reconnectRequired: true } : {}),
      ...(channel.providerReason ? { providerReason: channel.providerReason } : {}),
    };
  }
  return {
    ok: true,
    status: "channel",
    connectorId: YOUTUBE_CONNECTOR_ID,
    channel: channel.channel,
  };
}

export async function listAlisioYouTubeUploads(
  input: {
    maxResults?: number;
  } = {},
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioYouTubeResult> {
  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [YOUTUBE_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return buildYouTubeAuthError({ reconnectRequired: authorization.reconnectRequired });
  }

  const channel = await fetchYouTubeChannel(authorization.accessToken, fetchImpl);
  if (!channel.ok) {
    return {
      ok: false,
      status: channel.status,
      connectorId: YOUTUBE_CONNECTOR_ID,
      message: channel.message,
      ...(channel.reconnectRequired ? { reconnectRequired: true } : {}),
      ...(channel.providerReason ? { providerReason: channel.providerReason } : {}),
    };
  }

  if (!channel.channel.uploadsPlaylistId) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: YOUTUBE_CONNECTOR_ID,
      message: "YouTube did not expose an uploads playlist for the connected channel.",
    };
  }

  const maxResults =
    typeof input.maxResults === "number" && Number.isFinite(input.maxResults)
      ? Math.min(Math.max(1, Math.trunc(input.maxResults)), 25)
      : 10;

  try {
    const response = await fetchImpl(
      `${YOUTUBE_API_ROOT}/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(channel.channel.uploadsPlaylistId)}&maxResults=${maxResults}`,
      {
        headers: {
          authorization: `Bearer ${authorization.accessToken}`,
          accept: "application/json",
        },
      },
    );
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const providerReason = extractGoogleApiProviderReason(body);
    if (!response.ok || !body || !Array.isArray(body.items)) {
      const reconnectRequired = isGoogleApiReconnectRequired(response.status, providerReason);
      const message =
        providerReason === "insufficientPermissions"
          ? "YouTube needs to be reconnected with YouTube read access."
          : reconnectRequired
            ? "YouTube authorization is no longer valid. Reconnect YouTube in Apps."
            : extractGoogleApiProviderErrorMessage(body, "YouTube rejected the uploads request.");
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "read_failed",
        connectorId: YOUTUBE_CONNECTOR_ID,
        message,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        ...(providerReason ? { providerReason } : {}),
      };
    }
    const videos = body.items.flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }
      const normalized = normalizeYouTubeVideo(item as Record<string, unknown>);
      return normalized ? [normalized] : [];
    });
    return {
      ok: true,
      status: "listed",
      connectorId: YOUTUBE_CONNECTOR_ID,
      channel: channel.channel,
      videos,
      ...(typeof body.nextPageToken === "string" && body.nextPageToken.trim()
        ? { nextPageToken: body.nextPageToken.trim() }
        : {}),
    };
  } catch {
    return {
      ok: false,
      status: "read_failed",
      connectorId: YOUTUBE_CONNECTOR_ID,
      message: "YouTube could not be reached right now. Try again in a moment.",
    };
  }
}

export async function readAlisioYouTubeVideo(
  input: {
    videoId: string;
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioYouTubeResult> {
  const videoId = normalizeYouTubeVideoId(input.videoId);
  if (!videoId) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: YOUTUBE_CONNECTOR_ID,
      message: "YouTube video id is required.",
    };
  }

  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [YOUTUBE_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return buildYouTubeAuthError({ reconnectRequired: authorization.reconnectRequired });
  }

  try {
    const response = await fetchImpl(
      `${YOUTUBE_API_ROOT}/videos?part=snippet,contentDetails,statistics&id=${encodeURIComponent(videoId)}`,
      {
        headers: {
          authorization: `Bearer ${authorization.accessToken}`,
          accept: "application/json",
        },
      },
    );
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const providerReason = extractGoogleApiProviderReason(body);
    if (!response.ok || !body || !Array.isArray(body.items)) {
      const reconnectRequired = isGoogleApiReconnectRequired(response.status, providerReason);
      const message =
        providerReason === "insufficientPermissions"
          ? "YouTube needs to be reconnected with YouTube read access."
          : reconnectRequired
            ? "YouTube authorization is no longer valid. Reconnect YouTube in Apps."
            : extractGoogleApiProviderErrorMessage(body, "YouTube rejected the video request.");
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "read_failed",
        connectorId: YOUTUBE_CONNECTOR_ID,
        message,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        ...(providerReason ? { providerReason } : {}),
      };
    }
    const normalized = body.items.flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }
      const parsed = normalizeYouTubeVideo(item as Record<string, unknown>);
      return parsed ? [parsed] : [];
    })[0];
    if (!normalized) {
      return {
        ok: false,
        status: "read_failed",
        connectorId: YOUTUBE_CONNECTOR_ID,
        message: "YouTube returned no video for that id.",
      };
    }
    return {
      ok: true,
      status: "read",
      connectorId: YOUTUBE_CONNECTOR_ID,
      video: normalized,
    };
  } catch {
    return {
      ok: false,
      status: "read_failed",
      connectorId: YOUTUBE_CONNECTOR_ID,
      message: "YouTube could not be reached right now. Try again in a moment.",
    };
  }
}
