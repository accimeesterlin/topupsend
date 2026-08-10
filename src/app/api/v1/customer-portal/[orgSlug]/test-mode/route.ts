import { NextRequest } from "next/server";
import { dbConnection } from "@topupsend/db/connection";
import { StorefrontSettings, Organization } from "@topupsend/db";
import { createSuccessResponse, createErrorResponse } from "@/lib/api-response";
import { handleApiError } from "@/lib/api-error";

/**
 * GET /api/v1/customer-portal/[orgSlug]/test-mode
 * Public endpoint to check if organization is in test mode
 * Used to display test mode warning banner on customer portal
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  try {
    await dbConnection.connect();

    const { orgSlug } = await params;

    // Find organization
    const org = await Organization.findOne({ slug: orgSlug });
    if (!org) {
      return createErrorResponse("Organization not found", 404);
    }

    // Get storefront settings
    const settings = await StorefrontSettings.findOne({ orgId: org._id });

    // Return test mode status
    const testMode = settings?.topupSettings?.validateOnly || false;

    return createSuccessResponse({
      testMode,
      orgSlug: org.slug,
      orgName: org.name,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
