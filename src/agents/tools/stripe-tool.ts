import { Type } from "@sinclair/typebox";
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
  readAlisioStripeCustomer,
  readAlisioStripeDispute,
  readAlisioStripePaymentIntent,
  readAlisioStripePrice,
  readAlisioStripeProduct,
  readAlisioStripeRefund,
  readAlisioStripeSubscription,
} from "../../infra/alisio-stripe.js";
import {
  payloadTextResult,
  readNumberParam,
  readStringParam,
  type AnyAgentTool,
  ToolInputError,
} from "./common.js";

const StripeToolSchema = Type.Object({
  action: Type.String({
    description:
      'Action to run: "account", "list_customers", "customer", "list_payment_intents", "payment_intent", "list_charges", "charge", "list_products", "product", "list_prices", "price", "list_subscriptions", "subscription", "list_disputes", "dispute", "list_refunds", or "refund".',
  }),
  limit: Type.Optional(
    Type.Number({
      description:
        "Maximum items to return for list actions. Defaults to 20 and must stay between 1 and 100.",
    }),
  ),
  email: Type.Optional(
    Type.String({
      description: 'Optional customer email filter for action="list_customers".',
    }),
  ),
  customerId: Type.Optional(
    Type.String({
      description:
        'Customer id for action="customer", or a customer filter for "list_payment_intents" and "list_charges".',
    }),
  ),
  paymentIntentId: Type.Optional(
    Type.String({
      description:
        'Payment intent id for action="payment_intent", or a payment intent filter for "list_charges".',
    }),
  ),
  chargeId: Type.Optional(
    Type.String({
      description: 'Charge id for action="charge".',
    }),
  ),
  productId: Type.Optional(
    Type.String({
      description: 'Product id for action="product", or a product filter for action="list_prices".',
    }),
  ),
  priceId: Type.Optional(
    Type.String({
      description: 'Price id for action="price".',
    }),
  ),
  subscriptionId: Type.Optional(
    Type.String({
      description: 'Subscription id for action="subscription".',
    }),
  ),
  disputeId: Type.Optional(
    Type.String({
      description: 'Dispute id for action="dispute".',
    }),
  ),
  refundId: Type.Optional(
    Type.String({
      description: 'Refund id for action="refund".',
    }),
  ),
});

function readStripeLimit(params: Record<string, unknown>): number | undefined {
  const limit = readNumberParam(params, "limit", {
    integer: true,
    strict: true,
  });
  if (limit !== undefined && (limit <= 0 || limit > 100)) {
    throw new ToolInputError("limit must be between 1 and 100");
  }
  return limit;
}

