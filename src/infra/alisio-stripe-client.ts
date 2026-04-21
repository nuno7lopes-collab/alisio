import { Buffer } from "node:buffer";

const STRIPE_API_ROOT = "https://api.stripe.com/v1";
const STRIPE_CONNECTOR_ID = "stripe";
const STRIPE_MAX_LIMIT = 100;
const STRIPE_RUNTIME_USER_AGENT = "Alisio";

type StripeMode = "test" | "live";
type StripeKeyKind = "secret" | "restricted";
type StripeAccessKind = StripeKeyKind | "oauth";
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
  accessKind: StripeAccessKind;
  keyKind?: StripeKeyKind;
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

export type AlisioStripeProductSummary = {
  id: string;
  name: string;
  active?: boolean;
  description?: string;
  defaultPriceId?: string;
  livemode?: boolean;
  createdAt?: string;
};

export type AlisioStripePriceSummary = {
  id: string;
  active?: boolean;
  currency: string;
  unitAmount?: number;
  nickname?: string;
  type?: string;
  productId?: string;
  productName?: string;
  recurringInterval?: string;
  recurringUsageType?: string;
  livemode?: boolean;
  createdAt?: string;
};

export type AlisioStripeSubscriptionSummary = {
  id: string;
  status: string;
  customerId?: string;
  customerLabel?: string;
  customerEmail?: string;
  collectionMethod?: string;
  currency?: string;
  cancelAtPeriodEnd?: boolean;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  canceledAt?: string;
  livemode?: boolean;
  createdAt?: string;
};

export type AlisioStripeDisputeSummary = {
  id: string;
  amount: number;
  currency: string;
  reason?: string;
  status: string;
  chargeId?: string;
  paymentIntentId?: string;
  livemode?: boolean;
  createdAt?: string;
};

export type AlisioStripeRefundSummary = {
  id: string;
  amount: number;
  currency: string;
  status?: string;
  reason?: string;
  chargeId?: string;
  paymentIntentId?: string;
  failureReason?: string;
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
      ok: true;
      status: "products_listed";
      connectorId: "stripe";
      products: AlisioStripeProductSummary[];
    }
  | {
      ok: true;
      status: "product";
      connectorId: "stripe";
      product: AlisioStripeProductSummary;
    }
  | {
      ok: true;
      status: "prices_listed";
      connectorId: "stripe";
      prices: AlisioStripePriceSummary[];
    }
  | {
      ok: true;
      status: "price";
      connectorId: "stripe";
      price: AlisioStripePriceSummary;
    }
  | {
      ok: true;
      status: "subscriptions_listed";
      connectorId: "stripe";
      subscriptions: AlisioStripeSubscriptionSummary[];
    }
  | {
      ok: true;
      status: "subscription";
      connectorId: "stripe";
      subscription: AlisioStripeSubscriptionSummary;
    }
  | {
      ok: true;
      status: "disputes_listed";
      connectorId: "stripe";
      disputes: AlisioStripeDisputeSummary[];
    }
  | {
      ok: true;
      status: "dispute";
      connectorId: "stripe";
      dispute: AlisioStripeDisputeSummary;
    }
  | {
      ok: true;
      status: "refunds_listed";
      connectorId: "stripe";
      refunds: AlisioStripeRefundSummary[];
    }
  | {
      ok: true;
      status: "refund";
      connectorId: "stripe";
      refund: AlisioStripeRefundSummary;
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
      accessKind: StripeAccessKind;
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

function normalizeStripeStoredCredential(value: string): {
  token: string;
  accessKind: StripeAccessKind;
  keyKind?: StripeKeyKind;
  modeHint?: StripeMode;
} | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^pk_(?:test|live)_[A-Za-z0-9_]+$/.test(trimmed)) {
    return null;
  }
  const apiKey = normalizeStripeApiKey(trimmed);
  if (!apiKey) {
    return {
      token: trimmed,
      accessKind: "oauth",
    };
  }
  const keyKind = detectStripeKeyKind(apiKey);
  return {
    token: apiKey,
    accessKind: keyKind,
    keyKind,
    modeHint: detectStripeMode(apiKey),
  };
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

function normalizeExpandedProduct(value: unknown): {
  productId?: string;
  productName?: string;
} {
  if (typeof value === "string" && value.trim()) {
    return { productId: value.trim() };
  }
  const product = readObject(value);
  if (!product) {
    return {};
  }
  const id = readString(product.id);
  const name = readString(product.name);
  return {
    ...(id ? { productId: id } : {}),
    ...(name ? { productName: name } : {}),
  };
}

