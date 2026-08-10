/**
 * Reset Password Endpoint
 * POST /api/v1/customer-auth/reset-password
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { Customer } from "@topupsend/db";
import { Org } from "@topupsend/db";
import { dbConnection } from "@topupsend/db/connection";
import { ApiErrors, handleApiError } from "@/lib/api-error";
import { createSuccessResponse } from "@/lib/api-response";

const resetPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
  token: z.string().min(1, "Reset token is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  orgSlug: z.string().min(1, "Organization slug is required"),
});

export async function POST(request: NextRequest) {
  try {
    await dbConnection.connect();

    const body = await request.json();
    const data = resetPasswordSchema.parse(body);

    // Find organization by slug
    const org = await Org.findOne({ slug: data.orgSlug.toLowerCase() });

    if (!org) {
      throw ApiErrors.BadRequest("Invalid reset link");
    }

    // Find customer with matching token
    const customer = await Customer.findOne({
      email: data.email.toLowerCase(),
      orgId: org._id.toString(),
      resetPasswordToken: data.token,
    }).select("+resetPasswordToken +resetPasswordTokenExpiry +passwordHash");

    if (!customer) {
      throw ApiErrors.BadRequest("Invalid reset link");
    }

    // Check if token is expired
    if (
      customer.resetPasswordTokenExpiry &&
      customer.resetPasswordTokenExpiry < new Date()
    ) {
      throw ApiErrors.BadRequest(
        "Reset link has expired. Please request a new one.",
      );
    }

    // Update password
    customer.passwordHash = data.password; // Will be hashed by pre-save hook
    customer.resetPasswordToken = undefined;
    customer.resetPasswordTokenExpiry = undefined;
    await customer.save();

    return createSuccessResponse({
      message:
        "Password reset successfully. You can now log in with your new password.",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleApiError(ApiErrors.BadRequest(error.errors[0].message));
    }
    return handleApiError(error);
  }
}
