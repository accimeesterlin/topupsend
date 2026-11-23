import { UserOrganization } from "@topupsend/db";
import type { UserRole } from "@topupsend/types";
import { logger } from "@/lib/logger";

/**
 * RBAC C1 — session roles come from the live membership record, never
 * from the legacy global `User.roles` field.
 *
 * `User.roles` is written once at account creation and never updated
 * again, while per-org role administration (demote, remove) writes
 * only `UserOrganization`. Every session mint used to read the global
 * field, so a demoted member regained their original roles at their
 * next sign-in and a removed member regained access entirely — role
 * revocation was cosmetic. The org-switch route was the one correct
 * mint (roles from the membership); this helper makes every mint
 * behave that way.
 *
 * Resolution:
 * 1. The user's recorded default org (`user.orgId`) wins when an
 *    ACTIVE membership exists for it; the session carries that
 *    membership's current roles.
 * 2. Otherwise (no default recorded, or the default org's membership
 *    was deactivated) the most recent active membership is used and
 *    persisted back as the new default — the historical default-org
 *    fallback, now membership-bound as well.
 * 3. No active membership anywhere → null. Callers must refuse the
 *    sign-in: there is no organization this user may hold a session
 *    for.
 */
export interface MembershipSessionContext {
  orgId: string;
  roles: UserRole[];
}

interface SessionUserRecord {
  _id: unknown;
  orgId?: unknown;
  save: () => Promise<unknown>;
}

export async function resolveMembershipSession(
  user: SessionUserRecord,
): Promise<MembershipSessionContext | null> {
  const recordedOrgId = user.orgId ? String(user.orgId) : undefined;

  if (recordedOrgId) {
    const membership = await UserOrganization.findOne({
      userId: user._id,
      orgId: recordedOrgId,
      isActive: true,
    });
    if (membership) {
      return { orgId: recordedOrgId, roles: membership.roles };
    }
  }

  const fallback = await UserOrganization.findOne({
    userId: user._id,
    isActive: true,
  }).sort({ joinedAt: -1 });

  if (!fallback) {
    return null;
  }

  const orgId = String(fallback.orgId);
  if (orgId !== recordedOrgId) {
    try {
      (user as { orgId?: unknown }).orgId = orgId;
      await user.save();
    } catch (err) {
      // Non-fatal: the session still binds to the found membership;
      // only the persisted default-org convenience is lost.
      logger.warn("Failed to persist default orgId on user", {
        userId: String(user._id),
        error: err,
      });
    }
  }

  return { orgId, roles: fallback.roles };
}
