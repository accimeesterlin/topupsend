import crypto from "crypto";

/**
 * Shared two-factor helpers (staff + customer login flows).
 *
 * Security model (F-H1):
 * - A 2FA code can only be requested and verified inside a
 *   server-side "pending auth" state that is created exclusively by
 *   a successful password step. The pending state lives on the
 *   user/customer record (`twoFactorPendingId` /
 *   `twoFactorPendingExpires`); the browser carries only an
 *   HMAC-signed cookie naming that state. No password step, no code,
 *   no session — verify is not a standalone login.
 * - Codes are 6 digits from a CSPRNG over the full 000000–999999
 *   space and are stored as SHA-256 hashes bound to the account id,
 *   never in plaintext. Comparison is constant-time over the hashes.
 * - A code lives 10 minutes and tolerates at most
 *   TWO_FACTOR_MAX_ATTEMPTS wrong guesses; the attempt that reaches
 *   the limit destroys the code and the pending state, so the
 *   password step must be repeated.
 */

export const TWO_FACTOR_CODE_TTL_MS = 10 * 60 * 1000;
export const TWO_FACTOR_PENDING_TTL_MS = 10 * 60 * 1000;
export const TWO_FACTOR_MAX_ATTEMPTS = 5;

export const STAFF_PENDING_AUTH_COOKIE = "pending_2fa";
export const CUSTOMER_PENDING_AUTH_COOKIE = "customer_pending_2fa";

/** Generate a 6-digit code with a CSPRNG (full 000000–999999 space). */
export function generateTwoFactorCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/**
 * Hash a code for storage. SHA-256 over `subjectId:code`: fast by
 * design (the code is short-lived and attempt-limited) and bound to
 * the account, so a leaked hash cannot be replayed against another
 * account or precomputed independently of it.
 */
export function hashTwoFactorCode(subjectId: string, code: string): string {
  return crypto
    .createHash("sha256")
    .update(`${subjectId}:${code}`)
    .digest("hex");
}

/** Constant-time check of a presented code against the stored hash. */
export function twoFactorCodeMatches(
  subjectId: string,
  code: string,
  storedHash: string | undefined | null,
): boolean {
  if (!storedHash) return false;
  const candidate = Buffer.from(hashTwoFactorCode(subjectId, code));
  const stored = Buffer.from(storedHash);
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}

/** A fresh id for a pending-auth state. */
export function newPendingAuthId(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export interface PendingAuthCookiePayload {
  /** Subject id (user or customer) the pending state belongs to. */
  sub: string;
  /** Pending-state id; must equal the record's twoFactorPendingId. */
  jti: string;
  exp: number;
}

function hmac(secret: Uint8Array, data: string): string {
  return crypto
    .createHmac("sha256", Buffer.from(secret))
    .update(data)
    .digest("base64url");
}

/** Sign a pending-auth cookie value for the given subject/state. */
export function signPendingAuthCookie(
  payload: PendingAuthCookiePayload,
  secret: Uint8Array,
): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${hmac(secret, data)}`;
}

/**
 * Verify and decode a pending-auth cookie value. Returns null on any
 * problem — bad signature, malformed payload, expiry — and callers
 * treat null as "no pending auth", never as a partial state.
 */
export function verifyPendingAuthCookie(
  signed: string | undefined | null,
  secret: Uint8Array,
): PendingAuthCookiePayload | null {
  if (!signed) return null;
  try {
    const [data, sig] = signed.split(".");
    if (!data || !sig) return null;
    const expected = hmac(secret, data);
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expected);
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
    const payload = JSON.parse(
      Buffer.from(data, "base64url").toString(),
    ) as PendingAuthCookiePayload;
    if (!payload.sub || !payload.jti || !payload.exp) return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Set-Cookie value that installs a pending-auth cookie. */
export function createPendingAuthCookie(
  name: string,
  value: string,
): string {
  const isProduction = process.env.NODE_ENV === "production";
  const maxAge = Math.floor(TWO_FACTOR_PENDING_TTL_MS / 1000);
  return `${name}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${
    isProduction ? "; Secure" : ""
  }`;
}

/** Set-Cookie value that clears a pending-auth cookie. */
export function clearPendingAuthCookie(name: string): string {
  return `${name}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

/**
 * The server-side half of the pending-auth check: the record must
 * carry the same pending id the cookie names, and it must not have
 * expired. (Cookie signature/expiry are checked separately by
 * verifyPendingAuthCookie.)
 */
export function pendingAuthStateMatches(
  record: {
    twoFactorPendingId?: string | null;
    twoFactorPendingExpires?: Date | null;
  },
  payload: PendingAuthCookiePayload,
): boolean {
  if (!record.twoFactorPendingId || !record.twoFactorPendingExpires) {
    return false;
  }
  if (record.twoFactorPendingId !== payload.jti) return false;
  return new Date(record.twoFactorPendingExpires).getTime() > Date.now();
}
