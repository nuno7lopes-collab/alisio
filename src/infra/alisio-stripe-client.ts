import { Buffer } from "node:buffer";

const STRIPE_API_ROOT = "https://api.stripe.com/v1";
const STRIPE_CONNECTOR_ID = "stripe";
const STRIPE_MAX_LIMIT = 100;
const STRIPE_RUNTIME_USER_AGENT = "Alisio";

type StripeMode = "test" | "live";
type StripeKeyKind = "secret" | "restricted";
type StripeErrorResultStatus = "auth_required" | "read_failed";
type StripeQueryValue = string | number | boolean | undefined;

type StripeRequestError = {
  statusCode: number;
  message: string;
  code?: string;
  type?: string;
  requestId?: string;
  reconnectRequired: boolean;
  permissionDenied: boolean;
};

type StripeRequestResult<TBody> =
  | {
      ok: true;
      body: TBody;
      requestId?: string;
    }
  | {
      ok: false;
      error: StripeRequestError;
    };

type StripeConnectedAccount = {
  label: string;
  email?: string;
  handle?: string;
};

export type AlisioStripeBalanceAmount = {
  amount: number;
  currency: string;
  sourceType?: string;
};

export type AlisioStripeAccountSummary = {
  livemode: boolean;
  mode: StripeMode;
  keyKind: StripeKeyKind;
  available: AlisioStripeBalanceAmount[];
  pending: AlisioStripeBalanceAmount[];
  connectReserved?: AlisioStripeBalanceAmount[];
};

export type AlisioStripeCustomerSummary = {
  id: string;
  name?: string;
  email?: string;
  description?: string;
  currency?: string;
  balance?: number;
  delinquent?: boolean;
  livemode?: boolean;
  createdAt?: string;
};

export type AlisioStripePaymentIntentSummary = {
  id: string;
  amount: number;
  amountReceived?: number;
  currency: string;
  status: string;
  description?: string;
  customerId?: string;
  customerLabel?: string;
  customerEmail?: string;
  receiptEmail?: string;
  latestChargeId?: string;
  livemode?: boolean;
  createdAt?: string;
};

export type AlisioStripeChargeSummary = {
  id: string;
  amount: number;
  amountCaptured?: number;
  amountRefunded?: number;
  currency: string;
  status?: string;
  paid: boolean;
  refunded: boolean;
  description?: string;
  customerId?: string;
  customerLabel?: string;
  customerEmail?: string;
  paymentIntentId?: string;
  receiptEmail?: string;
  failureCode?: string;
  failureMessage?: string;
  livemode?: boolean;
  createdAt?: string;
};

export type AlisioStripeResult =
  | {
      ok: true;
      status: "account";
      connectorId: "stripe";
      account: AlisioStripeAccountSummary;
    }
  | {
      ok: true;
      status: "customers_listed";
      connectorId: "stripe";
      customers: AlisioStripeCustomerSummary[];
    }
  | {
      ok: true;
      status: "customer";
      connectorId: "stripe";
      customer: AlisioStripeCustomerSummary;
    }
  | {
      ok: true;
      status: "payment_intents_listed";
      connectorId: "stripe";
      paymentIntents: AlisioStripePaymentIntentSummary[];
    }
  | {
      ok: true;
      status: "payment_intent";
      connectorId: "stripe";
      paymentIntent: AlisioStripePaymentIntentSummary;
    }
  | {
      ok: true;
      status: "charges_listed";
      connectorId: "stripe";
      charges: AlisioStripeChargeSummary[];
    }
  | {
      ok: true;
      status: "charge";
      connectorId: "stripe";
      charge: AlisioStripeChargeSummary;
    }
  | {
      ok: false;
      status: StripeErrorResultStatus;
      connectorId: "stripe";
      message: string;
      reconnectRequired?: boolean;
      apiCode?: string;
      apiType?: string;
      requestId?: string;
    };

