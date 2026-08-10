/**
 * Verify Customer Email Endpoint
 * POST /api/v1/customer-auth/verify-email
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { Org } from "@topupsend/db";
import { dbConnection } from "@topupsend/db/connection";
import { ApiErrors, handleApiError } from "@/lib/api-error";
import { createSuccessResponse } from "@/lib/api-response";
import { emailVerificationService } from "@/lib/services/email-verification.service";
import { createCustomerSession } from "@/lib/customer-auth";

const verifyEmailSchema = z.object({
  email: z.string().email("Invalid email address"),
  token: z.string().min(1, "Verification token is required"),
  orgSlug: z.string().min(1, "Organization slug is required"),
});

export async function POST(request: NextRequest) {
  try {
    await dbConnection.connect();

    const body = await request.json();
    const data = verifyEmailSchema.parse(body);

    // Find organization by slug
    const org = await Org.findOne({ slug: data.orgSlug.toLowerCase() });

    if (!org) {
      throw ApiErrors.NotFound("Organization not found");
    }

    // Verify email
    const result = await emailVerificationService.verifyEmail(
      data.email,
      data.token,
      org._id.toString(),
    );

    if (!result.success) {
      throw ApiErrors.BadRequest(result.error || "Verification failed");
    }

    // Update session with verified status
    if (result.customer) {
      await createCustomerSession({
        customerId: String(result.customer._id),
        orgId: String(org._id),
        email: result.customer.email!,
        emailVerified: true,
        name: result.customer.name,
      });
    }

    return createSuccessResponse({
      message: "Email verified successfully",
      customer: {
        id: String(result.customer?._id),
        email: result.customer?.email,
        emailVerified: true,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleApiError(ApiErrors.BadRequest(error.errors[0].message));
    }
    return handleApiError(error);
  }
}
