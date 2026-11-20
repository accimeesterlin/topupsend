/**
 * Shared response shapes for the partner API
 * (src/app/api/v1/partner/*).
 *
 * The send response mirrors the customer send's transaction shape
 * (POST /api/v1/customer-transactions) plus `currency` and
 * `isTestMode`; the status response is the flat shape documented
 * for GET /api/v1/partner/topups/[orderId].
 */

import type { ITransaction } from "@topupsend/db";

/** transferId as exposed to partners: the numeric DingConnect id when known. */
export function partnerTransferId(
  transaction: ITransaction,
): string | number | null {
  const dingTransferId = (
    transaction.metadata as Record<string, unknown> | undefined
  )?.dingTransferId;
  if (typeof dingTransferId === "number" || typeof dingTransferId === "string") {
    return dingTransferId;
  }
  return transaction.providerTransactionId ?? null;
}

/** Transaction shape returned by POST /api/v1/partner/topups. */
export function partnerSendTransactionView(transaction: ITransaction) {
  return {
    id: String(transaction._id),
    orderId: transaction.orderId,
    amount: transaction.amount,
    currency: transaction.currency,
    status: transaction.status,
    recipientPhone: transaction.recipient?.phoneNumber,
    transferId: partnerTransferId(transaction),
    isTestMode: Boolean(transaction.isTestMode),
  };
}

/** Flat shape returned by GET /api/v1/partner/topups/[orderId]. */
export function partnerTopupStatusView(transaction: ITransaction) {
  return {
    orderId: transaction.orderId,
    status: transaction.status,
    transferId: partnerTransferId(transaction),
    amount: transaction.amount,
    currency: transaction.currency,
    recipientPhone: transaction.recipient?.phoneNumber,
    failureReason: transaction.metadata?.failureReason ?? null,
    isTestMode: Boolean(transaction.isTestMode),
  };
}
