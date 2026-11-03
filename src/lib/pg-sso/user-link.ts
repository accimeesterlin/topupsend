import mongoose from 'mongoose';
import { User } from '@topupsend/db';

export interface PgIdentityConflict {
  field: 'pgUserId' | 'pgAuthId';
  existing: string;
  incoming: string;
}

export interface LinkUserPgIdentityResult {
  linked: boolean;
  linkedFields: Array<'pgUserId' | 'pgAuthId'>;
  conflict?: PgIdentityConflict;
}

/**
 * Link a TopUpSend User to the PG account they signed in with.
 * Ported from Servanzo (lib/pg-sso/user-link.ts there); same
 * discipline:
 *
 * - `pgUserId` is the anchor: a call without it links nothing.
 * - First-write-wins per field: a still-empty field is filled (the
 *   authId can arrive after the user id), a stored value is NEVER
 *   overwritten.
 * - A stored value that disagrees with the presented one refuses the
 *   link wholesale and reports the conflict; the caller treats that
 *   as a hard stop — no session.
 *
 * Only the PG SSO callback may call this — the ids must come from a
 * verified PG ID token / userinfo response, never from browser
 * parameters.
 */
export async function linkUserPgIdentity(input: {
  userId: string;
  pgUserId?: string | null;
  pgAuthId?: string | null;
}): Promise<LinkUserPgIdentityResult> {
  const pgUserId = input.pgUserId?.trim() || undefined;
  const pgAuthId = input.pgAuthId?.trim() || undefined;
  if (!pgUserId) {
    return { linked: false, linkedFields: [] };
  }

  // The lean() result is cast explicitly: importing the model
  // through the @topupsend/db index loses the document generic.
  const user = (await User.findOne({
    _id: new mongoose.Types.ObjectId(input.userId),
  })
    .select('pgUserId pgAuthId')
    .lean()) as unknown as {
    _id: mongoose.Types.ObjectId;
    pgUserId?: string;
    pgAuthId?: string;
  } | null;
  if (!user) {
    return { linked: false, linkedFields: [] };
  }

  if (user.pgUserId && user.pgUserId !== pgUserId) {
    return {
      linked: false,
      linkedFields: [],
      conflict: { field: 'pgUserId', existing: user.pgUserId, incoming: pgUserId },
    };
  }
  if (pgAuthId && user.pgAuthId && user.pgAuthId !== pgAuthId) {
    return {
      linked: false,
      linkedFields: [],
      conflict: { field: 'pgAuthId', existing: user.pgAuthId, incoming: pgAuthId },
    };
  }

  const $set: { pgUserId?: string; pgAuthId?: string } = {};
  const linkedFields: Array<'pgUserId' | 'pgAuthId'> = [];
  if (!user.pgUserId) {
    $set.pgUserId = pgUserId;
    linkedFields.push('pgUserId');
  }
  if (pgAuthId && !user.pgAuthId) {
    $set.pgAuthId = pgAuthId;
    linkedFields.push('pgAuthId');
  }
  if (linkedFields.length === 0) {
    return { linked: false, linkedFields: [] };
  }

  // Re-anchor the write on the stored user id so a concurrent first
  // link cannot be clobbered (same guard as Servanzo's link).
  await User.updateOne(
    {
      _id: user._id,
      $or: [{ pgUserId: { $exists: false } }, { pgUserId: null }, { pgUserId }],
    },
    { $set }
  );
  return { linked: true, linkedFields };
}
