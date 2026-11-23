import type { PgIdentityClaims } from './client';

/**
 * Shared pieces of the PG sign-in account resolution, ported from
 * Servanzo (lib/pg-sso/resolve-shared.ts there).
 */

/**
 * The match matrix's arbitration step. The chain looks the PG
 * identity up by pgAuthId, then pgUserId, then (verified) email.
 * Whatever those lookups find must name ONE account:
 *
 * - exactly one distinct account → that account proceeds to linking;
 * - no account at all → no-match (the caller may auto-provision, or
 *   hard-stop when the email is unverified);
 * - two or more DISTINCT accounts → conflict. This is the case that
 *   matters most: the PG identity matches account A while its
 *   verified email belongs to account B. Signing in as either would
 *   hand one person's session to another's record, and creating a
 *   third account would fork the identity — so the flow hard-stops
 *   and never auto-merges.
 */
export type CandidateDecision =
  | { kind: 'one'; id: string }
  | { kind: 'none' }
  | { kind: 'conflict'; ids: string[] };

export function decideCandidate(
  foundIds: Array<string | null | undefined>
): CandidateDecision {
  const distinct = [...new Set(foundIds.filter((id): id is string => Boolean(id)))];
  if (distinct.length === 0) return { kind: 'none' };
  if (distinct.length === 1) return { kind: 'one', id: distinct[0] };
  return { kind: 'conflict', ids: distinct };
}

/**
 * Organization name for an auto-provisioned account. TopUpSend's
 * signup asks the user for an organization name; a PG sign-in has no
 * such prompt, so the name is derived from the PG profile — the
 * display name (or given + family names) first, the email local part
 * as the fallback — and is always a non-empty string the owner can
 * rename later in settings.
 */
export function deriveOrgName(claims: PgIdentityClaims): string {
  const displayName =
    claims.name?.trim() ||
    [claims.givenName?.trim(), claims.familyName?.trim()].filter(Boolean).join(' ') ||
    (claims.email ?? '').split('@')[0]?.trim() ||
    '';
  return displayName ? `${displayName}'s Organization` : 'My Organization';
}

/** The slug base the signup route derives from an organization name. */
export function slugifyOrgName(orgName: string): string {
  return orgName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
