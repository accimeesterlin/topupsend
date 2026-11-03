import crypto from 'crypto';

/**
 * Sign in with PG — the SSO state cookie.
 *
 * Ported from Servanzo (lib/pg-sso/state.ts there). TopUpSend has a
 * single PG sign-in flow (the main login), so the payload carries
 * only what that flow needs: the anti-CSRF `state`, the ID-token
 * `nonce`, the PKCE verifier, and the in-app path to land on after
 * sign-in. There is no server-side anonymous session store here;
 * this cookie is the store.
 *
 * The cookie is short-lived (10 minutes), httpOnly, and HMAC-signed
 * with the app's session secret — the same JWT_SECRET src/lib/auth.ts
 * signs session tokens with, fallback included, so the two trust
 * roots stay one. Single-use: the callback clears it on every
 * terminal outcome, success or failure.
 */

export const PG_SSO_STATE_COOKIE_NAME = 'pg_sso_state';
export const PG_SSO_STATE_TTL_MS = 10 * 60 * 1000;

export interface PgSsoStatePayload {
  state: string;
  nonce: string;
  codeVerifier: string;
  /** Sanitized in-app path to land on after sign-in. */
  returnTo?: string;
  expiresAt: number;
}

function getStateSecret(): string {
  // Same secret (and same development fallback) as src/lib/auth.ts.
  return process.env.JWT_SECRET || 'your-secret-key-change-in-production';
}

export function signPgSsoState(payload: PgSsoStatePayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getStateSecret())
    .update(data)
    .digest('base64url');
  return `${data}.${sig}`;
}

/**
 * Verify and decode a state cookie. Returns null on any problem —
 * bad signature, malformed payload, expiry — and callers treat null
 * as "abort the flow", never as a partial state.
 */
export function verifyPgSsoState(signed: string): PgSsoStatePayload | null {
  try {
    const [data, sig] = signed.split('.');
    if (!data || !sig) return null;
    const expected = crypto
      .createHmac('sha256', getStateSecret())
      .update(data)
      .digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString()) as PgSsoStatePayload;
    if (payload.expiresAt < Date.now()) return null;
    if (!payload.state || !payload.nonce || !payload.codeVerifier) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Constant-time comparison for the `state` round-trip check. */
export function pgSsoStateMatches(expected: string, presented: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function newPgSsoStatePayload(
  partial: Omit<PgSsoStatePayload, 'state' | 'nonce' | 'codeVerifier' | 'expiresAt'> &
    Partial<Pick<PgSsoStatePayload, 'state' | 'nonce' | 'codeVerifier'>>
): PgSsoStatePayload {
  const { state, nonce, codeVerifier, ...context } = partial;
  return {
    ...context,
    state: state ?? crypto.randomBytes(32).toString('base64url'),
    nonce: nonce ?? crypto.randomBytes(32).toString('base64url'),
    codeVerifier: codeVerifier ?? crypto.randomBytes(32).toString('base64url'),
    expiresAt: Date.now() + PG_SSO_STATE_TTL_MS,
  };
}
