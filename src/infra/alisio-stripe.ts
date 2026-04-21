import { resolveAlisioConnectorRuntimeAccess } from "./alisio-connector-runtime.js";
import {
  listAlisioStripeChargesWithApiKey,
  listAlisioStripeCustomersWithApiKey,
  listAlisioStripeDisputesWithApiKey,
  listAlisioStripePaymentIntentsWithApiKey,
  listAlisioStripePricesWithApiKey,
  listAlisioStripeProductsWithApiKey,
  listAlisioStripeRefundsWithApiKey,
  listAlisioStripeSubscriptionsWithApiKey,
  readAlisioStripeAccountWithApiKey,
  readAlisioStripeChargeWithApiKey,
  readAlisioStripeCustomerWithApiKey,
  readAlisioStripeDisputeWithApiKey,
  readAlisioStripePaymentIntentWithApiKey,
  readAlisioStripePriceWithApiKey,
  readAlisioStripeProductWithApiKey,
  readAlisioStripeRefundWithApiKey,
  readAlisioStripeSubscriptionWithApiKey,
  type AlisioStripeResult,
} from "./alisio-stripe-client.js";

const STRIPE_CONNECTOR_ID = "stripe";

function buildStripeAuthError(params: { reconnectRequired: boolean }): AlisioStripeResult {
  return {
    ok: false,
    status: "auth_required",
    connectorId: STRIPE_CONNECTOR_ID,
    message: params.reconnectRequired
      ? "Stripe authorization is no longer valid. Reconnect Stripe in Apps."
      : "Stripe is not connected in Alisio. Connect Stripe in Apps first.",
    reconnectRequired: params.reconnectRequired,
  };
}

async function withStripeAccess(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  action: (apiKey: string) => Promise<AlisioStripeResult>,
): Promise<AlisioStripeResult> {
  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [STRIPE_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return buildStripeAuthError({ reconnectRequired: authorization.reconnectRequired });
  }
  return action(authorization.accessToken);
}

export async function getAlisioStripeAccount(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  return withStripeAccess(env, fetchImpl, (apiKey) =>
    readAlisioStripeAccountWithApiKey({ apiKey }, fetchImpl),
  );
}

