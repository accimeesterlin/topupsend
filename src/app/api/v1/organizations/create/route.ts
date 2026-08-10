import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth-middleware';
import { dbConnection } from '@topupsend/db/connection';
import { Org, UserOrganization, Organization } from '@topupsend/db';
import { UserRole } from '@topupsend/types';
import { createToken, createSessionCookie } from '@/lib/auth';
import { ApiErrors, handleApiError } from '@/lib/api-error';
import { createSuccessResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';

const createOrgSchema = z.object({
  name: z.string().min(1, 'Organization name is required').max(100),
  switchToNew: z.boolean().optional().default(true),
});

// Helper function to generate slug from name
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

// Helper function to ensure unique slug
async function generateUniqueSlug(baseName: string): Promise<string> {
  let slug = generateSlug(baseName);
  let counter = 1;

  // Check if slug exists in Org or Organization
  while (true) {
    const existingOrg = await Org.findOne({ slug });
    const existingOrganization = await Organization.findOne({ slug });

    if (!existingOrg && !existingOrganization) {
      return slug;
    }

    // Append counter and try again
    slug = `${generateSlug(baseName)}-${counter}`;
    counter++;
  }
}

/**
 * POST /api/v1/organizations/create
 * Create a new organization and optionally switch to it
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    // Parse and validate request body
    const body = await request.json();
    const validation = createOrgSchema.safeParse(body);

    if (!validation.success) {
      const errors = validation.error.errors.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      }));
      throw ApiErrors.UnprocessableEntity('Validation failed', { errors });
    }

    const { name, switchToNew } = validation.data;

    // Generate unique slug
    const slug = await generateUniqueSlug(name);

    // Create new organization
    const org = await Org.create({
      name,
      slug,
      settings: {},
      paymentProviders: [],
      isActive: true,
    });

    logger.info('New organization created', {
      orgId: org._id.toString(),
      orgName: name,
      createdBy: session.userId,
    });

    // Create UserOrganization record - creator is admin
    await UserOrganization.create({
      userId: session.userId,
      orgId: org._id,
      roles: [UserRole.ADMIN],
      isActive: true,
      joinedAt: new Date(),
    });

    logger.info('User added to new organization', {
      userId: session.userId,
      orgId: org._id.toString(),
      roles: [UserRole.ADMIN],
    });

    // If switchToNew is true, create new session with this org
    if (switchToNew) {
      const token = await createToken({
        userId: session.userId,
        email: session.email,
        roles: [UserRole.ADMIN],
        orgId: org._id.toString(),
      });

      const response = createSuccessResponse(
        {
          message: 'Organization created and switched successfully',
          organization: {
            id: org._id.toString(),
            name: org.name,
            slug: org.slug,
            roles: [UserRole.ADMIN],
          },
        },
        201
      );

      response.headers.set('Set-Cookie', createSessionCookie(token));
      return response;
    }

    // Otherwise just return success without switching
    return createSuccessResponse(
      {
        message: 'Organization created successfully',
        organization: {
          id: org._id.toString(),
          name: org.name,
          slug: org.slug,
          roles: [UserRole.ADMIN],
        },
      },
      201
    );
  } catch (error) {
    logger.error('Error creating organization', { error });
    return handleApiError(error);
  }
}
