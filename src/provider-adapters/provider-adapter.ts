import type { Api } from "@mariozechner/pi-ai";

export type ProviderAdapterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ProviderAdapterRequest = {
  model: {
    id: string;
    api: Api;
    provider: string;
  };
  messages: ProviderAdapterMessage[];
  signal?: AbortSignal;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
};

export type ProviderAdapterStreamEvent = {
  type: "text-delta";
  text: string;
};

export type ProviderAdapterResponse = {
  text: string;
  stopReason: "stop";
};

export type ProviderAdapterErrorCode =
  | "aborted"
  | "bad-response"
  | "network"
  | "timeout"
  | "unauthorized"
  | "unsupported"
  | "upstream";

type ProviderAdapterErrorOptions = {
  code: ProviderAdapterErrorCode;
  sourceLabel: string;
  message: string;
  retryable?: boolean;
  status?: number;
  cause?: unknown;
};

export class ProviderAdapterError extends Error {
  readonly code: ProviderAdapterErrorCode;
  readonly sourceLabel: string;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(options: ProviderAdapterErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "ProviderAdapterError";
    this.code = options.code;
    this.sourceLabel = options.sourceLabel;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
  }
}

export type ProviderAdapterStreamEmitter = (
  event: ProviderAdapterStreamEvent,
) => void | Promise<void>;

export interface ProviderAdapter {
  readonly id: string;
  readonly sourceLabel: string;
  stream(
    request: ProviderAdapterRequest,
    emit: ProviderAdapterStreamEmitter,
  ): Promise<ProviderAdapterResponse>;
}

function resolveHttpErrorCode(status: number): ProviderAdapterErrorCode {
  if (status === 401 || status === 403) {
    return "unauthorized";
  }
  if (status === 408) {
    return "timeout";
  }
  if (status === 400 || status === 404 || status === 405) {
    return "bad-response";
  }
  if (status === 501) {
    return "unsupported";
  }
  return "upstream";
}

export function createProviderAdapterHttpError(params: {
  sourceLabel: string;
  status: number;
  statusText?: string;
  bodyText?: string;
}): ProviderAdapterError {
  const bodyText = params.bodyText?.trim();
  const statusText = params.statusText?.trim();
  const suffix = bodyText || statusText || "unexpected response";
  return new ProviderAdapterError({
    code: resolveHttpErrorCode(params.status),
    sourceLabel: params.sourceLabel,
    status: params.status,
    retryable: params.status === 408 || params.status === 429 || params.status >= 500,
    message: `${params.sourceLabel} request failed (${params.status}${statusText ? ` ${statusText}` : ""}): ${suffix}`,
  });
}

export function isAbortLikeError(error: unknown): boolean {
  return (
    Boolean(error) &&
    typeof error === "object" &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

export function normalizeProviderAdapterError(
  error: unknown,
  params: {
    sourceLabel: string;
    fallbackCode?: Exclude<ProviderAdapterErrorCode, "aborted">;
  },
): ProviderAdapterError {
  if (error instanceof ProviderAdapterError) {
    return error;
  }
  if (isAbortLikeError(error)) {
    return new ProviderAdapterError({
      code: "aborted",
      sourceLabel: params.sourceLabel,
      message: `${params.sourceLabel} request aborted`,
    });
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "unexpected provider adapter error";
  return new ProviderAdapterError({
    code: params.fallbackCode ?? "upstream",
    sourceLabel: params.sourceLabel,
    message,
    cause: error,
  });
}
