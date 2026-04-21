import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_ACCENTS, DEFAULT_THEME_FAMILY } from "../shared/alisio-appearance.js";
import { withTempDir } from "../test-helpers/temp-dir.js";
import { completeAlisioConnectorAuthorization } from "./alisio-store.js";
import {
  getAlisioStripeAccount,
  listAlisioStripeCharges,
  listAlisioStripeCustomers,
  listAlisioStripeDisputes,
  listAlisioStripePaymentIntents,
  listAlisioStripePrices,
  listAlisioStripeProducts,
  listAlisioStripeRefunds,
  listAlisioStripeSubscriptions,
  readAlisioStripeCharge,
} from "./alisio-stripe.js";

const CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function createReadyAlisioAccountEnv(root: string) {
  const env = {
    ALISIO_STATE_DIR: root,
    ALISIO_SUPABASE_URL: "https://example.supabase.co",
    ALISIO_SUPABASE_ANON_KEY: "anon-key",
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

async function connectStripe(env: NodeJS.ProcessEnv) {
  const connectFetch = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      jsonResponse({
        object: "balance",
        livemode: false,
        available: [],
        pending: [],
      }),
    )
    .mockResolvedValueOnce(jsonResponse({ object: "list", data: [] }))
    .mockResolvedValueOnce(jsonResponse({ object: "list", data: [] }))
    .mockResolvedValueOnce(jsonResponse({ object: "list", data: [] }))
    .mockResolvedValueOnce(jsonResponse({ object: "list", data: [] }))
    .mockResolvedValueOnce(jsonResponse({ object: "list", data: [] }))
    .mockResolvedValueOnce(jsonResponse({ object: "list", data: [] }))
    .mockResolvedValueOnce(jsonResponse({ object: "list", data: [] }))
    .mockResolvedValueOnce(jsonResponse({ object: "list", data: [] }));

  await completeAlisioConnectorAuthorization(
    {
      connectorId: "stripe",
      apiKey: "rk_test_runtime_readonly",
    },
    env,
    connectFetch,
  );
}

describe("alisio stripe runtime", () => {
  it("returns a connection hint when Stripe is not connected", async () => {
    await withTempDir({ prefix: "alisio-stripe-runtime-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);

      const result = await getAlisioStripeAccount(env);

      expect(result).toMatchObject({
        ok: false,
        status: "auth_required",
        connectorId: "stripe",
        reconnectRequired: false,
      });
    });
  });

  it("reads the Stripe account summary through the stored connector token", async () => {
    await withTempDir({ prefix: "alisio-stripe-runtime-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectStripe(env);

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        jsonResponse({
          object: "balance",
          livemode: false,
          available: [{ amount: 12500, currency: "eur" }],
          pending: [{ amount: 3200, currency: "eur" }],
        }),
      );

      const result = await getAlisioStripeAccount(env, fetchMock);

      expect(result).toMatchObject({
        ok: true,
        status: "account",
        connectorId: "stripe",
        account: {
          livemode: false,
          mode: "test",
          available: [{ amount: 12500, currency: "eur" }],
          pending: [{ amount: 3200, currency: "eur" }],
        },
      });
      expect(readFetchCallUrl(fetchMock.mock.calls[0]?.[0])).toBe(
        "https://api.stripe.com/v1/balance",
      );
    });
  });

  it("lists Stripe customers, payment intents, and charges through the runtime wrapper", async () => {
    await withTempDir({ prefix: "alisio-stripe-runtime-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectStripe(env);

      const customersFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
        jsonResponse({
          object: "list",
          data: [{ id: "cus_123", name: "Nuno Lopes", email: "nuno@example.com" }],
        }),
      );
      const customers = await listAlisioStripeCustomers(
        { limit: 4, email: "nuno@example.com" },
        env,
        customersFetch,
      );
      expect(customers).toMatchObject({
        ok: true,
        status: "customers_listed",
        customers: [{ id: "cus_123", email: "nuno@example.com" }],
      });

      const paymentIntentsFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
        jsonResponse({
          object: "list",
          data: [
            {
              id: "pi_123",
              amount: 3200,
              amount_received: 3200,
              currency: "eur",
              status: "succeeded",
              customer: "cus_123",
            },
          ],
        }),
      );
      const paymentIntents = await listAlisioStripePaymentIntents(
        { limit: 3, customer: "cus_123" },
        env,
        paymentIntentsFetch,
      );
      expect(paymentIntents).toMatchObject({
        ok: true,
        status: "payment_intents_listed",
        paymentIntents: [{ id: "pi_123", customerId: "cus_123" }],
      });

      const chargesFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
        jsonResponse({
          object: "list",
          data: [
            {
              id: "ch_123",
              amount: 3200,
              currency: "eur",
              paid: true,
              refunded: false,
              payment_intent: "pi_123",
            },
          ],
        }),
      );
      const charges = await listAlisioStripeCharges(
        { limit: 2, paymentIntentId: "pi_123" },
        env,
        chargesFetch,
      );
      expect(charges).toMatchObject({
        ok: true,
        status: "charges_listed",
        charges: [{ id: "ch_123", paymentIntentId: "pi_123" }],
      });
    });
  });

  it("reads an individual Stripe charge through the runtime wrapper", async () => {
    await withTempDir({ prefix: "alisio-stripe-runtime-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectStripe(env);

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        jsonResponse({
          id: "ch_123",
          amount: 3200,
          currency: "eur",
          paid: true,
          refunded: false,
          customer: {
            id: "cus_123",
            email: "nuno@example.com",
          },
          payment_intent: {
            id: "pi_123",
          },
        }),
      );

      const result = await readAlisioStripeCharge(
        {
          chargeId: "ch_123",
        },
        env,
        fetchMock,
      );

      expect(result).toMatchObject({
        ok: true,
        status: "charge",
        charge: {
          id: "ch_123",
          customerId: "cus_123",
          paymentIntentId: "pi_123",
        },
      });
    });
  });

  it("lists Stripe products, prices, subscriptions, disputes, and refunds through the runtime wrapper", async () => {
    await withTempDir({ prefix: "alisio-stripe-runtime-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectStripe(env);

      const products = await listAlisioStripeProducts(
        { limit: 2 },
        env,
        vi.fn<typeof fetch>().mockResolvedValueOnce(
          jsonResponse({
            object: "list",
            data: [{ id: "prod_123", name: "Starter", default_price: "price_123" }],
          }),
        ),
      );
      expect(products).toMatchObject({
        ok: true,
        status: "products_listed",
        products: [{ id: "prod_123", defaultPriceId: "price_123" }],
      });

      const prices = await listAlisioStripePrices(
        { limit: 2, productId: "prod_123" },
        env,
        vi.fn<typeof fetch>().mockResolvedValueOnce(
          jsonResponse({
            object: "list",
            data: [{ id: "price_123", currency: "eur", product: "prod_123" }],
          }),
        ),
      );
      expect(prices).toMatchObject({
        ok: true,
        status: "prices_listed",
        prices: [{ id: "price_123", productId: "prod_123" }],
      });

      const subscriptions = await listAlisioStripeSubscriptions(
        { limit: 2, customer: "cus_123" },
        env,
        vi.fn<typeof fetch>().mockResolvedValueOnce(
          jsonResponse({
            object: "list",
            data: [{ id: "sub_123", status: "active", customer: "cus_123" }],
          }),
        ),
      );
      expect(subscriptions).toMatchObject({
        ok: true,
        status: "subscriptions_listed",
        subscriptions: [{ id: "sub_123", customerId: "cus_123" }],
      });

      const disputes = await listAlisioStripeDisputes(
        { limit: 2 },
        env,
        vi.fn<typeof fetch>().mockResolvedValueOnce(
          jsonResponse({
            object: "list",
            data: [{ id: "dp_123", amount: 900, currency: "eur", status: "needs_response" }],
          }),
        ),
      );
      expect(disputes).toMatchObject({
        ok: true,
        status: "disputes_listed",
        disputes: [{ id: "dp_123", amount: 900 }],
      });

      const refunds = await listAlisioStripeRefunds(
        { limit: 2, chargeId: "ch_123" },
        env,
        vi.fn<typeof fetch>().mockResolvedValueOnce(
          jsonResponse({
            object: "list",
            data: [{ id: "re_123", amount: 900, currency: "eur", charge: "ch_123" }],
          }),
        ),
      );
      expect(refunds).toMatchObject({
        ok: true,
        status: "refunds_listed",
        refunds: [{ id: "re_123", chargeId: "ch_123" }],
      });
    });
  });
});
