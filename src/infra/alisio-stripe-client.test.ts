import { describe, expect, it, vi } from "vitest";
import {
  listAlisioStripeChargesWithApiKey,
  listAlisioStripeCustomersWithApiKey,
  listAlisioStripeDisputesWithApiKey,
  listAlisioStripePaymentIntentsWithApiKey,
  listAlisioStripePricesWithApiKey,
  listAlisioStripeProductsWithApiKey,
  listAlisioStripeRefundsWithApiKey,
  listAlisioStripeSubscriptionsWithApiKey,
  readAlisioStripeChargeWithApiKey,
  readAlisioStripeDisputeWithApiKey,
  readAlisioStripePriceWithApiKey,
  readAlisioStripeProductWithApiKey,
  readAlisioStripeRefundWithApiKey,
  readAlisioStripeSubscriptionWithApiKey,
  validateAlisioStripeAccessToken,
} from "./alisio-stripe-client.js";

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

describe("alisio stripe client", () => {
  it("validates Stripe App OAuth access tokens against the same read surface", async () => {
    const fetchMock = vi
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

    const result = await validateAlisioStripeAccessToken(
      {
        accessToken: "oauth_test_token_123",
        accountId: "acct_123",
        livemode: false,
      },
      fetchMock,
    );

    expect(result).toMatchObject({
      ok: true,
      accessKind: "oauth",
      mode: "test",
      connectedAccount: {
        label: "Stripe test account",
        handle: "acct_123",
      },
    });
  });

  it("reports missing read permissions across the required Stripe resources", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          object: "balance",
          livemode: true,
          available: [],
          pending: [],
        }),
      )
      .mockResolvedValue(
        jsonResponse(
          {
            error: {
              message: "Missing permission.",
              code: "permission_denied",
            },
          },
          403,
        ),
      );

    const result = await validateAlisioStripeAccessToken(
      {
        accessToken: "stripe-oauth-live-missing-permissions",
        livemode: true,
      },
      fetchMock,
    );

    expect(result).toMatchObject({
      ok: false,
      reconnectRequired: true,
      missingPermissions: [
        "customers",
        "charges",
        "payment intents",
        "products",
        "prices",
        "subscriptions",
        "disputes",
        "refunds",
      ],
    });
    expect(result.ok ? null : result.message).toBe(
      "Stripe credential needs read access to customers, charges, payment intents, products, prices, subscriptions, disputes, and refunds.",
    );
  });

  it("lists customers with the requested filters", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        object: "list",
        data: [
          {
            id: "cus_123",
            name: "Nuno Lopes",
            email: "nuno@example.com",
            livemode: false,
            created: 1_713_200_000,
          },
        ],
      }),
    );

    const result = await listAlisioStripeCustomersWithApiKey(
      {
        apiKey: "sk_test_customers_123",
        limit: 5,
        email: "nuno@example.com",
      },
      fetchMock,
    );

    expect(result).toMatchObject({
      ok: true,
      status: "customers_listed",
      connectorId: "stripe",
      customers: [
        {
          id: "cus_123",
          email: "nuno@example.com",
        },
      ],
    });
    const requestUrl = new URL(readFetchCallUrl(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.pathname).toBe("/v1/customers");
    expect(requestUrl.searchParams.get("limit")).toBe("5");
    expect(requestUrl.searchParams.get("email")).toBe("nuno@example.com");
  });

  it("normalizes expanded payment intents and charge references", async () => {
    const paymentIntentFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        object: "list",
        data: [
          {
            id: "pi_123",
            amount: 3200,
            amount_received: 3200,
            currency: "eur",
            status: "succeeded",
            customer: {
              id: "cus_123",
              name: "Nuno Lopes",
              email: "nuno@example.com",
            },
            latest_charge: {
              id: "ch_123",
            },
            receipt_email: "nuno@example.com",
            created: 1_713_200_000,
          },
        ],
      }),
    );

    const paymentIntentResult = await listAlisioStripePaymentIntentsWithApiKey(
      {
        apiKey: "sk_test_payments_123",
        limit: 3,
        customer: "cus_123",
      },
      paymentIntentFetch,
    );

    expect(paymentIntentResult).toMatchObject({
      ok: true,
      status: "payment_intents_listed",
      paymentIntents: [
        {
          id: "pi_123",
          customerId: "cus_123",
          customerEmail: "nuno@example.com",
          latestChargeId: "ch_123",
        },
      ],
    });

    const chargeFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        id: "ch_123",
        amount: 3200,
        amount_captured: 3200,
        amount_refunded: 0,
        currency: "eur",
        paid: true,
        refunded: false,
        customer: {
          id: "cus_123",
          name: "Nuno Lopes",
          email: "nuno@example.com",
        },
        payment_intent: {
          id: "pi_123",
        },
        created: 1_713_200_000,
      }),
    );

    const chargeResult = await readAlisioStripeChargeWithApiKey(
      {
        apiKey: "sk_test_payments_123",
        chargeId: "ch_123",
      },
      chargeFetch,
    );

    expect(chargeResult).toMatchObject({
      ok: true,
      status: "charge",
      charge: {
        id: "ch_123",
        customerId: "cus_123",
        paymentIntentId: "pi_123",
      },
    });
  });

  it("lists charges with Stripe query filters", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        object: "list",
        data: [],
      }),
    );

    await listAlisioStripeChargesWithApiKey(
      {
        apiKey: "sk_test_charges_123",
        limit: 7,
        customer: "cus_123",
        paymentIntentId: "pi_123",
      },
      fetchMock,
    );

    const requestUrl = new URL(readFetchCallUrl(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.pathname).toBe("/v1/charges");
    expect(requestUrl.searchParams.get("limit")).toBe("7");
    expect(requestUrl.searchParams.get("customer")).toBe("cus_123");
    expect(requestUrl.searchParams.get("payment_intent")).toBe("pi_123");
  });

  it("lists products, prices, subscriptions, disputes, and refunds", async () => {
    const productsFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        object: "list",
        data: [
          {
            id: "prod_123",
            name: "Starter",
            active: true,
            default_price: { id: "price_123" },
          },
        ],
      }),
    );
    const productsResult = await listAlisioStripeProductsWithApiKey(
      {
        apiKey: "oauth_test_token_123",
        limit: 4,
      },
      productsFetch,
    );
    expect(productsResult).toMatchObject({
      ok: true,
      status: "products_listed",
      products: [{ id: "prod_123", defaultPriceId: "price_123" }],
    });

    const pricesFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        object: "list",
        data: [
          {
            id: "price_123",
            currency: "eur",
            unit_amount: 1900,
            product: {
              id: "prod_123",
              name: "Starter",
            },
            recurring: {
              interval: "month",
              usage_type: "licensed",
            },
          },
        ],
      }),
    );
    const pricesResult = await listAlisioStripePricesWithApiKey(
      {
        apiKey: "oauth_test_token_123",
        limit: 5,
        productId: "prod_123",
      },
      pricesFetch,
    );
    expect(pricesResult).toMatchObject({
      ok: true,
      status: "prices_listed",
      prices: [{ id: "price_123", productId: "prod_123", recurringInterval: "month" }],
    });

    const subscriptionsFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        object: "list",
        data: [
          {
            id: "sub_123",
            status: "active",
            customer: {
              id: "cus_123",
              email: "nuno@example.com",
            },
            collection_method: "charge_automatically",
            current_period_start: 1_713_200_000,
            current_period_end: 1_715_792_000,
          },
        ],
      }),
    );
    const subscriptionsResult = await listAlisioStripeSubscriptionsWithApiKey(
      {
        apiKey: "oauth_test_token_123",
        limit: 3,
        customer: "cus_123",
      },
      subscriptionsFetch,
    );
    expect(subscriptionsResult).toMatchObject({
      ok: true,
      status: "subscriptions_listed",
      subscriptions: [{ id: "sub_123", customerId: "cus_123", status: "active" }],
    });

    const disputesFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        object: "list",
        data: [
          {
            id: "dp_123",
            amount: 3200,
            currency: "eur",
            status: "needs_response",
            charge: {
              id: "ch_123",
              payment_intent: { id: "pi_123" },
            },
          },
        ],
      }),
    );
    const disputesResult = await listAlisioStripeDisputesWithApiKey(
      {
        apiKey: "oauth_test_token_123",
        limit: 2,
      },
      disputesFetch,
    );
    expect(disputesResult).toMatchObject({
      ok: true,
      status: "disputes_listed",
      disputes: [{ id: "dp_123", chargeId: "ch_123", paymentIntentId: "pi_123" }],
    });

    const refundsFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        object: "list",
        data: [
          {
            id: "re_123",
            amount: 3200,
            currency: "eur",
            status: "succeeded",
            charge: {
              id: "ch_123",
              payment_intent: { id: "pi_123" },
            },
          },
        ],
      }),
    );
    const refundsResult = await listAlisioStripeRefundsWithApiKey(
      {
        apiKey: "oauth_test_token_123",
        limit: 2,
        chargeId: "ch_123",
      },
      refundsFetch,
    );
    expect(refundsResult).toMatchObject({
      ok: true,
      status: "refunds_listed",
      refunds: [{ id: "re_123", chargeId: "ch_123", paymentIntentId: "pi_123" }],
    });
  });

  it("reads individual products, prices, subscriptions, disputes, and refunds", async () => {
    await expect(
      readAlisioStripeProductWithApiKey(
        {
          apiKey: "oauth_test_token_123",
          productId: "prod_123",
        },
        vi.fn<typeof fetch>().mockResolvedValueOnce(
          jsonResponse({
            id: "prod_123",
            name: "Starter",
            default_price: "price_123",
          }),
        ),
      ),
    ).resolves.toMatchObject({
      ok: true,
      status: "product",
      product: { id: "prod_123", defaultPriceId: "price_123" },
    });

    await expect(
      readAlisioStripePriceWithApiKey(
        {
          apiKey: "oauth_test_token_123",
          priceId: "price_123",
        },
        vi.fn<typeof fetch>().mockResolvedValueOnce(
          jsonResponse({
            id: "price_123",
            currency: "eur",
            product: {
              id: "prod_123",
              name: "Starter",
            },
          }),
        ),
      ),
    ).resolves.toMatchObject({
      ok: true,
      status: "price",
      price: { id: "price_123", productId: "prod_123" },
    });

    await expect(
      readAlisioStripeSubscriptionWithApiKey(
        {
          apiKey: "oauth_test_token_123",
          subscriptionId: "sub_123",
        },
        vi.fn<typeof fetch>().mockResolvedValueOnce(
          jsonResponse({
            id: "sub_123",
            status: "canceled",
            customer: "cus_123",
          }),
        ),
      ),
    ).resolves.toMatchObject({
      ok: true,
      status: "subscription",
      subscription: { id: "sub_123", customerId: "cus_123", status: "canceled" },
    });

    await expect(
      readAlisioStripeDisputeWithApiKey(
        {
          apiKey: "oauth_test_token_123",
          disputeId: "dp_123",
        },
        vi.fn<typeof fetch>().mockResolvedValueOnce(
          jsonResponse({
            id: "dp_123",
            amount: 1200,
            currency: "eur",
            status: "won",
            charge: "ch_123",
          }),
        ),
      ),
    ).resolves.toMatchObject({
      ok: true,
      status: "dispute",
      dispute: { id: "dp_123", chargeId: "ch_123" },
    });

    await expect(
      readAlisioStripeRefundWithApiKey(
        {
          apiKey: "oauth_test_token_123",
          refundId: "re_123",
        },
        vi.fn<typeof fetch>().mockResolvedValueOnce(
          jsonResponse({
            id: "re_123",
            amount: 1200,
            currency: "eur",
            charge: "ch_123",
            payment_intent: "pi_123",
          }),
        ),
      ),
    ).resolves.toMatchObject({
      ok: true,
      status: "refund",
      refund: { id: "re_123", chargeId: "ch_123", paymentIntentId: "pi_123" },
    });
  });
});
