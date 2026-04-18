import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAlisioStripeAccountMock,
  listAlisioStripeChargesMock,
  listAlisioStripeCustomersMock,
  listAlisioStripePaymentIntentsMock,
  readAlisioStripeChargeMock,
  readAlisioStripeCustomerMock,
  readAlisioStripePaymentIntentMock,
} = vi.hoisted(() => ({
  getAlisioStripeAccountMock: vi.fn(),
  listAlisioStripeChargesMock: vi.fn(),
  listAlisioStripeCustomersMock: vi.fn(),
  listAlisioStripePaymentIntentsMock: vi.fn(),
  readAlisioStripeChargeMock: vi.fn(),
  readAlisioStripeCustomerMock: vi.fn(),
  readAlisioStripePaymentIntentMock: vi.fn(),
}));

vi.mock("../../infra/alisio-stripe.js", () => ({
  getAlisioStripeAccount: getAlisioStripeAccountMock,
  listAlisioStripeCharges: listAlisioStripeChargesMock,
  listAlisioStripeCustomers: listAlisioStripeCustomersMock,
  listAlisioStripePaymentIntents: listAlisioStripePaymentIntentsMock,
  readAlisioStripeCharge: readAlisioStripeChargeMock,
  readAlisioStripeCustomer: readAlisioStripeCustomerMock,
  readAlisioStripePaymentIntent: readAlisioStripePaymentIntentMock,
}));

describe("createStripeTool", () => {
  beforeEach(() => {
    vi.resetModules();
    getAlisioStripeAccountMock.mockReset();
    listAlisioStripeChargesMock.mockReset();
    listAlisioStripeCustomersMock.mockReset();
    listAlisioStripePaymentIntentsMock.mockReset();
    readAlisioStripeChargeMock.mockReset();
    readAlisioStripeCustomerMock.mockReset();
    readAlisioStripePaymentIntentMock.mockReset();
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