function normalizeExpandedPriceId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : readString(readObject(value)?.id);
}

function normalizeExpandedCharge(value: unknown): {
  chargeId?: string;
  paymentIntentId?: string;
} {
  if (typeof value === "string" && value.trim()) {
    return { chargeId: value.trim() };
  }
  const charge = readObject(value);
  if (!charge) {
    return {};
  }
  const chargeId = readString(charge.id);
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent.trim() || undefined
      : readString(readObject(charge.payment_intent)?.id);
  return {
    ...(chargeId ? { chargeId } : {}),
    ...(paymentIntentId ? { paymentIntentId } : {}),
  };
}

function normalizeStripeProduct(entry: Record<string, unknown>): AlisioStripeProductSummary | null {
  const id = readString(entry.id);
  const name = readString(entry.name);
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    ...(readBoolean(entry.active) !== undefined ? { active: readBoolean(entry.active) } : {}),
    ...(readString(entry.description) ? { description: readString(entry.description) } : {}),
    ...(normalizeExpandedPriceId(entry.default_price)
      ? { defaultPriceId: normalizeExpandedPriceId(entry.default_price) }
      : {}),
    ...(readBoolean(entry.livemode) !== undefined ? { livemode: readBoolean(entry.livemode) } : {}),
    ...(toCreatedAt(entry.created) ? { createdAt: toCreatedAt(entry.created) } : {}),
  };
}

function normalizeStripePrice(entry: Record<string, unknown>): AlisioStripePriceSummary | null {
  const id = readString(entry.id);
  const currency = readString(entry.currency);
  if (!id || !currency) {
    return null;
  }
  const recurring = readObject(entry.recurring);
  return {
    id,
    currency,
    ...(readBoolean(entry.active) !== undefined ? { active: readBoolean(entry.active) } : {}),
    ...(readNumber(entry.unit_amount) !== undefined
      ? { unitAmount: readNumber(entry.unit_amount) }
      : {}),
    ...(readString(entry.nickname) ? { nickname: readString(entry.nickname) } : {}),
    ...(readString(entry.type) ? { type: readString(entry.type) } : {}),
    ...normalizeExpandedProduct(entry.product),
    ...(readString(recurring?.interval)
      ? { recurringInterval: readString(recurring?.interval) }
      : {}),
    ...(readString(recurring?.usage_type)
      ? { recurringUsageType: readString(recurring?.usage_type) }
      : {}),
    ...(readBoolean(entry.livemode) !== undefined ? { livemode: readBoolean(entry.livemode) } : {}),
    ...(toCreatedAt(entry.created) ? { createdAt: toCreatedAt(entry.created) } : {}),
  };
}

function normalizeStripeSubscription(
  entry: Record<string, unknown>,
): AlisioStripeSubscriptionSummary | null {
  const id = readString(entry.id);
  const status = readString(entry.status);
  if (!id || !status) {
    return null;
  }
  return {
    id,
    status,
    ...normalizeExpandedCustomer(entry.customer),
    ...(readString(entry.collection_method)
      ? { collectionMethod: readString(entry.collection_method) }
      : {}),
    ...(readString(entry.currency) ? { currency: readString(entry.currency) } : {}),
    ...(readBoolean(entry.cancel_at_period_end) !== undefined
      ? { cancelAtPeriodEnd: readBoolean(entry.cancel_at_period_end) }
      : {}),
    ...(toCreatedAt(entry.current_period_start)
      ? { currentPeriodStart: toCreatedAt(entry.current_period_start) }
      : {}),
    ...(toCreatedAt(entry.current_period_end)
      ? { currentPeriodEnd: toCreatedAt(entry.current_period_end) }
      : {}),
    ...(toCreatedAt(entry.canceled_at) ? { canceledAt: toCreatedAt(entry.canceled_at) } : {}),
    ...(readBoolean(entry.livemode) !== undefined ? { livemode: readBoolean(entry.livemode) } : {}),
    ...(toCreatedAt(entry.created) ? { createdAt: toCreatedAt(entry.created) } : {}),
  };
}

