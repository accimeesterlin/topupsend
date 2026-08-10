import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-middleware";
import { User } from "@topupsend/db";
import { createSuccessResponse, createErrorResponse } from "@/lib/api-response";
import { dbConnection } from "@topupsend/db/connection";

/**
 * POST /api/v1/auth/2fa/toggle
 * Enable or disable 2FA for the current user
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    await dbConnection.connect();

    const { enabled } = await req.json();

    if (typeof enabled !== "boolean") {
      return createErrorResponse("enabled field is required and must be a boolean", 400);
    }

    const user = await User.findById(session.userId);
    if (!user) {
      return createErrorResponse("User not found", 404);
    }

    user.twoFactorEnabled = enabled;

    // Clear any existing codes when disabling 2FA
    if (!enabled) {
      user.twoFactorCode = undefined;
      user.twoFactorCodeExpires = undefined;
    }

    await user.save();

    return createSuccessResponse({
      twoFactorEnabled: user.twoFactorEnabled,
      message: enabled
        ? "Two-factor authentication enabled successfully"
        : "Two-factor authentication disabled successfully",
    });
  } catch (error: any) {
    console.error("2FA toggle error:", error);
    return createErrorResponse("Failed to update 2FA settings", 500);
  }
}
