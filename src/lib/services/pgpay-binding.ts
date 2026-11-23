/**
 * PGPay confirmation binding (Cluster 1b — F-C2, F-C3, F-C4).
 *
 * A payment confirmation is only valid for the record it was created
 * for: the verified token must equal the token stored server-side when
 * the payment was created, and the verified amount must equal the
 * amount stored server-side at that same moment. Neither the request
 * body's status, nor payment metadata, nor a token that merely
 * verifies as "completed" somewhere is ever sufficient.
 */

import { createHash } from "crypto";
import type { PGPayVerificationResponse } from "@/lib/services/pgpay.service";

export interface BindingResult {
  ok: boolean;
  reason?: string;
}

/** Compare money amounts at cent precision (float-safe). */
export function amountsEqual(
  a: number | undefined | null,
  b: number | undefined | null,
): boolean {
  if (typeof a !== "number" || typeof b !== "number") return false;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.round(a * 100) === Math.round(b * 100);
}

/**
 * Whether a PGPay verification result represents a completed payment.
 * Derived ONLY from the server-to-server verification response —
 * never from a webhook/verify request body.
 */
export function isVerificationCompleted(
  verification: Pick<PGPayVerificationResponse, "status" | "paymentStatus">,
): boolean {
  const status = String(verification.status || "").toLowerCase();
  const paymentStatus = String(verification.paymentStatus || "").toLowerCase();

  const statusCompleted =
    status === "completed" ||
    status === "success" ||
    status === "succeeded" ||
    status === "paid";
  const paymentPaid =
    paymentStatus === "paid" ||
    paymentStatus === "success" ||
    paymentStatus === "succeeded" ||
    paymentStatus === "completed";

  return statusCompleted || paymentPaid;
}

/**
 * Bind a verification to a stored transaction: the presented token
 * must be the token stored on the transaction when its PGPay session
 * was created, and the verified amount must equal the order amount.
 */
export function checkTransactionBinding(params: {
  transaction: {
    amount: number;
    metadata?: { pgpayToken?: string } | Record<string, unknown>;
  };
  pgPayToken?: string;
  verification: Pick<PGPayVerificationResponse, "amount">;
}): BindingResult {
  const { transaction, pgPayToken, verification } = params;
  const storedToken = (
    transaction.metadata as Record<string, unknown> | undefined
  )?.pgpayToken as string | undefined;

  if (!storedToken) {
    return { ok: false, reason: "Transaction has no stored PGPay token" };
  }
  if (!pgPayToken || pgPayToken !== storedToken) {
    return {
      ok: false,
      reason: "Presented token does not match the transaction's PGPay token",
    };
  }
  if (!amountsEqual(verification.amount, transaction.amount)) {
    return {
      ok: false,
      reason: `Verified amount (${verification.amount}) does not equal order amount (${transaction.amount})`,
    };
  }
  return { ok: true };
}

/**
 * Bind a verification to an organization's pending subscription
 * upgrade: the presented token must be the pending upgrade's token,
 * and the verified amount must equal the server-derived amount stored
 * on the pending upgrade when the payment was created.
 */
export function checkSubscriptionBinding(params: {
  organization: {
    subscription?: {
      pendingUpgrade?: {
        orderId?: string;
        token?: string;
        amount?: number;
      } | null;
    } | null;
  };
  pgPayToken?: string;
  orderId?: string;
  verification: Pick<PGPayVerificationResponse, "amount">;
}): BindingResult {
  const { organization, pgPayToken, orderId, verification } = params;
  const pending = organization.subscription?.pendingUpgrade;

  if (!pending) {
    return { ok: false, reason: "No pending upgrade on the organization" };
  }
  if (!pending.token) {
    return { ok: false, reason: "Pending upgrade has no stored token" };
  }
  if (!pgPayToken || pgPayToken !== pending.token) {
    return {
      ok: false,
      reason: "Presented token does not match the pending upgrade's token",
    };
  }
  if (orderId && pending.orderId && orderId !== pending.orderId) {
    return {
      ok: false,
      reason: "Presented orderId does not match the pending upgrade",
    };
  }
  if (typeof pending.amount !== "number") {
    // Pending upgrades created before amounts were recorded cannot be
    // bound safely; they expire within 30 minutes of creation.
    return {
      ok: false,
      reason: "Pending upgrade has no stored expected amount",
    };
  }
  if (!amountsEqual(verification.amount, pending.amount)) {
    return {
      ok: false,
      reason: `Verified amount (${verification.amount}) does not equal upgrade amount (${pending.amount})`,
    };
  }
  return { ok: true };
}

/**
 * Deterministic webhook event id for a PGPay payment event (F-H12).
 * The same payment always maps to the same event id, so duplicate
 * deliveries deduplicate; the raw token is never stored as the id.
 */
export function pgpayEventId(pgPayToken: string): string {
  const digest = createHash("sha256").update(pgPayToken).digest("hex");
  return `pgpay_${digest.slice(0, 40)}`;
}
