/**
 * Manual Payments - Staff Endpoints
 * POST /api/v1/payments/manual - Record a payment received offline
 * GET  /api/v1/payments/manual - List the org's manual payments
 *
 * Phase 3: payments can be applied to a customer's prepaid balance.
 * Applying a payment to an existing order arrives in Phase 4.
 */

import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { dbConnection } from "@topupsend/db";
import { ApiErrors, handleApiError } from "@/lib/api-error";
import {
  createSuccessResponse,
  createCreatedResponse,
  createErrorResponse,
} from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-middleware";
import { Permission } from "@topupsend/types";
import { hasPermission } from "@/lib/permissions";
import { logger } from "@/lib/logger";
import { createManualPaymentSchema } from "@/lib/validations/manual-payment";
import {
  listManualPayments,
  recordBalanceManualPayment,
} from "@/lib/services/manual-payment.service";
import type { IManualPayment } from "@topupsend/db";

function serializeManualPayment(payment: IManualPayment) {
  return {
    id: payment._id?.toString(),
    orgId: payment.orgId,
    customerId: payment.customerId,
    transactionId: payment.transactionId,
    orderId: payment.orderId,
    amount: payment.amount,
    currency: payment.currency,
    method: payment.method,
    reference: payment.reference,
    proofReference: payment.proofReference,
    notes: payment.notes,
    receivedAt: payment.receivedAt,
    appliedTo: payment.appliedTo,
    status: payment.status,
    createdBy: payment.createdBy,
    voidedBy: payment.voidedBy,
    voidedAt: payment.voidedAt,
    voidReason: payment.voidReason,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

/**
 * POST - Record a manual payment.
 * Permission: RECORD_MANUAL_PAYMENT (Admin, Operator)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);

    if (!hasPermission(session.roles, Permission.RECORD_MANUAL_PAYMENT)) {
      throw ApiErrors.Forbidden(
        "You do not have permission to record manual payments",
      );
    }

    await dbConnection.connect();

    const body = await request.json();

    let input;
    try {
      input = createManualPaymentSchema.parse(body);
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map(
          (err) => `${err.path.join(".")}: ${err.message}`,
        );
        return createErrorResponse(
          `Validation failed: ${errors.join(", ")}`,
          400,
        );
      }
      throw error;
    }

    if (input.appliedTo === "order") {
      // Order application (with fulfillment) is Phase 4 of the rollout.
      throw ApiErrors.BadRequest(
        "Applying a manual payment to an order is not available yet",
      );
    }

    const { manualPayment, customer } = await recordBalanceManualPayment({
      orgId: session.orgId,
      recordedBy: session.userId,
      input,
    });

    return createCreatedResponse({
      message: "Manual payment recorded",
      manualPayment: serializeManualPayment(manualPayment),
      balance: {
        current: customer.currentBalance,
        totalAssigned: customer.totalAssigned,
        totalUsed: customer.totalUsed,
        currency: customer.balanceCurrency,
      },
    });
  } catch (error) {
    logger.error("Error recording manual payment", { error });
    return handleApiError(error);
  }
}

/**
 * GET - List manual payments for the session org.
 * Permission: VIEW_TRANSACTIONS (Admin, Operator, Viewer)
 * Filters: customerId, method, status, from, to; pagination: page, limit.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth(request);

    if (!hasPermission(session.roles, Permission.VIEW_TRANSACTIONS)) {
      throw ApiErrors.Forbidden(
        "You do not have permission to view manual payments",
      );
    }

    await dbConnection.connect();

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    const { payments, total } = await listManualPayments({
      orgId: session.orgId,
      customerId: searchParams.get("customerId") || undefined,
      method: searchParams.get("method") || undefined,
      status: searchParams.get("status") || undefined,
      from: fromParam ? new Date(fromParam) : undefined,
      to: toParam ? new Date(toParam) : undefined,
      page,
      limit,
    });

    return createSuccessResponse({
      manualPayments: payments.map(serializeManualPayment),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: (page - 1) * limit + payments.length < total,
      },
    });
  } catch (error) {
    logger.error("Error listing manual payments", { error });
    return handleApiError(error);
  }
}
