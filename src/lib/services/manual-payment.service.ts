/**
 * Manual Payment Service
 *
 * Records payments an organization received outside the online checkout
 * (cash, bank transfer, MonCash/Natcash, check) and applies their effects:
 * crediting a customer's prepaid balance, or (Phase 4) settling an order.
 *
 * ManualPayment records are immutable — they are never edited or deleted.
 * The only reversal is voiding, which writes void fields on the record and
 * a compensating entry wherever the payment had an effect.
 */

import {
  Customer,
  CustomerBalanceHistory,
  ManualPayment,
  Transaction,
  type ICustomer,
  type IManualPayment,
} from "@topupsend/db";
import { ApiErrors } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import type { CreateManualPaymentInput } from "@/lib/validations/manual-payment";

export interface RecordBalancePaymentParams {
  orgId: string;
  recordedBy: string;
  input: CreateManualPaymentInput;
}

export interface RecordBalancePaymentResult {
  manualPayment: IManualPayment;
  customer: ICustomer;
}

/**
 * Record a manual payment and credit it to a customer's prepaid balance.
 * The credit is journaled in CustomerBalanceHistory with type "payment"
 * (money the customer paid — distinct from admin-assigned credit).
 */
export async function recordBalanceManualPayment(
  params: RecordBalancePaymentParams,
): Promise<RecordBalancePaymentResult> {
  const { orgId, recordedBy, input } = params;

  const customer = await Customer.findById(input.customerId);

  if (!customer) {
    throw ApiErrors.NotFound("Customer not found");
  }

  // Verify customer belongs to the recorder's org
  if (customer.orgId !== orgId) {
    throw ApiErrors.Forbidden("Access denied");
  }

  // Currency must match the customer's balance currency — there is no FX
  // conversion anywhere in the platform, so a mismatch is rejected.
  const currency = input.currency ?? customer.balanceCurrency;
  if (currency !== customer.balanceCurrency) {
    throw ApiErrors.BadRequest(
      `Currency mismatch: customer balance is in ${customer.balanceCurrency}, payment is in ${currency}`,
    );
  }

  const manualPayment = await ManualPayment.create({
    orgId,
    customerId: customer._id?.toString(),
    amount: input.amount,
    currency,
    method: input.method,
    reference: input.reference,
    proofReference: input.proofReference,
    notes: input.notes,
    receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
    appliedTo: "customer_balance",
    status: "recorded",
    createdBy: recordedBy,
  });

  try {
    await customer.addBalance(
      input.amount,
      `Manual payment received via ${input.method}`,
      {
        adminId: recordedBy,
        manualPaymentId: manualPayment._id?.toString(),
        method: input.method,
        reference: input.reference,
        notes: input.notes,
      },
      "payment",
    );
  } catch (error) {
    // The credit failed after the record was created. Never delete the
    // record — void it so the audit trail shows what happened.
    manualPayment.status = "voided";
    manualPayment.voidedBy = recordedBy;
    manualPayment.voidedAt = new Date();
    manualPayment.voidReason = `Application failed: ${
      error instanceof Error ? error.message : "Unknown error"
    }`;
    await manualPayment.save();
    throw error;
  }

  logger.info("Manual payment recorded (customer balance)", {
    orgId,
    userId: recordedBy,
    manualPaymentId: manualPayment._id?.toString(),
    customerId: customer._id?.toString(),
    amount: input.amount,
    currency,
    method: input.method,
  });

  return { manualPayment, customer };
}

export interface ListManualPaymentsParams {
  orgId: string;
  customerId?: string;
  method?: string;
  status?: string;
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
}

export interface ListManualPaymentsResult {
  payments: IManualPayment[];
  total: number;
}

/** Org-scoped, filterable list of manual payments (newest first). */
export async function listManualPayments(
  params: ListManualPaymentsParams,
): Promise<ListManualPaymentsResult> {
  const query: Record<string, unknown> = { orgId: params.orgId };
  if (params.customerId) query.customerId = params.customerId;
  if (params.method) query.method = params.method;
  if (params.status) query.status = params.status;
  if (params.from || params.to) {
    const createdAt: Record<string, Date> = {};
    if (params.from) createdAt.$gte = params.from;
    if (params.to) createdAt.$lte = params.to;
    query.createdAt = createdAt;
  }

  const skip = (params.page - 1) * params.limit;

  const [payments, total] = await Promise.all([
    ManualPayment.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(params.limit)
      .lean(),
    ManualPayment.countDocuments(query),
  ]);

  return { payments: payments as unknown as IManualPayment[], total };
}

export interface VoidManualPaymentParams {
  orgId: string;
  voidedBy: string;
  manualPaymentId: string;
  reason: string;
}

