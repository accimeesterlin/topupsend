/**
 * Get Current Customer Session
 * GET /api/v1/customer-auth/me
 */

import { NextRequest } from "next/server";
import { Customer } from "@topupsend/db";
import { dbConnection } from "@topupsend/db/connection";
import { ApiErrors, handleApiError } from "@/lib/api-error";
import { createSuccessResponse } from "@/lib/api-response";
import { requireCustomerAuthOrApiKey } from "@/lib/auth-middleware";

export async function GET(request: NextRequest) {
  try {
    await dbConnection.connect();

    const session = await requireCustomerAuthOrApiKey(request);

    // Get full customer details
    const customer = await Customer.findById(session.customerId);

    if (!customer) {
      throw ApiErrors.NotFound("Customer not found");
    }

    const fullName = (customer.name || "").trim();
    const nameParts = fullName ? fullName.split(/\s+/) : [];
    const firstName = nameParts[0] || "";
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

    console.log("[Customer Auth /me] Returning customer data:", {
      customerId: customer._id,
      email: customer.email,
      name: fullName,
      firstName,
      lastName,
      twoFactorEnabled: customer.twoFactorEnabled,
    });

    return createSuccessResponse({
      customer: {
        id: String(customer._id),
        _id: String(customer._id),
        name: fullName,
        email: customer.email,
        firstName,
        lastName,
        phoneNumber: customer.phoneNumber,
        emailVerified: customer.emailVerified,
        twoFactorEnabled: customer.twoFactorEnabled,
        currentBalance: customer.currentBalance,
        totalAssigned: customer.totalAssigned,
        totalUsed: customer.totalUsed,
        balanceCurrency: customer.balanceCurrency,
        country: customer.country,
        createdAt: customer.createdAt,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
