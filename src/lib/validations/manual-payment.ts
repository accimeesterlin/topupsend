import { z } from "zod";

/**
 * Validation rules for manual (offline) payments recorded by org staff.
 * These mirror the ManualPayment model validators — the API layer rejects
 * bad input with a 400 before anything reaches the database.
 */

export const MANUAL_PAYMENT_METHODS = [
  "cash",
  "bank_transfer",
  "moncash",
  "natcash",
  "check",
  "other",
] as const;

/** Money amounts: strictly positive, at most 2 decimal places. */
export const manualPaymentAmountSchema = z
  .number()
  .positive("Amount must be greater than 0")
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9,
    "Amount must have at most 2 decimal places",
  );

export const createManualPaymentSchema = z
  .object({
    appliedTo: z.enum(["order", "customer_balance"]),
    customerId: z.string().min(1).optional(),
    transactionId: z.string().min(1).optional(),
    amount: manualPaymentAmountSchema,
    currency: z.string().min(1).optional(),
    method: z.enum(MANUAL_PAYMENT_METHODS),
    reference: z.string().trim().min(1).optional(),
    proofReference: z.string().trim().min(1).optional(),
    notes: z.string().max(1000).optional(),
    receivedAt: z.string().datetime().optional(),
  })
  .superRefine((data, ctx) => {
    // A reference is required for every method except cash, so an
    // electronic payment can always be traced to the provider record.
    if (data.method !== "cash" && !data.reference) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reference"],
        message: "Reference is required for non-cash payments",
      });
    }

    if (data.appliedTo === "customer_balance" && !data.customerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customerId"],
        message: "customerId is required when applying a payment to a balance",
      });
    }

    if (data.appliedTo === "order" && !data.transactionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["transactionId"],
        message: "transactionId is required when applying a payment to an order",
      });
    }
  });

export type CreateManualPaymentInput = z.infer<typeof createManualPaymentSchema>;

export const voidManualPaymentSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "A reason is required to void a manual payment")
    .max(500, "Reason must be less than 500 characters"),
});

export type VoidManualPaymentInput = z.infer<typeof voidManualPaymentSchema>;