export type AlisioStripeKeyValidationResult =
  | {
      ok: true;
      connectedAccount: StripeConnectedAccount;
      keyKind: StripeKeyKind;
      mode: StripeMode;
    }
  | {
      ok: false;
      message: string;
      reconnectRequired?: boolean;
      missingPermissions?: string[];
    };

function normalizeStripeApiKey(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return /^(?:sk|rk)_(?:test|live)_[A-Za-z0-9_]+$/.test(trimmed) ? trimmed : null;
}

function detectStripeMode(apiKey: string): StripeMode {
  return apiKey.includes("_live_") ? "live" : "test";
}

function detectStripeKeyKind(apiKey: string): StripeKeyKind {
  return apiKey.startsWith("rk_") ? "restricted" : "secret";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readObjectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is Record<string, unknown> =>
    Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
  );
}

function toCreatedAt(value: unknown): string | undefined {
  const created = readNumber(value);
  return created !== undefined ? new Date(created * 1000).toISOString() : undefined;
}

function joinHumanList(values: readonly string[]): string {
  if (values.length === 0) {
    return "";
  }
  if (values.length === 1) {
    return values[0] ?? "";
  }
  if (values.length === 2) {
    return `${values[0] ?? ""} and ${values[1] ?? ""}`;
  }
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1] ?? ""}`;
}

function buildStripeAuthorizationHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`, "utf8").toString("base64")}`;
}

function buildStripeUrl(path: string, query?: Record<string, StripeQueryValue>, expand?: string[]) {
  const normalizedPath = path.trim().replace(/^\/+/, "");
  const url = new URL(
    normalizedPath ? `${STRIPE_API_ROOT}/${normalizedPath}` : `${STRIPE_API_ROOT}/`,
  );
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  for (const field of expand ?? []) {
    const trimmed = field.trim();
    if (trimmed) {
      url.searchParams.append("expand[]", trimmed);
    }
  }
  return url;
}

function buildStripeRequestError(
  response: Response,
  body: unknown,
  fallbackMessage: string,
  requestId?: string,
): StripeRequestError {
  const errorBody = readObject(readObject(body)?.error);
  const message =
    readString(errorBody?.message) ?? readString(readObject(body)?.message) ?? fallbackMessage;
  const statusCode = response.status;
  return {
    statusCode,
    message,
    ...(readString(errorBody?.code) ? { code: readString(errorBody?.code) } : {}),
    ...(readString(errorBody?.type) ? { type: readString(errorBody?.type) } : {}),
    ...(requestId ? { requestId } : {}),
    reconnectRequired: statusCode === 401 || statusCode === 403,
    permissionDenied: statusCode === 403,
  };
}

async function requestStripe<TBody extends Record<string, unknown>>(
  path: string,
  params: {
    apiKey: string;
    query?: Record<string, StripeQueryValue>;
    expand?: string[];
    fetchImpl?: typeof fetch;
    fallbackMessage: string;
  },
): Promise<StripeRequestResult<TBody>> {
  const fetchImpl = params.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(buildStripeUrl(path, params.query, params.expand), {
      headers: {
        accept: "application/json",
        authorization: buildStripeAuthorizationHeader(params.apiKey),
        "user-agent": STRIPE_RUNTIME_USER_AGENT,
      },
    });
    const requestId = response.headers.get("request-id")?.trim() || undefined;
    const body = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      return {
        ok: false,
        error: buildStripeRequestError(response, body, params.fallbackMessage, requestId),
      };
    }
    const objectBody = readObject(body);
    if (!objectBody) {
      return {
        ok: false,
        error: {
          statusCode: response.status,
          message: params.fallbackMessage,
          ...(requestId ? { requestId } : {}),
          reconnectRequired: false,
          permissionDenied: false,
        },
      };
    }
    return {
      ok: true,
      body: objectBody as TBody,
      ...(requestId ? { requestId } : {}),
    };
  } catch {
    return {
      ok: false,
      error: {
        statusCode: 0,
        message: "Stripe could not be reached right now. Try again in a moment.",
        reconnectRequired: false,
        permissionDenied: false,
      },
    };
  }
}

function normalizeBalanceAmount(entry: Record<string, unknown>): AlisioStripeBalanceAmount | null {
  const amount = readNumber(entry.amount);
  const currency = readString(entry.currency);
  if (amount === undefined || !currency) {
    return null;
  }
  return {
    amount,
    currency,
    ...(readString(entry.source_type) ? { sourceType: readString(entry.source_type) } : {}),
  };
}

function normalizeStripeCustomer(
  entry: Record<string, unknown>,
): AlisioStripeCustomerSummary | null {
  const id = readString(entry.id);
  if (!id) {
    return null;
  }
  return {
    id,
    ...(readString(entry.name) ? { name: readString(entry.name) } : {}),
    ...(readString(entry.email) ? { email: readString(entry.email) } : {}),
    ...(readString(entry.description) ? { description: readString(entry.description) } : {}),
    ...(readString(entry.currency) ? { currency: readString(entry.currency) } : {}),
    ...(readNumber(entry.balance) !== undefined ? { balance: readNumber(entry.balance) } : {}),
    ...(readBoolean(entry.delinquent) !== undefined
      ? { delinquent: readBoolean(entry.delinquent) }
      : {}),
    ...(readBoolean(entry.livemode) !== undefined ? { livemode: readBoolean(entry.livemode) } : {}),
    ...(toCreatedAt(entry.created) ? { createdAt: toCreatedAt(entry.created) } : {}),
  };
}

function normalizeExpandedCustomer(value: unknown): {
  customerId?: string;
  customerLabel?: string;
  customerEmail?: string;
} {
  if (typeof value === "string" && value.trim()) {
    return { customerId: value.trim() };
  }
  const customer = readObject(value);
  if (!customer) {
    return {};
  }
  const id = readString(customer.id);
  const name = readString(customer.name);
  const email = readString(customer.email);
  return {
    ...(id ? { customerId: id } : {}),
    ...(name || email ? { customerLabel: name ?? email } : {}),
    ...(email ? { customerEmail: email } : {}),
  };
}

function normalizeStripePaymentIntent(
  entry: Record<string, unknown>,
): AlisioStripePaymentIntentSummary | null {
  const id = readString(entry.id);
  const amount = readNumber(entry.amount);
  const currency = readString(entry.currency);
  const status = readString(entry.status);
  if (!id || amount === undefined || !currency || !status) {
    return null;
  }
  const latestCharge = entry.latest_charge;
  const latestChargeId =
    typeof latestCharge === "string"
      ? latestCharge.trim() || undefined
      : readString(readObject(latestCharge)?.id);
  return {
    id,
    amount,
    currency,
    status,
    ...(readNumber(entry.amount_received) !== undefined
      ? { amountReceived: readNumber(entry.amount_received) }
      : {}),
    ...(readString(entry.description) ? { description: readString(entry.description) } : {}),
    ...normalizeExpandedCustomer(entry.customer),
    ...(readString(entry.receipt_email) ? { receiptEmail: readString(entry.receipt_email) } : {}),
    ...(latestChargeId ? { latestChargeId } : {}),
    ...(readBoolean(entry.livemode) !== undefined ? { livemode: readBoolean(entry.livemode) } : {}),
    ...(toCreatedAt(entry.created) ? { createdAt: toCreatedAt(entry.created) } : {}),
  };
}

function normalizeStripeCharge(entry: Record<string, unknown>): AlisioStripeChargeSummary | null {
  const id = readString(entry.id);
  const amount = readNumber(entry.amount);
  const currency = readString(entry.currency);
  if (!id || amount === undefined || !currency) {
    return null;
  }
  const paymentIntentValue = entry.payment_intent;
  const paymentIntentId =
    typeof paymentIntentValue === "string"
      ? paymentIntentValue.trim() || undefined
      : readString(readObject(paymentIntentValue)?.id);
  return {
    id,
    amount,
    currency,
    paid: readBoolean(entry.paid) ?? false,
    refunded: readBoolean(entry.refunded) ?? false,
    ...(readNumber(entry.amount_captured) !== undefined
      ? { amountCaptured: readNumber(entry.amount_captured) }
      : {}),
    ...(readNumber(entry.amount_refunded) !== undefined
      ? { amountRefunded: readNumber(entry.amount_refunded) }
      : {}),
    ...(readString(entry.status) ? { status: readString(entry.status) } : {}),
    ...(readString(entry.description) ? { description: readString(entry.description) } : {}),
    ...normalizeExpandedCustomer(entry.customer),
    ...(paymentIntentId ? { paymentIntentId } : {}),
    ...(readString(entry.receipt_email) ? { receiptEmail: readString(entry.receipt_email) } : {}),
    ...(readString(entry.failure_code) ? { failureCode: readString(entry.failure_code) } : {}),
    ...(readString(entry.failure_message)
      ? { failureMessage: readString(entry.failure_message) }
      : {}),
    ...(readBoolean(entry.livemode) !== undefined ? { livemode: readBoolean(entry.livemode) } : {}),
    ...(toCreatedAt(entry.created) ? { createdAt: toCreatedAt(entry.created) } : {}),
  };
}

function buildStripeErrorResult(
  error: StripeRequestError,
  fallbackStatus: StripeErrorResultStatus = "read_failed",
): Extract<AlisioStripeResult, { ok: false }> {
  return {
    ok: false,
    status: error.reconnectRequired ? "auth_required" : fallbackStatus,
    connectorId: STRIPE_CONNECTOR_ID,
    message: error.message,
    ...(error.reconnectRequired ? { reconnectRequired: true } : {}),
    ...(error.code ? { apiCode: error.code } : {}),
    ...(error.type ? { apiType: error.type } : {}),
    ...(error.requestId ? { requestId: error.requestId } : {}),
  };
}

function readPageLimit(value: number | undefined): number {
  if (value === undefined) {
    return 20;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("limit must be a positive integer");
  }
  return Math.min(value, STRIPE_MAX_LIMIT);
}

export async function validateAlisioStripeApiKey(
  input: { apiKey: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeKeyValidationResult> {
  const apiKey = normalizeStripeApiKey(input.apiKey);
  if (!apiKey) {
    return {
      ok: false,
      message: "Enter a Stripe secret or restricted API key. Publishable keys are not supported.",
    };
  }

  const balance = await requestStripe("balance", {
    apiKey,
    fetchImpl,
    fallbackMessage: "Stripe rejected the account balance request.",
  });
  if (!balance.ok) {
    return {
      ok: false,
      message: balance.error.message,
      ...(balance.error.reconnectRequired ? { reconnectRequired: true } : {}),
    };
  }

  const permissionFailures: string[] = [];
  const permissionChecks: Array<{ label: string; path: string }> = [
    { label: "customers", path: "customers" },
    { label: "charges", path: "charges" },
    { label: "payment intents", path: "payment_intents" },
  ];
  for (const check of permissionChecks) {
    const result = await requestStripe(check.path, {
      apiKey,
      query: { limit: 1 },
      fetchImpl,
      fallbackMessage: `Stripe rejected the ${check.label} request.`,
    });
    if (result.ok) {
      continue;
    }
    if (result.error.permissionDenied || result.error.reconnectRequired) {
      permissionFailures.push(check.label);
      continue;
    }
    return {
      ok: false,
      message: result.error.message,
    };
  }

  if (permissionFailures.length > 0) {
    return {
      ok: false,
      message: `Stripe key needs read access to ${joinHumanList(permissionFailures)}.`,
      reconnectRequired: true,
      missingPermissions: permissionFailures,
    };
  }

  const livemode = readBoolean(balance.body.livemode);
  const mode = livemode === undefined ? detectStripeMode(apiKey) : livemode ? "live" : "test";
  const keyKind = detectStripeKeyKind(apiKey);
  return {
    ok: true,
    keyKind,
    mode,
    connectedAccount: {
      label: mode === "live" ? "Stripe live mode" : "Stripe test mode",
      handle: keyKind === "restricted" ? "restricted key" : "secret key",
    },
  };
}

export async function readAlisioStripeAccountWithApiKey(
  input: { apiKey: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  const apiKey = normalizeStripeApiKey(input.apiKey);
  if (!apiKey) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Enter a Stripe secret or restricted API key. Publishable keys are not supported.",
      reconnectRequired: true,
    };
  }
  const result = await requestStripe("balance", {
    apiKey,
    fetchImpl,
    fallbackMessage: "Stripe rejected the account balance request.",
  });
  if (!result.ok) {
    return buildStripeErrorResult(result.error);
  }
  const livemode = readBoolean(result.body.livemode);
  const mode = livemode === undefined ? detectStripeMode(apiKey) : livemode ? "live" : "test";
  return {
    ok: true,
    status: "account",
    connectorId: STRIPE_CONNECTOR_ID,
    account: {
      livemode: livemode ?? mode === "live",
      mode,
      keyKind: detectStripeKeyKind(apiKey),
      available: readObjectArray(result.body.available)
        .map((entry) => normalizeBalanceAmount(entry))
        .filter((entry): entry is AlisioStripeBalanceAmount => entry !== null),
      pending: readObjectArray(result.body.pending)
        .map((entry) => normalizeBalanceAmount(entry))
        .filter((entry): entry is AlisioStripeBalanceAmount => entry !== null),
      connectReserved: readObjectArray(result.body.connect_reserved)
        .map((entry) => normalizeBalanceAmount(entry))
        .filter((entry): entry is AlisioStripeBalanceAmount => entry !== null),
    },
  };
}

export async function listAlisioStripeCustomersWithApiKey(
  input: { apiKey: string; limit?: number; email?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  const apiKey = normalizeStripeApiKey(input.apiKey);
  if (!apiKey) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe API key is required.",
      reconnectRequired: true,
    };
  }
  const result = await requestStripe("customers", {
    apiKey,
    query: {
      limit: readPageLimit(input.limit),
      ...(input.email?.trim() ? { email: input.email.trim() } : {}),
    },
    fetchImpl,
    fallbackMessage: "Stripe rejected the customers request.",
  });
  if (!result.ok) {
    return buildStripeErrorResult(result.error);
  }
  return {
    ok: true,
    status: "customers_listed",
    connectorId: STRIPE_CONNECTOR_ID,
    customers: readObjectArray(result.body.data)
      .map((entry) => normalizeStripeCustomer(entry))
      .filter((entry): entry is AlisioStripeCustomerSummary => entry !== null),
  };
}

export async function readAlisioStripeCustomerWithApiKey(
  input: { apiKey: string; customerId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  const apiKey = normalizeStripeApiKey(input.apiKey);
  const customerId = input.customerId.trim();
  if (!apiKey) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe API key is required.",
      reconnectRequired: true,
    };
  }
  if (!customerId) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "customerId is required.",
    };
  }
  const result = await requestStripe(`customers/${encodeURIComponent(customerId)}`, {
    apiKey,
    fetchImpl,
    fallbackMessage: "Stripe rejected the customer request.",
  });
  if (!result.ok) {
    return buildStripeErrorResult(result.error);
  }
  const customer = normalizeStripeCustomer(result.body);
  if (!customer) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe returned an invalid customer payload.",
    };
  }
  return {
    ok: true,
    status: "customer",
    connectorId: STRIPE_CONNECTOR_ID,
    customer,
  };
}

export async function listAlisioStripePaymentIntentsWithApiKey(
  input: { apiKey: string; limit?: number; customer?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  const apiKey = normalizeStripeApiKey(input.apiKey);
  if (!apiKey) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe API key is required.",
      reconnectRequired: true,
    };
  }
  const result = await requestStripe("payment_intents", {
    apiKey,
    query: {
      limit: readPageLimit(input.limit),
      ...(input.customer?.trim() ? { customer: input.customer.trim() } : {}),
    },
    expand: ["data.customer", "data.latest_charge"],
    fetchImpl,
    fallbackMessage: "Stripe rejected the payment intents request.",
  });
  if (!result.ok) {
    return buildStripeErrorResult(result.error);
  }
  return {
    ok: true,
    status: "payment_intents_listed",
    connectorId: STRIPE_CONNECTOR_ID,
    paymentIntents: readObjectArray(result.body.data)
      .map((entry) => normalizeStripePaymentIntent(entry))
      .filter((entry): entry is AlisioStripePaymentIntentSummary => entry !== null),
  };
}

export async function readAlisioStripePaymentIntentWithApiKey(
  input: { apiKey: string; paymentIntentId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  const apiKey = normalizeStripeApiKey(input.apiKey);
  const paymentIntentId = input.paymentIntentId.trim();
  if (!apiKey) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe API key is required.",
      reconnectRequired: true,
    };
  }
  if (!paymentIntentId) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "paymentIntentId is required.",
    };
  }
  const result = await requestStripe(`payment_intents/${encodeURIComponent(paymentIntentId)}`, {
    apiKey,
    expand: ["customer", "latest_charge"],
    fetchImpl,
    fallbackMessage: "Stripe rejected the payment intent request.",
  });
  if (!result.ok) {
    return buildStripeErrorResult(result.error);
  }
  const paymentIntent = normalizeStripePaymentIntent(result.body);
  if (!paymentIntent) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe returned an invalid payment intent payload.",
    };
  }
  return {
    ok: true,
    status: "payment_intent",
    connectorId: STRIPE_CONNECTOR_ID,
    paymentIntent,
  };
}

export async function listAlisioStripeChargesWithApiKey(
  input: { apiKey: string; limit?: number; customer?: string; paymentIntentId?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  const apiKey = normalizeStripeApiKey(input.apiKey);
  if (!apiKey) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe API key is required.",
      reconnectRequired: true,
    };
  }
  const result = await requestStripe("charges", {
    apiKey,
    query: {
      limit: readPageLimit(input.limit),
      ...(input.customer?.trim() ? { customer: input.customer.trim() } : {}),
      ...(input.paymentIntentId?.trim() ? { payment_intent: input.paymentIntentId.trim() } : {}),
    },
    expand: ["data.customer", "data.payment_intent"],
    fetchImpl,
    fallbackMessage: "Stripe rejected the charges request.",
  });
  if (!result.ok) {
    return buildStripeErrorResult(result.error);
  }
  return {
    ok: true,
    status: "charges_listed",
    connectorId: STRIPE_CONNECTOR_ID,
    charges: readObjectArray(result.body.data)
      .map((entry) => normalizeStripeCharge(entry))
      .filter((entry): entry is AlisioStripeChargeSummary => entry !== null),
  };
}

export async function readAlisioStripeChargeWithApiKey(
  input: { apiKey: string; chargeId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  const apiKey = normalizeStripeApiKey(input.apiKey);
  const chargeId = input.chargeId.trim();
  if (!apiKey) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe API key is required.",
      reconnectRequired: true,
    };
  }
  if (!chargeId) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "chargeId is required.",
    };
  }
  const result = await requestStripe(`charges/${encodeURIComponent(chargeId)}`, {
    apiKey,
    expand: ["customer", "payment_intent"],
    fetchImpl,
    fallbackMessage: "Stripe rejected the charge request.",
  });
  if (!result.ok) {
    return buildStripeErrorResult(result.error);
  }
  const charge = normalizeStripeCharge(result.body);
  if (!charge) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe returned an invalid charge payload.",
    };
  }
  return {
    ok: true,
    status: "charge",
    connectorId: STRIPE_CONNECTOR_ID,
    charge,
  };
}
