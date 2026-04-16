export type BrowserActionLayer = "semantic" | "geometric" | "os";

export type BrowserActionRecoveryCode =
  | "stale-dom"
  | "detached-frame"
  | "navigation-swap"
  | "overlay"
  | "browser-disconnect"
  | "browser-crash"
  | "corrupted-state"
  | "lease-conflict"
  | "auth-required"
  | "os-fallback-unavailable";

export type BrowserSessionAuthMethod =
  | "blind-fill"
  | "http-credentials"
  | "reused-session"
  | "cookies"
  | "storage";

export type BrowserActionExecutionSummary = {
  layer: BrowserActionLayer;
  recovered?: boolean;
  recoveryCode?: BrowserActionRecoveryCode | null;
  reusedAuth?: boolean;
  blindFilled?: boolean;
};

export type BrowserSessionActionSnapshot = {
  kind: string;
  layer: BrowserActionLayer;
  recovered: boolean;
  recoveryCode?: BrowserActionRecoveryCode | null;
  reusedAuth?: boolean;
  blindFilled?: boolean;
  targetId?: string | null;
  updatedAt: number;
};

export type BrowserSessionRecoverySnapshot = {
  code: BrowserActionRecoveryCode;
  targetId?: string | null;
  recovered: boolean;
  detail?: string | null;
  updatedAt: number;
};

export type BrowserSessionAuthSnapshot = {
  origin: string | null;
  status: "none" | "primed" | "reused";
  method: BrowserSessionAuthMethod;
  fields?: number;
  targetId?: string | null;
  updatedAt: number;
};
