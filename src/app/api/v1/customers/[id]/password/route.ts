import { NextRequest } from "next/server";
import { requireCustomerAuth } from "@/lib/auth-middleware";
import { Customer } from "@topupsend/db";
import { createSuccessResponse, createErrorResponse } from "@/lib/api-response";
import { z } from "zod";

const updatePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const customerSession = await requireCustomerAuth(request);

    // Fetch customer from database
    const customer = await Customer.findById(customerSession.customerId);
    if (!customer) {
      return createErrorResponse("Customer not found", 404);
    }

    // Ensure customer can only update their own password
    if (String(customer._id) !== id) {
      console.warn("[Customer Password] Forbidden password update attempt", {
        pathId: id,
        sessionCustomerId: String(customer._id),
      });
      return createErrorResponse("You can only update your own password", 403);
    }

    const body = await request.json();
    const { currentPassword, newPassword } = updatePasswordSchema.parse(body);

    // Verify current password
    const isValid = await customer.comparePassword(currentPassword);
    if (!isValid) {
      return createErrorResponse("Current password is incorrect", 401);
    }

    // Update password
    customer.passwordHash = newPassword; // Will be hashed by pre-save hook
    await customer.save();

    return createSuccessResponse({
      message: "Password updated successfully",
    });
  } catch (error: any) {
    return createErrorResponse(
      error.message || "Failed to update password",
      500,
    );
  }
}
