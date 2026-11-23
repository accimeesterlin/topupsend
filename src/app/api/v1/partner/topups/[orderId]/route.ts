/**
 * Partner API — read a top-up's status
 * GET /api/v1/partner/topups/[orderId]
 *
 * Authenticated with an API key (scope `transactions:read`). Only
 * transactions belonging to the key's organization are visible —
 * anything else is a 404. If the transaction is still "processing",
 * the existing live-settle path (settleStuckTransfer, which polls
 * DingConnect's GetTransferStatus) runs before answering, so the
 * partner sees the freshest known status.
 */

import { NextRequest } from "next/server";
import { dbConnection, Transaction } from "@topupsend/db";
import { ApiErrors, handleApiError } from "@/lib/api-error";
import { createSuccessResponse } from "@/lib/api-response";
import { requirePartnerApiKey } from "@/lib/auth-middleware";
import { settleStuckTransfer } from "@/lib/services/fulfillment.service";
import { partnerTopupStatusView } from "@/lib/partner-transaction";
import { logger } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  try {
    await dbConnection.connect();

    const { orgId } = await requirePartnerApiKey(
      request,
      "transactions:read",
    );

    const { orderId } = await params;

    let transaction = await Transaction.findOne({ orgId, orderId });

    if (!transaction) {
      throw ApiErrors.NotFound("Transaction not found");
    }

    if (transaction.status === "processing") {
      try {
        await settleStuckTransfer(transaction);
        // settleStuckTransfer mutates and saves the document (and the
        // refund path may replace its state) — re-read before answering.
        const refreshed = await Transaction.findOne({ orgId, orderId });
        if (refreshed) {
          transaction = refreshed;
        }
      } catch (settleError) {
        // A settle failure must not fail the read: answer with the
        // last known status and let the reconciliation sweep retry.
        logger.warn("Partner status live-settle failed", {
          orderId,
          error:
            settleError instanceof Error
              ? settleError.message
              : "Unknown error",
        });
      }
    }

    return createSuccessResponse(partnerTopupStatusView(transaction));
  } catch (error) {
    // requireApiKey throws a raw Response for rate-limit breaches.
    if (error instanceof Response) {
      return error;
    }
    return handleApiError(error);
  }
}
