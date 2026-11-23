import { User } from '@topupsend/db';
import { createToken } from '@/lib/auth';
import { resolveMembershipSession } from '@/lib/membership-session';

/**
 * Mint TopUpSend's ordinary session for a PG-resolved user.
 *
 * Servanzo needed a one-time ticket bridge because its session is
 * created by NextAuth's signIn() inside a server action. TopUpSend's
 * session is a plain JWT cookie (src/lib/auth.ts), so the callback
 * route can mint it directly — this helper is the bridge's analogue:
 * given the resolved user id, it produces exactly the session token
 * the password login produces. The callback sets the token as the
 * `session` cookie with the same attributes createSessionCookie uses.
 *
 * RBAC C1: the org + roles come from resolveMembershipSession (the
 * live UserOrganization record), never from the legacy global
 * `user.roles` — a member demoted or removed since their account was
 * created must not regain their original roles by signing in here.
 *
 * Returns null when the user no longer exists, is inactive, or has
 * no active membership — the caller turns that into a refused
 * sign-in, never a session.
 */
export async function createPgUserSessionToken(userId: string): Promise<string | null> {
  const user = await User.findById(userId);
  if (!user || !user.isActive) return null;

  const membership = await resolveMembershipSession(user);
  if (!membership) return null;

  return createToken({
    userId: user._id.toString(),
    email: user.email,
    roles: membership.roles,
    orgId: membership.orgId,
    tv: user.tokenVersion ?? 0,
  });
}