function normalizeStripeDispute(entry: Record<string, unknown>): AlisioStripeDisputeSummary | null {
  const id = readString(entry.id);
  const amount = readNumber(entry.amount);
  const currency = readString(entry.currency);
  const status = readString(entry.status);
  if (!id || amount === undefined || !currency || !status) {
    return null;
  }
  return {
    id,
    amount,
    currency,
    status,
    ...(readString(entry.reason) ? { reason: readString(entry.reason) } : {}),
    ...normalizeExpandedCharge(entry.charge),
    ...(readBoolean(entry.livemode) !== undefined ? { livemode: readBoolean(entry.livemode) } : {}),
    ...(toCreatedAt(entry.created) ? { createdAt: toCreatedAt(entry.created) } : {}),
  };
}

function normalizeStripeRefund(entry: Record<string, unknown>): AlisioStripeRefundSummary | null {
  const id = readString(entry.id);
  const amount = readNumber(entry.amount);
  const currency = readString(entry.currency);
  if (!id || amount === undefined || !currency) {
    return null;
  }
  const charge =
    typeof entry.charge === "string" || readObject(entry.charge)
      ? normalizeExpandedCharge(entry.charge)
      : {};
  const paymentIntentId =
    readString(entry.payment_intent) ??
    readString(readObject(entry.payment_intent)?.id) ??
    charge.paymentIntentId;
  return {
    id,
    amount,
    currency,
    ...(readString(entry.status) ? { status: readString(entry.status) } : {}),
    ...(readString(entry.reason) ? { reason: readString(entry.reason) } : {}),
    ...(charge.chargeId ? { chargeId: charge.chargeId } : {}),
    ...(paymentIntentId ? { paymentIntentId } : {}),
    ...(readString(entry.failure_reason)
      ? { failureReason: readString(entry.failure_reason) }
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

async function validateStripeReadAccess(params: {
  credential: string;
  fetchImpl: typeof fetch;
  modeHint?: StripeMode;
}): Promise<
  | {
      ok: true;
      mode: StripeMode;
    }
  | {
      ok: false;
      message: string;
      reconnectRequired?: boolean;
      missingPermissions?: string[];
    }
> {
  const balance = await requestStripe("balance", {
    apiKey: params.credential,
    fetchImpl: params.fetchImpl,
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
    { label: "products", path: "products" },
    { label: "prices", path: "prices" },
    { label: "subscriptions", path: "subscriptions" },
    { label: "disputes", path: "disputes" },
    { label: "refunds", path: "refunds" },
  ];
  for (const check of permissionChecks) {
    const result = await requestStripe(check.path, {
      apiKey: params.credential,
      query: { limit: 1 },
      fetchImpl: params.fetchImpl,
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
      message: `Stripe credential needs read access to ${joinHumanList(permissionFailures)}.`,
      reconnectRequired: true,
      missingPermissions: permissionFailures,
    };
  }

  const livemode = readBoolean(balance.body.livemode);
  return {
    ok: true,
    mode: livemode === undefined ? (params.modeHint ?? "live") : livemode ? "live" : "test",
  };
}

function buildStripeConnectedAccount(params: {
  mode: StripeMode;
  accessKind: StripeAccessKind;
  accountId?: string;
}): StripeConnectedAccount {
  const modeLabel = params.mode === "live" ? "live" : "test";
  if (params.accountId?.trim()) {
    return {
      label: `Stripe ${modeLabel} account`,
      handle: params.accountId.trim(),
    };
  }
  if (params.accessKind === "restricted" || params.accessKind === "secret") {
    return {
      label: params.mode === "live" ? "Stripe live mode" : "Stripe test mode",
      handle: params.accessKind === "restricted" ? "restricted key" : "secret key",
    };
  }
  return {
    label: `Stripe ${modeLabel} account`,
  };
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
  const probe = await validateStripeReadAccess({
    credential: apiKey,
    fetchImpl,
    modeHint: detectStripeMode(apiKey),
  });
  if (!probe.ok) {
    return {
      ok: false,
      message: probe.message.replace("Stripe credential", "Stripe key"),
      ...(probe.reconnectRequired ? { reconnectRequired: true } : {}),
      ...(probe.missingPermissions ? { missingPermissions: probe.missingPermissions } : {}),
    };
  }
  const keyKind = detectStripeKeyKind(apiKey);
  return {
    ok: true,
    accessKind: keyKind,
    keyKind,
    mode: probe.mode,
    connectedAccount: buildStripeConnectedAccount({
      mode: probe.mode,
      accessKind: keyKind,
    }),
  };
}

export async function validateAlisioStripeAccessToken(
  input: {
    accessToken: string;
    accountId?: string;
    livemode?: boolean;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<
  | {
      ok: true;
      connectedAccount: StripeConnectedAccount;
      accessKind: "oauth";
      mode: StripeMode;
    }
  | {
      ok: false;
      message: string;
      reconnectRequired?: boolean;
      missingPermissions?: string[];
    }
> {
  const accessToken = input.accessToken.trim();
  if (!accessToken || accessToken.startsWith("pk_")) {
    return {
      ok: false,
      message: "Stripe OAuth access token is missing or invalid.",
      reconnectRequired: true,
    };
  }
  const probe = await validateStripeReadAccess({
    credential: accessToken,
    fetchImpl,
    modeHint: typeof input.livemode === "boolean" ? (input.livemode ? "live" : "test") : undefined,
  });
  if (!probe.ok) {
    return probe;
  }
  return {
    ok: true,
    accessKind: "oauth",
    mode: probe.mode,
    connectedAccount: buildStripeConnectedAccount({
      mode: probe.mode,
      accessKind: "oauth",
      accountId: input.accountId,
    }),
  };
}

export async function readAlisioStripeAccountWithApiKey(
  input: { apiKey: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  const credential = normalizeStripeStoredCredential(input.apiKey);
  if (!credential) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Enter a Stripe secret or restricted API key. Publishable keys are not supported.",
      reconnectRequired: true,
    };
  }
  const result = await requestStripe("balance", {
    apiKey: credential.token,
    fetchImpl,
    fallbackMessage: "Stripe rejected the account balance request.",
  });
  if (!result.ok) {
    return buildStripeErrorResult(result.error);
  }
  const livemode = readBoolean(result.body.livemode);
  const mode =
    livemode === undefined ? (credential.modeHint ?? "live") : livemode ? "live" : "test";
  return {
    ok: true,
    status: "account",
    connectorId: STRIPE_CONNECTOR_ID,
    account: {
      livemode: livemode ?? mode === "live",
      mode,
      accessKind: credential.accessKind,
      ...(credential.keyKind ? { keyKind: credential.keyKind } : {}),
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
  const credential = normalizeStripeStoredCredential(input.apiKey);
  if (!credential) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe credential is required.",
      reconnectRequired: true,
    };
  }
  const result = await requestStripe("customers", {
    apiKey: credential.token,
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
  const credential = normalizeStripeStoredCredential(input.apiKey);
  const customerId = input.customerId.trim();
  if (!credential) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe credential is required.",
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
    apiKey: credential.token,
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
  const credential = normalizeStripeStoredCredential(input.apiKey);
  if (!credential) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe credential is required.",
      reconnectRequired: true,
    };
  }
  const result = await requestStripe("payment_intents", {
    apiKey: credential.token,
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
  const credential = normalizeStripeStoredCredential(input.apiKey);
  const paymentIntentId = input.paymentIntentId.trim();
  if (!credential) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe credential is required.",
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
    apiKey: credential.token,
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
  const credential = normalizeStripeStoredCredential(input.apiKey);
  if (!credential) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe credential is required.",
      reconnectRequired: true,
    };
  }
  const result = await requestStripe("charges", {
    apiKey: credential.token,
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
  const credential = normalizeStripeStoredCredential(input.apiKey);
  const chargeId = input.chargeId.trim();
  if (!credential) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe credential is required.",
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
    apiKey: credential.token,
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

export async function listAlisioStripeProductsWithApiKey(
  input: { apiKey: string; limit?: number } = { apiKey: "" },
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  const credential = normalizeStripeStoredCredential(input.apiKey);
  if (!credential) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe credential is required.",
      reconnectRequired: true,
    };
  }
  const result = await requestStripe("products", {
    apiKey: credential.token,
    query: {
      limit: readPageLimit(input.limit),
    },
    expand: ["data.default_price"],
    fetchImpl,
    fallbackMessage: "Stripe rejected the products request.",
  });
  if (!result.ok) {
    return buildStripeErrorResult(result.error);
  }
  return {
    ok: true,
    status: "products_listed",
    connectorId: STRIPE_CONNECTOR_ID,
    products: readObjectArray(result.body.data)
      .map((entry) => normalizeStripeProduct(entry))
      .filter((entry): entry is AlisioStripeProductSummary => entry !== null),
  };
}

export async function readAlisioStripeProductWithApiKey(
  input: { apiKey: string; productId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  const credential = normalizeStripeStoredCredential(input.apiKey);
  const productId = input.productId.trim();
  if (!credential) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe credential is required.",
      reconnectRequired: true,
    };
  }
  if (!productId) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "productId is required.",
    };
  }
  const result = await requestStripe(`products/${encodeURIComponent(productId)}`, {
    apiKey: credential.token,
    expand: ["default_price"],
    fetchImpl,
    fallbackMessage: "Stripe rejected the product request.",
  });
  if (!result.ok) {
    return buildStripeErrorResult(result.error);
  }
  const product = normalizeStripeProduct(result.body);
  if (!product) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe returned an invalid product payload.",
    };
  }
  return {
    ok: true,
    status: "product",
    connectorId: STRIPE_CONNECTOR_ID,
    product,
  };
}

export async function listAlisioStripePricesWithApiKey(
  input: { apiKey: string; limit?: number; productId?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  const credential = normalizeStripeStoredCredential(input.apiKey);
  if (!credential) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe credential is required.",
      reconnectRequired: true,
    };
  }
  const result = await requestStripe("prices", {
    apiKey: credential.token,
    query: {
      limit: readPageLimit(input.limit),
      ...(input.productId?.trim() ? { product: input.productId.trim() } : {}),
    },
    expand: ["data.product"],
    fetchImpl,
    fallbackMessage: "Stripe rejected the prices request.",
  });
  if (!result.ok) {
    return buildStripeErrorResult(result.error);
  }
  return {
    ok: true,
    status: "prices_listed",
    connectorId: STRIPE_CONNECTOR_ID,
    prices: readObjectArray(result.body.data)
      .map((entry) => normalizeStripePrice(entry))
      .filter((entry): entry is AlisioStripePriceSummary => entry !== null),
  };
}

export async function readAlisioStripePriceWithApiKey(
  input: { apiKey: string; priceId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  const credential = normalizeStripeStoredCredential(input.apiKey);
  const priceId = input.priceId.trim();
  if (!credential) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe credential is required.",
      reconnectRequired: true,
    };
  }
  if (!priceId) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "priceId is required.",
    };
  }
  const result = await requestStripe(`prices/${encodeURIComponent(priceId)}`, {
    apiKey: credential.token,
    expand: ["product"],
    fetchImpl,
    fallbackMessage: "Stripe rejected the price request.",
  });
  if (!result.ok) {
    return buildStripeErrorResult(result.error);
  }
  const price = normalizeStripePrice(result.body);
  if (!price) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe returned an invalid price payload.",
    };
  }
  return {
    ok: true,
    status: "price",
    connectorId: STRIPE_CONNECTOR_ID,
    price,
  };
}

