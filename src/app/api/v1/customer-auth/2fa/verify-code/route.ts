/**
 * Verify Two-Factor Authentication Code
 * POST /api/v1/customer-auth/2fa/verify-code
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { Customer, Org } from "@topupsend/db";
import { dbConnection } from "@topupsend/db/connection";
import { ApiErrors, handleApiError } from "@/lib/api-error";
import { createSuccessResponse } from "@/lib/api-response";
import { createCustomerSession } from "@/lib/customer-auth";

const verifyCodeSchema = z.object({
  email: z.string().email("Invalid email address"),
  orgSlug: z.string().min(1, "Organization slug is required"),
  code: z.string().length(6, "Code must be 6 digits"),
});

export async function POST(request: NextRequest) {
  try {
    await dbConnection.connect();

    const body = await request.json();
    const data = verifyCodeSchema.parse(body);

    // Find organization by slug
    const org = await Org.findOne({ slug: data.orgSlug.toLowerCase() });

    if (!org) {
      throw ApiErrors.NotFound("Organization not found");
    }

    // Find customer with 2FA code
    const customer = await Customer.findOne({
      email: data.email.toLowerCase(),
      orgId: org._id.toString(),
    }).select("+twoFactorCode +twoFactorCodeExpiry +twoFactorVerified");

    if (!customer) {
      throw ApiErrors.NotFound("Customer not found");
    }

    // Check if 2FA is enabled
    if (!customer.twoFactorEnabled) {
      throw ApiErrors.BadRequest("Two-factor authentication is not enabled");
    }

    // Check if code exists
    if (!customer.twoFactorCode || !customer.twoFactorCodeExpiry) {
      throw ApiErrors.BadRequest(
        "No verification code found. Please request a new code.",
      );
    }

    // Check if code has expired
    if (new Date() > customer.twoFactorCodeExpiry) {
      throw ApiErrors.BadRequest(
        "Verification code has expired. Please request a new code.",
      );
    }

    // Verify code
    if (customer.twoFactorCode !== data.code) {
      throw ApiErrors.BadRequest("Invalid verification code");
    }

    // Mark 2FA as verified
    customer.twoFactorVerified = true;
    customer.twoFactorCode = undefined; // Clear the code
    customer.twoFactorCodeExpiry = undefined;
    await customer.save();

    // Create session
    const token = await createCustomerSession({
      customerId: String(customer._id),
      orgId: String(org._id),
      email: customer.email!,
      emailVerified: customer.emailVerified,
      name: customer.name,
    });

    // Explicitly set cookie on the response to ensure it's included
    const response = createSuccessResponse({
      message: "Verification successful",
      customer: {
        id: String(customer._id),
        email: customer.email,
        name: customer.name,
        emailVerified: customer.emailVerified,
        twoFactorEnabled: customer.twoFactorEnabled,
        currentBalance: customer.currentBalance,
        balanceCurrency: customer.balanceCurrency,
      },
    });

    response.cookies.set("customer-session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    });

    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleApiError(ApiErrors.BadRequest(error.errors[0].message));
    }
    return handleApiError(error);
  }
}
