import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-middleware";
import { dbConnection } from "@topupsend/db/connection";
import { Org, Organization, UserOrganization } from "@topupsend/db";
import { UserRole } from "@topupsend/types";
import { createSuccessResponse } from "@/lib/api-response";
import { handleApiError, ApiErrors } from "@/lib/api-error";
import { logger } from "@/lib/logger";

/**
 * PATCH /api/v1/organizations/[id]
 * Update organization details (name, slug)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    // Handle async params for Next.js 15
    const { id } = await params;

    logger.info("Update organization request received", {
      orgId: id,
      userId: session.userId,
    });

    if (!id) {
      throw ApiErrors.BadRequest("Organization ID is required");
    }

    // Check if user has admin access to this organization
    const userOrg = await UserOrganization.findOne({
      userId: session.userId,
      orgId: id,
      isActive: true,
      roles: { $in: [UserRole.ADMIN] },
    });

    if (!userOrg) {
      throw ApiErrors.Forbidden(
        "You do not have permission to update this organization",
      );
    }

    // Parse request body
    const body = await request.json();
    const { name, slug } = body;

    if (!name || !name.trim()) {
      throw ApiErrors.UnprocessableEntity("Organization name is required");
    }

    if (!slug || !slug.trim()) {
      throw ApiErrors.UnprocessableEntity("Organization slug is required");
    }

    // Validate slug format
    const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    if (!slugPattern.test(slug.trim())) {
      throw ApiErrors.UnprocessableEntity(
        "Slug must contain only lowercase letters, numbers, and hyphens",
      );
    }

    // Check if slug is already taken by another organization
    const existingOrgWithSlug = await Org.findOne({
      slug: slug.trim(),
      _id: { $ne: id },
    });

    const existingOrganizationWithSlug = await Organization.findOne({
      slug: slug.trim(),
      _id: { $ne: id },
    });

    if (existingOrgWithSlug || existingOrganizationWithSlug) {
      throw ApiErrors.Conflict(
        "This slug is already taken by another organization",
      );
    }

    // Update the organization
    const org = await Org.findByIdAndUpdate(
      id,
      {
        name: name.trim(),
        slug: slug.trim(),
      },
      { new: true },
    );

    if (!org) {
      throw ApiErrors.NotFound("Organization not found");
    }

    logger.info("Organization updated", {
      orgId: id,
      name: org.name,
      slug: org.slug,
      updatedBy: session.userId,
    });

    return createSuccessResponse({
      message: "Organization updated successfully",
      organization: {
        id: org._id.toString(),
        name: org.name,
        slug: org.slug,
      },
    });
  } catch (error) {
    logger.error("Error updating organization", { error });
    return handleApiError(error);
  }
}
