import { NextRequest } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { requireAuth } from '@/lib/auth-middleware';
import { dbConnection } from '@topupsend/db/connection';
import { User, UserOrganization, Org } from '@topupsend/db';
import { UserRole } from '@topupsend/types';
import { ApiErrors, handleApiError } from '@/lib/api-error';
import { createSuccessResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { EmailService } from '@/lib/services/email.service';

const inviteUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  roles: z
    .array(z.enum([UserRole.ADMIN, UserRole.OPERATOR, UserRole.VIEWER]))
    .min(1, 'At least one role is required')
    .default([UserRole.VIEWER]),
  orgId: z.string().optional(), // If not provided, use current org from session
});

/**
 * POST /api/v1/organizations/invite
 * Invite a user to an organization
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnection.connect();

    // Parse and validate request body
    const body = await request.json();
    const validation = inviteUserSchema.safeParse(body);

    if (!validation.success) {
      const errors = validation.error.errors.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      }));
      throw ApiErrors.UnprocessableEntity('Validation failed', { errors });
    }

    const { email, roles, orgId } = validation.data;
    const targetOrgId = orgId || session.orgId;

    // Verify the inviter has admin role in the target organization
    const inviterOrgRecord = await UserOrganization.findOne({
      userId: session.userId,
      orgId: targetOrgId,
      isActive: true,
    });

    if (!inviterOrgRecord || !inviterOrgRecord.roles.includes(UserRole.ADMIN)) {
      throw ApiErrors.Forbidden('Only admins can invite users to the organization');
    }

    // Get organization and inviter information for email
    logger.info('Looking for organization', { targetOrgId, sessionOrgId: session.orgId });
    const organization = await Org.findById(targetOrgId);
    const inviter = await User.findById(session.userId);

    logger.info('Organization lookup result', {
      found: !!organization,
      organizationId: organization?._id,
      organizationName: organization?.name
    });

    if (!organization) {
      throw ApiErrors.NotFound('Organization not found');
    }

    const orgName = organization.name || 'Your Organization';
    const inviterName = inviter?.email || 'An administrator';

    // Find the user to invite
    const userToInvite = await User.findOne({ email: email.toLowerCase() });

    if (!userToInvite) {
      // User doesn't exist yet - create a pending invitation
      // For now, we'll create a placeholder user account that they can claim later
      // In a production system, you'd typically send an email invitation

      // Generate a temporary password (user will need to reset it)
      const tempPassword = Math.random().toString(36).slice(-12);
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      // Create the user account
      const newUser = await User.create({
        email: email.toLowerCase(),
        passwordHash: hashedPassword,
        orgId: targetOrgId, // Set primary org
        roles: [UserRole.VIEWER], // Default role
        isActive: true,
      });

      // Create the organization membership
      const userOrg = await UserOrganization.create({
        userId: newUser._id,
        orgId: targetOrgId,
        roles,
        isActive: true,
        invitedBy: session.userId,
        invitedAt: new Date(),
        joinedAt: new Date(),
      });

      logger.info('New user created and invited to organization', {
        userId: newUser._id.toString(),
        orgId: targetOrgId,
        roles,
        invitedBy: session.userId,
      });

      // Send invitation email with temporary password
      try {
        await EmailService.sendTeamInvitationEmail(
          targetOrgId,
          newUser.email,
          inviterName,
          orgName,
          tempPassword
        );
        logger.info('Invitation email sent', { email: newUser.email });
      } catch (emailError: any) {
        logger.error('Failed to send invitation email', {
          error: emailError.message,
          email: newUser.email,
        });
        // Continue even if email fails - user account is already created
      }

      return createSuccessResponse(
        {
          message: 'Invitation sent successfully. User will receive an email to set up their account.',
          user: {
            id: newUser._id.toString(),
            email: newUser.email,
            roles: userOrg.roles,
            isPending: true,
          },
        },
        201
      );
    }

    // Check if user is already in the organization
    const existingMembership = await UserOrganization.findOne({
      userId: userToInvite._id,
      orgId: targetOrgId,
    });

    if (existingMembership) {
      if (existingMembership.isActive) {
        throw ApiErrors.Conflict('User is already a member of this organization');
      } else {
        // Reactivate inactive membership
        existingMembership.isActive = true;
        existingMembership.roles = roles;
        existingMembership.invitedBy = session.userId as any;
        existingMembership.invitedAt = new Date();
        existingMembership.joinedAt = new Date();
        await existingMembership.save();

        logger.info('User membership reactivated', {
          userId: userToInvite._id.toString(),
          orgId: targetOrgId,
          invitedBy: session.userId,
        });

        return createSuccessResponse({
          message: 'User membership reactivated successfully',
          user: {
            id: userToInvite._id.toString(),
            email: userToInvite.email,
            roles: existingMembership.roles,
          },
        });
      }
    }

    // Create new UserOrganization record
    const userOrg = await UserOrganization.create({
      userId: userToInvite._id,
      orgId: targetOrgId,
      roles,
      isActive: true,
      invitedBy: session.userId,
      invitedAt: new Date(),
      joinedAt: new Date(),
    });

    logger.info('User invited to organization', {
      userId: userToInvite._id.toString(),
      orgId: targetOrgId,
      roles,
      invitedBy: session.userId,
    });

    // Send invitation email to existing user
    try {
      await EmailService.sendTeamInvitationEmail(
        targetOrgId,
        userToInvite.email,
        inviterName,
        orgName
      );
      logger.info('Invitation email sent', { email: userToInvite.email });
    } catch (emailError: any) {
      logger.error('Failed to send invitation email', {
        error: emailError.message,
        email: userToInvite.email,
      });
      // Continue even if email fails
    }

    return createSuccessResponse(
      {
        message: 'User invited successfully',
        user: {
          id: userToInvite._id.toString(),
          email: userToInvite.email,
          roles: userOrg.roles,
        },
      },
      201
    );
  } catch (error) {
    logger.error('Error inviting user to organization', { error });
    return handleApiError(error);
  }
}