export async function listAlisioStripeCustomers(
  input: { limit?: number; email?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  return withStripeAccess(env, fetchImpl, (apiKey) =>
    listAlisioStripeCustomersWithApiKey(
      {
        apiKey,
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
        ...(input.email?.trim() ? { email: input.email.trim() } : {}),
      },
      fetchImpl,
    ),
  );
}

export async function readAlisioStripeCustomer(
  input: { customerId: string },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  return withStripeAccess(env, fetchImpl, (apiKey) =>
    readAlisioStripeCustomerWithApiKey(
      {
        apiKey,
        customerId: input.customerId,
      },
      fetchImpl,
    ),
  );
}

export async function listAlisioStripePaymentIntents(
  input: { limit?: number; customer?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  return withStripeAccess(env, fetchImpl, (apiKey) =>
    listAlisioStripePaymentIntentsWithApiKey(
      {
        apiKey,
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
        ...(input.customer?.trim() ? { customer: input.customer.trim() } : {}),
      },
      fetchImpl,
    ),
  );
}

export async function readAlisioStripePaymentIntent(
  input: { paymentIntentId: string },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  return withStripeAccess(env, fetchImpl, (apiKey) =>
    readAlisioStripePaymentIntentWithApiKey(
      {
        apiKey,
        paymentIntentId: input.paymentIntentId,
      },
      fetchImpl,
    ),
  );
}

export async function listAlisioStripeCharges(
  input: { limit?: number; customer?: string; paymentIntentId?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  return withStripeAccess(env, fetchImpl, (apiKey) =>
    listAlisioStripeChargesWithApiKey(
      {
        apiKey,
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
        ...(input.customer?.trim() ? { customer: input.customer.trim() } : {}),
        ...(input.paymentIntentId?.trim() ? { paymentIntentId: input.paymentIntentId.trim() } : {}),
      },
      fetchImpl,
    ),
  );
}

export async function readAlisioStripeCharge(
  input: { chargeId: string },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  return withStripeAccess(env, fetchImpl, (apiKey) =>
    readAlisioStripeChargeWithApiKey(
      {
        apiKey,
        chargeId: input.chargeId,
      },
      fetchImpl,
    ),
  );
}

export async function listAlisioStripeProducts(
  input: { limit?: number } = {},
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  return withStripeAccess(env, fetchImpl, (apiKey) =>
    listAlisioStripeProductsWithApiKey(
      {
        apiKey,
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
      },
      fetchImpl,
    ),
  );
}

export async function readAlisioStripeProduct(
  input: { productId: string },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  return withStripeAccess(env, fetchImpl, (apiKey) =>
    readAlisioStripeProductWithApiKey(
      {
        apiKey,
        productId: input.productId,
      },
      fetchImpl,
    ),
  );
}

export async function listAlisioStripePrices(
  input: { limit?: number; productId?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  return withStripeAccess(env, fetchImpl, (apiKey) =>
    listAlisioStripePricesWithApiKey(
      {
        apiKey,
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
        ...(input.productId?.trim() ? { productId: input.productId.trim() } : {}),
      },
      fetchImpl,
    ),
  );
}

export async function readAlisioStripePrice(
  input: { priceId: string },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  return withStripeAccess(env, fetchImpl, (apiKey) =>
    readAlisioStripePriceWithApiKey(
      {
        apiKey,
        priceId: input.priceId,
      },
      fetchImpl,
    ),
  );
}

export async function listAlisioStripeSubscriptions(
  input: { limit?: number; customer?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  return withStripeAccess(env, fetchImpl, (apiKey) =>
    listAlisioStripeSubscriptionsWithApiKey(
      {
        apiKey,
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
        ...(input.customer?.trim() ? { customer: input.customer.trim() } : {}),
      },
      fetchImpl,
    ),
  );
}

export async function readAlisioStripeSubscription(
  input: { subscriptionId: string },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  return withStripeAccess(env, fetchImpl, (apiKey) =>
    readAlisioStripeSubscriptionWithApiKey(
      {
        apiKey,
        subscriptionId: input.subscriptionId,
      },
      fetchImpl,
    ),
  );
}

export async function listAlisioStripeDisputes(
  input: { limit?: number } = {},
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  return withStripeAccess(env, fetchImpl, (apiKey) =>
    listAlisioStripeDisputesWithApiKey(
      {
        apiKey,
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
      },
      fetchImpl,
    ),
  );
}

export async function readAlisioStripeDispute(
  input: { disputeId: string },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  return withStripeAccess(env, fetchImpl, (apiKey) =>
    readAlisioStripeDisputeWithApiKey(
      {
        apiKey,
        disputeId: input.disputeId,
      },
      fetchImpl,
    ),
  );
}

export async function listAlisioStripeRefunds(
  input: { limit?: number; chargeId?: string; paymentIntentId?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  return withStripeAccess(env, fetchImpl, (apiKey) =>
    listAlisioStripeRefundsWithApiKey(
      {
        apiKey,
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
        ...(input.chargeId?.trim() ? { chargeId: input.chargeId.trim() } : {}),
        ...(input.paymentIntentId?.trim() ? { paymentIntentId: input.paymentIntentId.trim() } : {}),
      },
      fetchImpl,
    ),
  );
}

export async function readAlisioStripeRefund(
  input: { refundId: string },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioStripeResult> {
  return withStripeAccess(env, fetchImpl, (apiKey) =>
    readAlisioStripeRefundWithApiKey(
      {
        apiKey,
        refundId: input.refundId,
      },
      fetchImpl,
    ),
  );
}
