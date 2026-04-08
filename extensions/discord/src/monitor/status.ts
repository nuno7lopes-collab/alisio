export type DiscordMonitorStatusPatch = {
  connected?: boolean;
  reconnectAttempts?: number;
  lastEventAt?: number | null;
  lastConnectedAt?: number | null;
  lastDisconnect?:
    | string
    | {
        at: number;
        status?: number;
        error?: string;
        loggedOut?: boolean;
      }
    | null;
  lastInboundAt?: number | null;
  lastError?: string | null;
  healthState?: "healthy" | "reconnecting" | "stopped";
  busy?: boolean;
  activeRuns?: number;
  lastRunActivityAt?: number | null;
};

export type DiscordMonitorStatusSink = (patch: DiscordMonitorStatusPatch) => void;