export async function listAlisioStripeSubscriptionsWithApiKey(
  input: { apiKey: string; limit?: number; customer?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  const credential = normalizeStripeStoredCredential(input.apiKey);
  if (!credential) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe credential is required.",
      reconnectRequired: true,
    };
  }
  const result = await requestStripe("subscriptions", {
    apiKey: credential.token,
    query: {
      limit: readPageLimit(input.limit),
      ...(input.customer?.trim() ? { customer: input.customer.trim() } : {}),
    },
    expand: ["data.customer"],
    fetchImpl,
    fallbackMessage: "Stripe rejected the subscriptions request.",
  });
  if (!result.ok) {
    return buildStripeErrorResult(result.error);
  }
  return {
    ok: true,
    status: "subscriptions_listed",
    connectorId: STRIPE_CONNECTOR_ID,
    subscriptions: readObjectArray(result.body.data)
      .map((entry) => normalizeStripeSubscription(entry))
      .filter((entry): entry is AlisioStripeSubscriptionSummary => entry !== null),
  };
}

export async function readAlisioStripeSubscriptionWithApiKey(
  input: { apiKey: string; subscriptionId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  const credential = normalizeStripeStoredCredential(input.apiKey);
  const subscriptionId = input.subscriptionId.trim();
  if (!credential) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe credential is required.",
      reconnectRequired: true,
    };
  }
  if (!subscriptionId) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "subscriptionId is required.",
    };
  }
  const result = await requestStripe(`subscriptions/${encodeURIComponent(subscriptionId)}`, {
    apiKey: credential.token,
    expand: ["customer"],
    fetchImpl,
    fallbackMessage: "Stripe rejected the subscription request.",
  });
  if (!result.ok) {
    return buildStripeErrorResult(result.error);
  }
  const subscription = normalizeStripeSubscription(result.body);
  if (!subscription) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe returned an invalid subscription payload.",
    };
  }
  return {
    ok: true,
    status: "subscription",
    connectorId: STRIPE_CONNECTOR_ID,
    subscription,
  };
}