export function createStripeTool(): AnyAgentTool {
  return {
    label: "Stripe",
    name: "stripe",
    ownerOnly: true,
    displaySummary:
      "Inspect Stripe balance, customers, subscriptions, products, prices, charges, refunds, disputes, and payment intents through the connected Stripe app.",
    description:
      "Inspect Stripe balance, customers, subscriptions, products, prices, charges, refunds, disputes, and payment intents through the connected Stripe app. Prefer this over browser automation for Stripe operations.",
    parameters: StripeToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      if (action === "account") {
        return payloadTextResult(await getAlisioStripeAccount());
      }
      if (action === "list_customers") {
        const limit = readStripeLimit(params);
        const email = readStringParam(params, "email");
        return payloadTextResult(
          await listAlisioStripeCustomers({
            ...(limit !== undefined ? { limit } : {}),
            ...(email ? { email } : {}),
          }),
        );
      }
      if (action === "customer") {
        const customerId = readStringParam(params, "customerId", {
          required: true,
          label: "customerId",
        });
        return payloadTextResult(await readAlisioStripeCustomer({ customerId }));
      }
      if (action === "list_payment_intents") {
        const limit = readStripeLimit(params);
        const customer = readStringParam(params, "customerId");
        return payloadTextResult(
          await listAlisioStripePaymentIntents({
            ...(limit !== undefined ? { limit } : {}),
            ...(customer ? { customer } : {}),
          }),
        );
      }
      if (action === "payment_intent") {
        const paymentIntentId = readStringParam(params, "paymentIntentId", {
          required: true,
          label: "paymentIntentId",
        });
        return payloadTextResult(await readAlisioStripePaymentIntent({ paymentIntentId }));
      }
      if (action === "list_charges") {
        const limit = readStripeLimit(params);
        const customer = readStringParam(params, "customerId");
        const paymentIntentId = readStringParam(params, "paymentIntentId");
        return payloadTextResult(
          await listAlisioStripeCharges({
            ...(limit !== undefined ? { limit } : {}),
            ...(customer ? { customer } : {}),
            ...(paymentIntentId ? { paymentIntentId } : {}),
          }),
        );
      }
      if (action === "charge") {
        const chargeId = readStringParam(params, "chargeId", {
          required: true,
          label: "chargeId",
        });
        return payloadTextResult(await readAlisioStripeCharge({ chargeId }));
      }
      if (action === "list_products") {
        const limit = readStripeLimit(params);
        return payloadTextResult(
          await listAlisioStripeProducts(limit !== undefined ? { limit } : {}),
        );
      }
      if (action === "product") {
        const productId = readStringParam(params, "productId", {
          required: true,
          label: "productId",
        });
        return payloadTextResult(await readAlisioStripeProduct({ productId }));
      }
      if (action === "list_prices") {
        const limit = readStripeLimit(params);
        const productId = readStringParam(params, "productId");
        return payloadTextResult(
          await listAlisioStripePrices({
            ...(limit !== undefined ? { limit } : {}),
            ...(productId ? { productId } : {}),
          }),
        );
      }
      if (action === "price") {
        const priceId = readStringParam(params, "priceId", {
          required: true,
          label: "priceId",
        });
        return payloadTextResult(await readAlisioStripePrice({ priceId }));
      }
      if (action === "list_subscriptions") {
        const limit = readStripeLimit(params);
        const customer = readStringParam(params, "customerId");
        return payloadTextResult(
          await listAlisioStripeSubscriptions({
            ...(limit !== undefined ? { limit } : {}),
            ...(customer ? { customer } : {}),
          }),
        );
      }
      if (action === "subscription") {
        const subscriptionId = readStringParam(params, "subscriptionId", {
          required: true,
          label: "subscriptionId",
        });
        return payloadTextResult(await readAlisioStripeSubscription({ subscriptionId }));
      }
      if (action === "list_disputes") {
        const limit = readStripeLimit(params);
        return payloadTextResult(
          await listAlisioStripeDisputes(limit !== undefined ? { limit } : {}),
        );
      }
      if (action === "dispute") {
        const disputeId = readStringParam(params, "disputeId", {
          required: true,
          label: "disputeId",
        });
        return payloadTextResult(await readAlisioStripeDispute({ disputeId }));
      }
      if (action === "list_refunds") {
        const limit = readStripeLimit(params);
        const chargeId = readStringParam(params, "chargeId");
        const paymentIntentId = readStringParam(params, "paymentIntentId");
        return payloadTextResult(
          await listAlisioStripeRefunds({
            ...(limit !== undefined ? { limit } : {}),
            ...(chargeId ? { chargeId } : {}),
            ...(paymentIntentId ? { paymentIntentId } : {}),
          }),
        );
      }
      if (action === "refund") {
        const refundId = readStringParam(params, "refundId", {
          required: true,
          label: "refundId",
        });
        return payloadTextResult(await readAlisioStripeRefund({ refundId }));
      }
      throw new ToolInputError(
        'action must be "account", "list_customers", "customer", "list_payment_intents", "payment_intent", "list_charges", "charge", "list_products", "product", "list_prices", "price", "list_subscriptions", "subscription", "list_disputes", "dispute", "list_refunds", or "refund"',
      );
    },
  };
}
