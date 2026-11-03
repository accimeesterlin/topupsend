import { User, UserOrganization } from '@topupsend/db';
import { createToken } from '@/lib/auth';
import { logger } from '@/lib/logger';

/**
 * Mint TopUpSend's ordinary session for a PG-resolved user.
 *
 * Servanzo needed a one-time ticket bridge because its session is
 * created by NextAuth's signIn() inside a server action. TopUpSend's
 * session is a plain JWT cookie (src/lib/auth.ts), so the callback
 * route can mint it directly — this helper is the bridge's analogue:
 * given the resolved user id, it produces exactly the session token
 * the password login produces, including the login route's
 * default-organization resolution (the user's own orgId, else the
 * most recent active UserOrganization, persisted back onto the user).
 * The callback sets the token as the `session` cookie with the same
 * attributes createSessionCookie uses.
 *
 * Returns null when the user no longer exists or is inactive — the
 * caller turns that into a refused sign-in, never a session.
 */
export async function createPgUserSessionToken(userId: string): Promise<string | null> {
  const user = await User.findById(userId);
  if (!user || !user.isActive) return null;

  // Ensure we have a default organization for the session — the same
  // logic (and the same persist-back) as the password login route.
  let sessionOrgId = user.orgId ? user.orgId.toString() : undefined;

  if (!sessionOrgId) {
    const userOrg = await UserOrganization.findOne({
      userId: user._id,
      isActive: true,
    })
      .sort({ joinedAt: -1 })
      .populate('orgId');
    if (userOrg && (userOrg as any).orgId) {
      try {
        const orgIdStr =
          (userOrg as any).orgId._id?.toString() || (userOrg as any).orgId.toString();
        sessionOrgId = orgIdStr;
        user.orgId = sessionOrgId as any;
        await user.save();
      } catch (err) {
        // Non-fatal: if saving fails, still continue with the found org.
        logger.warn('Failed to persist default orgId on user during PG sign-in', {
          userId: user._id.toString(),
          error: err,
        });
      }
    }
  }

  return createToken({
    userId: user._id.toString(),
    email: user.email,
    roles: user.roles,
    orgId: sessionOrgId || '',
  });
}
