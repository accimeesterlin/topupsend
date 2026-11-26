/**
 * Public customer-portal branding
 * GET /api/v1/customer-portal/branding?orgSlug=<slug>
 *
 * The customer portal header is public (it renders on the login
 * page), so this endpoint returns ONLY the org's public branding —
 * its name and business logo — for the org named by the slug. The
 * org is resolved by slug exactly the way the portal login
 * resolves tenancy, so a customer only ever sees their own org's
 * branding. The stored logo is re-validated on read: anything that
 * is not an allowed image value falls back to no logo (the portal
 * then renders its default branding).
 */

import { NextRequest, NextResponse } from "next/server";
import { Org } from "@topupsend/db";
import { dbConnection } from "@topupsend/db/connection";
import { validateOrgLogo } from "@/lib/org-logo";

export async function GET(request: NextRequest) {
  try {
    const orgSlug = request.nextUrl.searchParams.get("orgSlug");
    if (!orgSlug) {
      return NextResponse.json(
        { error: "orgSlug is required" },
        { status: 400 },
      );
    }

    await dbConnection.connect();

    const org = await Org.findOne({ slug: orgSlug.toLowerCase() });
    if (!org) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 },
      );
    }

    const storedLogo = (org as any).logo as string | undefined;
    const validation = storedLogo ? validateOrgLogo(storedLogo) : null;
    const logo =
      validation && validation.ok ? validation.value : null;

    return NextResponse.json({
      name: org.name,
      slug: org.slug,
      logo,
    });
  } catch (error) {
    console.error("Get portal branding error:", error);
    return NextResponse.json(
      { error: "Failed to fetch branding" },
      { status: 500 },
    );
  }
}
