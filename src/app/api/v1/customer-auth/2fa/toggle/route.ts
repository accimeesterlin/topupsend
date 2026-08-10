/**
 * Toggle Two-Factor Authentication
 * POST /api/v1/customer-auth/2fa/toggle
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { Customer } from "@topupsend/db";
import { dbConnection } from "@topupsend/db/connection";
import { ApiErrors, handleApiError } from "@/lib/api-error";
import { createSuccessResponse } from "@/lib/api-response";
import { getCustomerSession } from "@/lib/customer-auth";

const toggleSchema = z.object({
  enabled: z.boolean(),
});

export async function POST(request: NextRequest) {
  try {
    await dbConnection.connect();

    // Get customer session
    const session = await getCustomerSession();
    if (!session) {
      throw ApiErrors.Unauthorized("Please log in to continue");
    }

    console.log("[2FA Toggle] Session:", { customerId: session.customerId });

    const body = await request.json();
    const data = toggleSchema.parse(body);

    console.log("[2FA Toggle] Request body:", data);

    // Find customer
    const customer = await Customer.findById(session.customerId);

    if (!customer) {
      console.error("[2FA Toggle] Customer not found:", session.customerId);
      throw ApiErrors.NotFound("Customer not found");
    }

    console.log("[2FA Toggle] Current state:", {
      customerId: customer._id,
      currentTwoFactorEnabled: customer.twoFactorEnabled,
      newState: data.enabled,
    });

    // Update 2FA setting
    customer.twoFactorEnabled = data.enabled;

    // If disabling 2FA, clear any existing codes
    if (!data.enabled) {
      customer.twoFactorCode = undefined;
      customer.twoFactorCodeExpiry = undefined;
      customer.twoFactorVerified = false;
    }

    console.log("[2FA Toggle] Saving customer with new state...");
    const savedCustomer = await customer.save();

    console.log("[2FA Toggle] Customer saved successfully:", {
      customerId: savedCustomer._id,
      twoFactorEnabled: savedCustomer.twoFactorEnabled,
    });

    return createSuccessResponse({
      message: data.enabled
        ? "Two-factor authentication enabled"
        : "Two-factor authentication disabled",
      twoFactorEnabled: savedCustomer.twoFactorEnabled,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleApiError(ApiErrors.BadRequest(error.errors[0].message));
    }
    return handleApiError(error);
  }
}
