import { NextRequest } from "next/server";
import { User } from "@topupsend/db";
import { createSuccessResponse, createErrorResponse } from "@/lib/api-response";
import { dbConnection } from "@topupsend/db/connection";
import { createToken, createSessionCookie } from "@/lib/auth";
import { UserRole } from "@topupsend/types";

/**
 * POST /api/v1/auth/2fa/verify
 * Verify the 2FA code and complete login
 */
export async function POST(req: NextRequest) {
  try {
    await dbConnection.connect();

    const { email, code } = await req.json();

    if (!email || !code) {
      return createErrorResponse("Email and code are required", 400);
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select(
      "+twoFactorCode +twoFactorCodeExpires"
    );

    if (!user) {
      return createErrorResponse("Invalid verification code", 400);
    }

    if (!user.twoFactorEnabled) {
      return createErrorResponse("Two-factor authentication is not enabled", 400);
    }

    if (!user.twoFactorCode || !user.twoFactorCodeExpires) {
      return createErrorResponse("No verification code found. Please request a new code", 400);
    }

    // Check if code is expired
    if (new Date() > user.twoFactorCodeExpires) {
      return createErrorResponse("Verification code has expired. Please request a new code", 400);
    }

    // Verify code
    if (user.twoFactorCode !== code) {
      return createErrorResponse("Invalid verification code", 400);
    }

    // Clear the code after successful verification
    user.twoFactorCode = undefined;
    user.twoFactorCodeExpires = undefined;
    await user.save();

    // Generate session token
    const token = await createToken({
      userId: user._id.toString(),
      email: user.email,
      roles: user.roles as UserRole[],
      orgId: user.orgId.toString(),
    });

    const response = createSuccessResponse({
      message: "Two-factor authentication successful",
      user: {
        id: user._id,
        email: user.email,
        roles: user.roles,
        orgId: user.orgId,
      },
    });

    // Set session cookie
    response.headers.set("Set-Cookie", createSessionCookie(token));

    return response;
  } catch (error: any) {
    console.error("2FA verify error:", error);
    return createErrorResponse("Failed to verify code", 500);
  }
}
