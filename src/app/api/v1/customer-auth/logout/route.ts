/**
 * Customer Logout Endpoint
 * POST /api/v1/customer-auth/logout
 */

import { NextRequest } from "next/server";
import { Customer } from "@topupsend/db";
import { dbConnection } from "@topupsend/db/connection";
import { createSuccessResponse } from "@/lib/api-response";
import {
  deleteCustomerSession,
  getCustomerSession,
} from "@/lib/customer-auth";
import { logger } from "@/lib/logger";

export async function POST(_request: NextRequest) {
  // Revoke the session server-side (F-M1): bump the customer's token
  // version so the token being logged out — and every other token
  // minted at the same version — fails requireCustomerAuth
  // revalidation, instead of staying valid for its full 7-day life
  // after the cookie is gone. Best-effort: logout never fails
  // because of it.
  try {
    const session = await getCustomerSession();
    if (session) {
      await dbConnection.connect();
      await Customer.updateOne(
        { _id: session.customerId },
        { $inc: { tokenVersion: 1 } },
      );
    }
  } catch (revokeError) {
    logger.warn("Failed to revoke customer sessions on logout", {
      error: revokeError,
    });
  }

  await deleteCustomerSession();

  return createSuccessResponse({
    message: "Logout successful",
  });
}
