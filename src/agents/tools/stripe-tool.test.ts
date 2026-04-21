import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAlisioStripeAccountMock,
  listAlisioStripeChargesMock,
  listAlisioStripeCustomersMock,
  listAlisioStripeDisputesMock,
  listAlisioStripePaymentIntentsMock,
  listAlisioStripePricesMock,
  listAlisioStripeProductsMock,
  listAlisioStripeRefundsMock,
  listAlisioStripeSubscriptionsMock,
  readAlisioStripeChargeMock,
  readAlisioStripeCustomerMock,
  readAlisioStripeDisputeMock,
  readAlisioStripePaymentIntentMock,
  readAlisioStripePriceMock,
  readAlisioStripeProductMock,
  readAlisioStripeRefundMock,
  readAlisioStripeSubscriptionMock,
} = vi.hoisted(() => ({
  getAlisioStripeAccountMock: vi.fn(),
  listAlisioStripeChargesMock: vi.fn(),
  listAlisioStripeCustomersMock: vi.fn(),
  listAlisioStripeDisputesMock: vi.fn(),
  listAlisioStripePaymentIntentsMock: vi.fn(),
  listAlisioStripePricesMock: vi.fn(),
  listAlisioStripeProductsMock: vi.fn(),
  listAlisioStripeRefundsMock: vi.fn(),
  listAlisioStripeSubscriptionsMock: vi.fn(),
  readAlisioStripeChargeMock: vi.fn(),
  readAlisioStripeCustomerMock: vi.fn(),
  readAlisioStripeDisputeMock: vi.fn(),
  readAlisioStripePaymentIntentMock: vi.fn(),
  readAlisioStripePriceMock: vi.fn(),
  readAlisioStripeProductMock: vi.fn(),
  readAlisioStripeRefundMock: vi.fn(),
  readAlisioStripeSubscriptionMock: vi.fn(),
}));

vi.mock("../../infra/alisio-stripe.js", () => ({
  getAlisioStripeAccount: getAlisioStripeAccountMock,
  listAlisioStripeCharges: listAlisioStripeChargesMock,
  listAlisioStripeCustomers: listAlisioStripeCustomersMock,
  listAlisioStripeDisputes: listAlisioStripeDisputesMock,
  listAlisioStripePaymentIntents: listAlisioStripePaymentIntentsMock,
  listAlisioStripePrices: listAlisioStripePricesMock,
  listAlisioStripeProducts: listAlisioStripeProductsMock,
  listAlisioStripeRefunds: listAlisioStripeRefundsMock,
  listAlisioStripeSubscriptions: listAlisioStripeSubscriptionsMock,
  readAlisioStripeCharge: readAlisioStripeChargeMock,
  readAlisioStripeCustomer: readAlisioStripeCustomerMock,
  readAlisioStripeDispute: readAlisioStripeDisputeMock,
  readAlisioStripePaymentIntent: readAlisioStripePaymentIntentMock,
  readAlisioStripePrice: readAlisioStripePriceMock,
  readAlisioStripeProduct: readAlisioStripeProductMock,
  readAlisioStripeRefund: readAlisioStripeRefundMock,
  readAlisioStripeSubscription: readAlisioStripeSubscriptionMock,
}));

