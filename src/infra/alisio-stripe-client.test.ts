import { describe, expect, it, vi } from "vitest";
import {
  listAlisioStripeChargesWithApiKey,
  listAlisioStripeCustomersWithApiKey,
  listAlisioStripePaymentIntentsWithApiKey,
  readAlisioStripeChargeWithApiKey,
  validateAlisioStripeApiKey,
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
  it("validates restricted keys against the Stripe v1 API endpoints", async () => {
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
      .mockResolvedValueOnce(jsonResponse({ object: "list", data: [] }));

    const result = await validateAlisioStripeApiKey(
      {
        apiKey: "rk_test_readonly_123",
      },
      fetchMock,
    );

    expect(result).toMatchObject({
      ok: true,
      mode: "test",
      keyKind: "restricted",
      connectedAccount: {
        label: "Stripe test mode",
        handle: "restricted key",
      },
    });
    expect(readFetchCallUrl(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.stripe.com/v1/balance",
    );
    expect(readFetchCallUrl(fetchMock.mock.calls[3]?.[0])).toContain("/v1/payment_intents?limit=1");
  });

  it("rejects publishable Stripe keys", async () => {
    await expect(
      validateAlisioStripeApiKey({
        apiKey: "pk_test_browser_only",
      }),
    ).resolves.toMatchObject({
      ok: false,
      message: "Enter a Stripe secret or restricted API key. Publishable keys are not supported.",
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

    const result = await validateAlisioStripeApiKey(
      {
        apiKey: "rk_live_missing_permissions",
      },
      fetchMock,
    );

    expect(result).toMatchObject({
      ok: false,
      reconnectRequired: true,
      missingPermissions: ["customers", "charges", "payment intents"],
    });
    expect(result.ok ? null : result.message).toBe(
      "Stripe key needs read access to customers, charges, and payment intents.",
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
});
