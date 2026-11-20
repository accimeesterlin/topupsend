/**
 * Partner API — phone lookup
 * POST /api/v1/partner/lookup
 *
 * Server-to-server equivalent of the public POST /api/v1/lookup/phone.
 * Authenticated with an API key (scope `topup:send`); the organization
 * is bound by the key — the caller never supplies an org identifier.
 * The org's slug is resolved from the key's orgId and the request is
 * delegated to the public lookup handler, so the operator/product/
 * pricing payload (and the storefront-pricing logic behind it) is
 * exactly the one storefront customers receive.
 */

import { NextRequest } from "next/server";
import { dbConnection, Org, Organization } from "@topupsend/db";
import { ApiErrors, handleApiError } from "@/lib/api-error";
import { requireApiKeyWithScope } from "@/lib/auth-middleware";
import { POST as publicPhoneLookupPOST } from "../../lookup/phone/route";

export async function POST(request: NextRequest) {
  try {
    await dbConnection.connect();

    const { orgId } = await requireApiKeyWithScope(request, "topup:send");

    const body = (await request.json().catch(() => null)) as {
      phoneNumber?: unknown;
    } | null;
    const phoneNumber = body?.phoneNumber;

    if (!phoneNumber || typeof phoneNumber !== "string") {
      throw ApiErrors.BadRequest("Phone number is required");
    }

    // Resolve the org slug for the key's organization. Both models
    // read the same `orgs` collection (legacy Org / Organization).
    const org =
      (await Org.findById(orgId)) || (await Organization.findById(orgId));

    if (!org?.slug) {
      throw ApiErrors.NotFound("Organization not found for this API key");
    }

    // Delegate to the public lookup with the key's org slug — the
    // slug comes from the key, never from the request body.
    const lookupRequest = new NextRequest(
      new URL("/api/v1/lookup/phone", request.url),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phoneNumber, orgSlug: org.slug }),
      },
    );

    return publicPhoneLookupPOST(lookupRequest);
  } catch (error) {
    // requireApiKey throws a raw Response for rate-limit breaches.
    if (error instanceof Response) {
      return error;
    }
    return handleApiError(error);
  }
}