describe("createStripeTool", () => {
  beforeEach(() => {
    vi.resetModules();
    getAlisioStripeAccountMock.mockReset();
    listAlisioStripeChargesMock.mockReset();
    listAlisioStripeCustomersMock.mockReset();
    listAlisioStripeDisputesMock.mockReset();
    listAlisioStripePaymentIntentsMock.mockReset();
    listAlisioStripePricesMock.mockReset();
    listAlisioStripeProductsMock.mockReset();
    listAlisioStripeRefundsMock.mockReset();
    listAlisioStripeSubscriptionsMock.mockReset();
    readAlisioStripeChargeMock.mockReset();
    readAlisioStripeCustomerMock.mockReset();
    readAlisioStripeDisputeMock.mockReset();
    readAlisioStripePaymentIntentMock.mockReset();
    readAlisioStripePriceMock.mockReset();
    readAlisioStripeProductMock.mockReset();
    readAlisioStripeRefundMock.mockReset();
    readAlisioStripeSubscriptionMock.mockReset();
  });

  it("reads the Stripe account summary", async () => {
    const { createStripeTool } = await import("./stripe-tool.js");
    getAlisioStripeAccountMock.mockResolvedValue({
      ok: true,
      status: "account",
      connectorId: "stripe",
      account: {
        livemode: false,
        mode: "test",
        accessKind: "restricted",
        keyKind: "restricted",
        available: [],
        pending: [],
      },
    });

    const result = await createStripeTool().execute?.("tool-1", {
      action: "account",
    });

    expect(getAlisioStripeAccountMock).toHaveBeenCalledWith();
    expect(result?.details).toMatchObject({
      status: "account",
      connectorId: "stripe",
    });
  });

  it("lists Stripe customers with optional filters", async () => {
    const { createStripeTool } = await import("./stripe-tool.js");
    listAlisioStripeCustomersMock.mockResolvedValue({
      ok: true,
      status: "customers_listed",
      connectorId: "stripe",
      customers: [],
    });

    const result = await createStripeTool().execute?.("tool-1", {
      action: "list_customers",
      limit: 5,
      email: "nuno@example.com",
    });

    expect(listAlisioStripeCustomersMock).toHaveBeenCalledWith({
      limit: 5,
      email: "nuno@example.com",
    });
    expect(result?.details).toMatchObject({
      status: "customers_listed",
      connectorId: "stripe",
    });
  });

  it("reads individual Stripe payment entities", async () => {
    const { createStripeTool } = await import("./stripe-tool.js");
    readAlisioStripePaymentIntentMock.mockResolvedValue({
      ok: true,
      status: "payment_intent",
      connectorId: "stripe",
      paymentIntent: {
        id: "pi_123",
        amount: 3200,
        currency: "eur",
        status: "succeeded",
      },
    });
    readAlisioStripeChargeMock.mockResolvedValue({
      ok: true,
      status: "charge",
      connectorId: "stripe",
      charge: {
        id: "ch_123",
        amount: 3200,
        currency: "eur",
        paid: true,
        refunded: false,
      },
    });

    await createStripeTool().execute?.("tool-1", {
      action: "payment_intent",
      paymentIntentId: "pi_123",
    });
    const chargeResult = await createStripeTool().execute?.("tool-1", {
      action: "charge",
      chargeId: "ch_123",
    });

    expect(readAlisioStripePaymentIntentMock).toHaveBeenCalledWith({
      paymentIntentId: "pi_123",
    });
    expect(readAlisioStripeChargeMock).toHaveBeenCalledWith({
      chargeId: "ch_123",
    });
    expect(chargeResult?.details).toMatchObject({
      status: "charge",
      connectorId: "stripe",
    });
  });

  it("lists Stripe catalog and billing entities", async () => {
    const { createStripeTool } = await import("./stripe-tool.js");
    listAlisioStripeProductsMock.mockResolvedValue({
      ok: true,
      status: "products_listed",
      connectorId: "stripe",
      products: [],
    });
    listAlisioStripePricesMock.mockResolvedValue({
      ok: true,
      status: "prices_listed",
      connectorId: "stripe",
      prices: [],
    });
    listAlisioStripeSubscriptionsMock.mockResolvedValue({
      ok: true,
      status: "subscriptions_listed",
      connectorId: "stripe",
      subscriptions: [],
    });
    listAlisioStripeDisputesMock.mockResolvedValue({
      ok: true,
      status: "disputes_listed",
      connectorId: "stripe",
      disputes: [],
    });
    listAlisioStripeRefundsMock.mockResolvedValue({
      ok: true,
      status: "refunds_listed",
      connectorId: "stripe",
      refunds: [],
    });

    await createStripeTool().execute?.("tool-1", {
      action: "list_products",
      limit: 4,
    });
    await createStripeTool().execute?.("tool-1", {
      action: "list_prices",
      limit: 6,
      productId: "prod_123",
    });
    await createStripeTool().execute?.("tool-1", {
      action: "list_subscriptions",
      limit: 8,
      customerId: "cus_123",
    });
    await createStripeTool().execute?.("tool-1", {
      action: "list_disputes",
      limit: 2,
    });
    const refundsResult = await createStripeTool().execute?.("tool-1", {
      action: "list_refunds",
      limit: 3,
      chargeId: "ch_123",
    });

    expect(listAlisioStripeProductsMock).toHaveBeenCalledWith({ limit: 4 });
    expect(listAlisioStripePricesMock).toHaveBeenCalledWith({
      limit: 6,
      productId: "prod_123",
    });
    expect(listAlisioStripeSubscriptionsMock).toHaveBeenCalledWith({
      limit: 8,
      customer: "cus_123",
    });
    expect(listAlisioStripeDisputesMock).toHaveBeenCalledWith({ limit: 2 });
    expect(listAlisioStripeRefundsMock).toHaveBeenCalledWith({
      limit: 3,
      chargeId: "ch_123",
    });
    expect(refundsResult?.details).toMatchObject({
      status: "refunds_listed",
      connectorId: "stripe",
    });
  });

  it("reads individual Stripe catalog and billing entities", async () => {
    const { createStripeTool } = await import("./stripe-tool.js");
    readAlisioStripeProductMock.mockResolvedValue({
      ok: true,
      status: "product",
      connectorId: "stripe",
      product: { id: "prod_123", name: "Starter" },
    });
    readAlisioStripePriceMock.mockResolvedValue({
      ok: true,
      status: "price",
      connectorId: "stripe",
      price: { id: "price_123", currency: "eur" },
    });
    readAlisioStripeSubscriptionMock.mockResolvedValue({
      ok: true,
      status: "subscription",
      connectorId: "stripe",
      subscription: { id: "sub_123", status: "active" },
    });
    readAlisioStripeDisputeMock.mockResolvedValue({
      ok: true,
      status: "dispute",
      connectorId: "stripe",
      dispute: { id: "dp_123", amount: 2500, currency: "eur", status: "needs_response" },
    });
    readAlisioStripeRefundMock.mockResolvedValue({
      ok: true,
      status: "refund",
      connectorId: "stripe",
      refund: { id: "re_123", amount: 2500, currency: "eur" },
    });

    await createStripeTool().execute?.("tool-1", {
      action: "product",
      productId: "prod_123",
    });
    await createStripeTool().execute?.("tool-1", {
      action: "price",
      priceId: "price_123",
    });
    await createStripeTool().execute?.("tool-1", {
      action: "subscription",
      subscriptionId: "sub_123",
    });
    await createStripeTool().execute?.("tool-1", {
      action: "dispute",
      disputeId: "dp_123",
    });
    const refundResult = await createStripeTool().execute?.("tool-1", {
      action: "refund",
      refundId: "re_123",
    });

    expect(readAlisioStripeProductMock).toHaveBeenCalledWith({ productId: "prod_123" });
    expect(readAlisioStripePriceMock).toHaveBeenCalledWith({ priceId: "price_123" });
    expect(readAlisioStripeSubscriptionMock).toHaveBeenCalledWith({
      subscriptionId: "sub_123",
    });
    expect(readAlisioStripeDisputeMock).toHaveBeenCalledWith({ disputeId: "dp_123" });
    expect(readAlisioStripeRefundMock).toHaveBeenCalledWith({ refundId: "re_123" });
    expect(refundResult?.details).toMatchObject({
      status: "refund",
      connectorId: "stripe",
    });
  });

  it("rejects invalid Stripe list limits", async () => {
    const { createStripeTool } = await import("./stripe-tool.js");

    await expect(
      createStripeTool().execute?.("tool-1", {
        action: "list_charges",
        limit: 101,
      }),
    ).rejects.toThrow("limit must be between 1 and 100");
  });
});
