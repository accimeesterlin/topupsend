import crypto from 'crypto';
import { Org, User, UserOrganization } from '@topupsend/db';
import { UserRole } from '@topupsend/types';
import { hashPassword } from '@/lib/auth';
import { logger } from '@/lib/logger';
import type { PgIdentityClaims } from './client';
import { decideCandidate, deriveOrgName, slugifyOrgName } from './resolve-shared';
import { linkUserPgIdentity } from './user-link';

/**
 * Resolve a verified PG identity to a TopUpSend User. Ported from
 * Servanzo's main-flow resolver (lib/pg-sso/user-resolve.ts there)
 * and adapted to this app's records and signup conventions:
 *
 * pgAuthId → pgUserId → verified email; the lookups must agree on
 * one account; linking is first-write-wins via linkUserPgIdentity
 * and a link conflict hard-stops. No match:
 *
 * - email VERIFIED → an account is provisioned exactly the way the
 *   signup route (src/app/api/v1/auth/signup) provisions one: an Org
 *   (unique slug derived from the name), a User with roles [ADMIN],
 *   orgId set, isActive true, and a UserOrganization membership. PG
 *   asks for no organization name, so the org name is derived from
 *   the PG profile (see deriveOrgName) and can be renamed later.
 *   The PG ids are stamped at creation, and the password is a random
 *   32-byte secret nobody knows — an unusable credential, hashed like
 *   any password; the person can set a real one via forgot-password.
 * - email NOT verified (or absent) → hard stop; nothing is created.
 *
 * Two TopUpSend-specific refusals Servanzo does not have:
 * - a matched-but-inactive user is refused (the password login
 *   refuses inactive accounts the same way);
 * - a matched user with twoFactorEnabled is refused with a distinct
 *   outcome: the password login would challenge for the email code,
 *   and a PG sign-in must not silently bypass a factor the user
 *   switched on. The identity link is still recorded first — it is
 *   an association, not a session.
 */

export type PgResolution =
  | { outcome: 'signed-in'; userId: string; created: boolean }
  | { outcome: 'conflict' }
  | { outcome: 'unverified-email' }
  | { outcome: 'inactive' }
  | { outcome: 'two-factor' };

interface MatchedUser {
  _id: { toString(): string };
  isActive?: boolean;
  twoFactorEnabled?: boolean;
}

export async function resolvePgUser(input: {
  claims: PgIdentityClaims;
}): Promise<PgResolution> {
  const { claims } = input;
  const email = claims.email?.toLowerCase();

  const [byAuthId, byUserId, byEmail] = (await Promise.all([
    claims.pgAuthId
      ? User.findOne({ pgAuthId: claims.pgAuthId }).select('_id isActive twoFactorEnabled').lean()
      : null,
    claims.pgUserId
      ? User.findOne({ pgUserId: claims.pgUserId }).select('_id isActive twoFactorEnabled').lean()
      : null,
    claims.emailVerified && email
      ? User.findOne({ email }).select('_id isActive twoFactorEnabled').lean()
      : null,
  ])) as Array<MatchedUser | null>;

  const decision = decideCandidate([
    byAuthId?._id?.toString(),
    byUserId?._id?.toString(),
    byEmail?._id?.toString(),
  ]);

  if (decision.kind === 'conflict') {
    logger.error('PG sign-in conflict: PG account matched multiple TopUpSend users; sign-in refused', {
      pgUserId: claims.pgUserId,
      matchedUserIds: decision.ids,
    });
    return { outcome: 'conflict' };
  }

  if (decision.kind === 'one') {
    const matched = [byAuthId, byUserId, byEmail].find(
      (doc) => doc?._id?.toString() === decision.id
    );
    if (matched && matched.isActive === false) return { outcome: 'inactive' };
    const link = await linkUserPgIdentity({
      userId: decision.id,
      pgUserId: claims.pgUserId,
      pgAuthId: claims.pgAuthId,
    });
    if (link.conflict) {
      logger.error('PG sign-in link conflict; sign-in refused', {
        userId: decision.id,
        field: link.conflict.field,
        existing: link.conflict.existing,
        incoming: link.conflict.incoming,
      });
      return { outcome: 'conflict' };
    }
    if (matched?.twoFactorEnabled) return { outcome: 'two-factor' };
    return { outcome: 'signed-in', userId: decision.id, created: false };
  }

  // No match at all.
  if (!claims.emailVerified || !email) {
    return { outcome: 'unverified-email' };
  }

  return provisionPgUser(claims, email);
}

/**
 * Provision a brand-new account for a verified PG identity,
 * mirroring the signup route record-for-record. Split out so the
 * race-recovery path can reuse the plain resolution outcome.
 */
async function provisionPgUser(
  claims: PgIdentityClaims,
  email: string
): Promise<PgResolution> {
  // Mirror the signup route: unique slug derived from the org name.
  const orgName = deriveOrgName(claims);
  const baseSlug = slugifyOrgName(orgName) || 'organization';
  let slug = baseSlug;
  let counter = 1;
  while (await Org.findOne({ slug })) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  const org = await Org.create({
    name: orgName,
    slug,
    settings: {},
    paymentProviders: [],
  });

  try {
    const user = await User.create({
      email,
      // Unusable credential: 32 random bytes, known to no one, hashed
      // by hashPassword like any password (signup does the same).
      passwordHash: await hashPassword(crypto.randomBytes(32).toString('hex')),
      roles: [UserRole.ADMIN], // First user of the org is admin, as in signup.
      orgId: org._id,
      isActive: true,
      pgUserId: claims.pgUserId,
      pgAuthId: claims.pgAuthId,
    });

    await UserOrganization.create({
      userId: user._id,
      orgId: org._id,
      roles: [UserRole.ADMIN],
      isActive: true,
      joinedAt: new Date(),
    });

    return { outcome: 'signed-in', userId: user._id.toString(), created: true };
  } catch (error) {
    // Unique email index — a concurrent first sign-in (or a signup)
    // won the race. Remove the org this attempt just created so the
    // loss leaves nothing behind, then re-resolve once against the
    // now-existing account.
    if ((error as { code?: number })?.code === 11000) {
      await Org.deleteOne({ _id: org._id }).catch(() => undefined);
      const existing = (await User.findOne({ email })
        .select('_id isActive twoFactorEnabled')
        .lean()) as MatchedUser | null;
      if (existing) {
        if (existing.isActive === false) return { outcome: 'inactive' };
        const link = await linkUserPgIdentity({
          userId: existing._id.toString(),
          pgUserId: claims.pgUserId,
          pgAuthId: claims.pgAuthId,
        });
        if (link.conflict) return { outcome: 'conflict' };
        if (existing.twoFactorEnabled) return { outcome: 'two-factor' };
        return { outcome: 'signed-in', userId: existing._id.toString(), created: false };
      }
    }
    throw error;
  }
}