export async function listAlisioStripeDisputesWithApiKey(
  input: { apiKey: string; limit?: number } = { apiKey: "" },
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  const credential = normalizeStripeStoredCredential(input.apiKey);
  if (!credential) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe credential is required.",
      reconnectRequired: true,
    };
  }
  const result = await requestStripe("disputes", {
    apiKey: credential.token,
    query: {
      limit: readPageLimit(input.limit),
    },
    expand: ["data.charge", "data.charge.payment_intent"],
    fetchImpl,
    fallbackMessage: "Stripe rejected the disputes request.",
  });
  if (!result.ok) {
    return buildStripeErrorResult(result.error);
  }
  return {
    ok: true,
    status: "disputes_listed",
    connectorId: STRIPE_CONNECTOR_ID,
    disputes: readObjectArray(result.body.data)
      .map((entry) => normalizeStripeDispute(entry))
      .filter((entry): entry is AlisioStripeDisputeSummary => entry !== null),
  };
}

export async function readAlisioStripeDisputeWithApiKey(
  input: { apiKey: string; disputeId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  const credential = normalizeStripeStoredCredential(input.apiKey);
  const disputeId = input.disputeId.trim();
  if (!credential) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe credential is required.",
      reconnectRequired: true,
    };
  }
  if (!disputeId) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "disputeId is required.",
    };
  }
  const result = await requestStripe(`disputes/${encodeURIComponent(disputeId)}`, {
    apiKey: credential.token,
    expand: ["charge", "charge.payment_intent"],
    fetchImpl,
    fallbackMessage: "Stripe rejected the dispute request.",
  });
  if (!result.ok) {
    return buildStripeErrorResult(result.error);
  }
  const dispute = normalizeStripeDispute(result.body);
  if (!dispute) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe returned an invalid dispute payload.",
    };
  }
  return {
    ok: true,
    status: "dispute",
    connectorId: STRIPE_CONNECTOR_ID,
    dispute,
  };
}

