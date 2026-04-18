import { Type } from "@sinclair/typebox";
import {
  getAlisioStripeAccount,
  listAlisioStripeCharges,
  listAlisioStripeCustomers,
  listAlisioStripePaymentIntents,
  readAlisioStripeCharge,
  readAlisioStripeCustomer,
  readAlisioStripePaymentIntent,
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
      'Action to run: "account", "list_customers", "customer", "list_payment_intents", "payment_intent", "list_charges", or "charge".',
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
      "Inspect Stripe balance, customers, payment intents, and charges through the connected Stripe app.",
    description:
      "Inspect Stripe balance, customers, payment intents, and charges through the connected Stripe app. Prefer this over browser automation for Stripe operations.",
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
      throw new ToolInputError(
        'action must be "account", "list_customers", "customer", "list_payment_intents", "payment_intent", "list_charges", or "charge"',
      );
    },
  };
}