/**
 * Void a manual payment (admin only — enforced at the route).
 *
 * Reversal rules:
 * - Balance-applied: the credit is debited back only if the customer's
 *   current balance still covers it; if it was already spent, the void is
 *   refused (the org must resolve it with the customer).
 * - Order-applied: refused once fulfillment completed (use the refund
 *   flow) or once the payment was refunded; otherwise the order is
 *   returned to "pending" and its manual payment fields are cleared.
 */
export async function voidManualPayment(
  params: VoidManualPaymentParams,
): Promise<IManualPayment> {
  const { orgId, voidedBy, manualPaymentId, reason } = params;

  const manualPayment = await ManualPayment.findOne({
    _id: manualPaymentId,
    orgId,
  });

  if (!manualPayment) {
    throw ApiErrors.NotFound("Manual payment not found");
  }

  if (manualPayment.status === "voided") {
    throw ApiErrors.BadRequest("Manual payment is already voided");
  }

  if (manualPayment.appliedTo === "customer_balance") {
    await reverseBalanceCredit(manualPayment, voidedBy, reason);
  } else {
    await reverseOrderApplication(manualPayment, voidedBy, reason);
  }

  manualPayment.status = "voided";
  manualPayment.voidedBy = voidedBy;
  manualPayment.voidedAt = new Date();
  manualPayment.voidReason = reason;
  await manualPayment.save();

  logger.info("Manual payment voided", {
    orgId,
    userId: voidedBy,
    manualPaymentId: manualPayment._id?.toString(),
    appliedTo: manualPayment.appliedTo,
    amount: manualPayment.amount,
    reason,
  });

  return manualPayment;
}

async function reverseBalanceCredit(
  manualPayment: IManualPayment,
  voidedBy: string,
  reason: string,
): Promise<void> {
  const customer = await Customer.findById(manualPayment.customerId);

  if (!customer) {
    throw ApiErrors.NotFound("Customer not found for this payment");
  }

  if (customer.orgId !== manualPayment.orgId) {
    throw ApiErrors.Forbidden("Access denied");
  }

  // The credit can only be reversed while it is still sitting in the
  // customer's balance. Once spent, refuse — mirroring how balance
  // adjustments refuse to drive a balance negative.
  if (customer.currentBalance < manualPayment.amount) {
    throw ApiErrors.BadRequest(
      "Cannot void: the credited balance has already been spent. Resolve it with the customer or use a balance adjustment.",
    );
  }

  const previousBalance = customer.currentBalance;
  customer.currentBalance -= manualPayment.amount;
  customer.totalAssigned = Math.max(
    0,
    customer.totalAssigned - manualPayment.amount,
  );
  await customer.save();

  await CustomerBalanceHistory.create({
    customerId: customer._id,
    orgId: manualPayment.orgId,
    amount: -manualPayment.amount,
    type: "payment",
    previousBalance,
    newBalance: customer.currentBalance,
    description: `Manual payment voided (${manualPayment.method}): ${reason}`,
    metadata: {
      adminId: voidedBy,
      manualPaymentId: manualPayment._id?.toString(),
      method: manualPayment.method,
      reference: manualPayment.reference,
      notes: reason,
    },
  });
}

async function reverseOrderApplication(
  manualPayment: IManualPayment,
  voidedBy: string,
  reason: string,
): Promise<void> {
  if (!manualPayment.transactionId) {
    return; // Nothing was applied to an order
  }

  const transaction = await Transaction.findOne({
    _id: manualPayment.transactionId,
    orgId: manualPayment.orgId,
  });

  if (!transaction) {
    return; // Order no longer exists; voiding the record is enough
  }

  // Once the top-up has been delivered, the payment cannot be voided —
  // the refund flow is the correct tool.
  if (transaction.status === "completed") {
    throw ApiErrors.BadRequest(
      "Cannot void: the order has already been fulfilled. Use the refund flow instead.",
    );
  }

  if (transaction.status === "processing") {
    throw ApiErrors.BadRequest(
      "Cannot void: fulfillment is in progress for this order. Try again once it settles.",
    );
  }

  // If the payment was already refunded (e.g. fulfillment failed and the
  // amount went back to the customer's balance), voiding would reverse
  // the money twice.
  if (transaction.status === "refunded" || transaction.timeline.refundedAt) {
    throw ApiErrors.BadRequest(
      "Cannot void: this payment was already refunded to the customer's balance.",
    );
  }

  // Only reverse the order if THIS payment is the one that paid it.
  if (transaction.paymentId !== manualPayment._id?.toString()) {
    return;
  }

  transaction.status = "pending";
  transaction.paymentGateway = undefined;
  transaction.paymentId = undefined;
  transaction.timeline.paidAt = undefined;
  (transaction.metadata as Record<string, unknown>).manualPaymentVoided = {
    manualPaymentId: manualPayment._id?.toString(),
    reason,
    voidedBy,
    voidedAt: new Date(),
  };
  await transaction.save();
}