export async function listAlisioStripeRefundsWithApiKey(
  input: { apiKey: string; limit?: number; chargeId?: string; paymentIntentId?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  const credential = normalizeStripeStoredCredential(input.apiKey);
  if (!credential) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe credential is required.",
      reconnectRequired: true,
    };
  }
  const result = await requestStripe("refunds", {
    apiKey: credential.token,
    query: {
      limit: readPageLimit(input.limit),
      ...(input.chargeId?.trim() ? { charge: input.chargeId.trim() } : {}),
      ...(input.paymentIntentId?.trim() ? { payment_intent: input.paymentIntentId.trim() } : {}),
    },
    expand: ["data.charge", "data.charge.payment_intent", "data.payment_intent"],
    fetchImpl,
    fallbackMessage: "Stripe rejected the refunds request.",
  });
  if (!result.ok) {
    return buildStripeErrorResult(result.error);
  }
  return {
    ok: true,
    status: "refunds_listed",
    connectorId: STRIPE_CONNECTOR_ID,
    refunds: readObjectArray(result.body.data)
      .map((entry) => normalizeStripeRefund(entry))
      .filter((entry): entry is AlisioStripeRefundSummary => entry !== null),
  };
}

export async function readAlisioStripeRefundWithApiKey(
  input: { apiKey: string; refundId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  const credential = normalizeStripeStoredCredential(input.apiKey);
  const refundId = input.refundId.trim();
  if (!credential) {
    return {
      ok: false,
      status: "auth_required",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe credential is required.",
      reconnectRequired: true,
    };
  }
  if (!refundId) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "refundId is required.",
    };
  }
  const result = await requestStripe(`refunds/${encodeURIComponent(refundId)}`, {
    apiKey: credential.token,
    expand: ["charge", "charge.payment_intent", "payment_intent"],
    fetchImpl,
    fallbackMessage: "Stripe rejected the refund request.",
  });
  if (!result.ok) {
    return buildStripeErrorResult(result.error);
  }
  const refund = normalizeStripeRefund(result.body);
  if (!refund) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: STRIPE_CONNECTOR_ID,
      message: "Stripe returned an invalid refund payload.",
    };
  }
  return {
    ok: true,
    status: "refund",
    connectorId: STRIPE_CONNECTOR_ID,
    refund,
  };
}
