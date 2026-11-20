import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { dbConnection } from '@topupsend/db';
import { getPgSsoConfig } from '@/lib/pg-sso/config';
import { validatePgCallback } from '@/lib/pg-sso/client';
import {
  PG_SSO_STATE_COOKIE_NAME,
  pgSsoStateMatches,
  verifyPgSsoState,
} from '@/lib/pg-sso/state';
import { resolvePgUser } from '@/lib/pg-sso/user-resolve';
import { createPgUserSessionToken } from '@/lib/pg-sso/session';
import { logger } from '@/lib/logger';

/**
 * Sign in with PG — the callback.
 *
 * GET /api/auth/pg/callback?code&state — the flow context is
 * recovered from the signed state cookie, never from the URL. The
 * state cookie is single-use: it is cleared the moment the
 * round-trip is proven to be ours, and on every terminal outcome
 * after that.
 *
 * Outcomes:
 * - success → TopUpSend's ordinary session (the same JWT `session`
 *   cookie the password login sets, minted by
 *   lib/pg-sso/session.ts — this app needs no ticket bridge because
 *   its session is a plain cookie, not a framework sign-in) and a
 *   redirect to the flow's return path;
 * - any failure → /login?pg_error=<reason> with a plain-language
 *   message on the login page. No session is ever minted on a
 *   failure path.
 */

type PgErrorReason =
  | 'conflict'
  | 'verify-email'
  | 'inactive'
  | 'two-factor'
  | 'denied'
  | 'unavailable'
  | 'failed';

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const cookieStore = await cookies();
  const rawState = cookieStore.get(PG_SSO_STATE_COOKIE_NAME)?.value;
  const payload = rawState ? verifyPgSsoState(rawState) : null;

  const fail = (reason: PgErrorReason): NextResponse => {
    cookieStore.delete(PG_SSO_STATE_COOKIE_NAME);
    return NextResponse.redirect(new URL(`/login?pg_error=${reason}`, origin));
  };

  if (!payload) {
    return fail('failed');
  }

  try {
    // PG sent the user back with an error (e.g. consent denied).
    const errorParam = request.nextUrl.searchParams.get('error');
    if (errorParam) {
      return fail(errorParam === 'access_denied' ? 'denied' : 'failed');
    }

    const code = request.nextUrl.searchParams.get('code');
    const stateParam = request.nextUrl.searchParams.get('state');
    if (!code || !stateParam || !pgSsoStateMatches(payload.state, stateParam)) {
      return fail('failed');
    }

    // The round-trip is proven ours — consume the state cookie now so
    // this callback URL can never be replayed.
    cookieStore.delete(PG_SSO_STATE_COOKIE_NAME);

    const config = getPgSsoConfig();
    if (!config) {
      return fail('unavailable');
    }

    await dbConnection.connect();

    // Fully validated PG identity: code exchanged server-to-server,
    // ID token verified against the issuer JWKS, userinfo fetched and
    // subject-matched. PG tokens are dropped inside validatePgCallback.
    const claims = await validatePgCallback({
      config,
      code,
      redirectUri: `${origin}/api/auth/pg/callback`,
      codeVerifier: payload.codeVerifier,
      nonce: payload.nonce,
    });

    const resolution = await resolvePgUser({ claims });
    if (resolution.outcome === 'conflict') return fail('conflict');
    if (resolution.outcome === 'unverified-email') return fail('verify-email');
    if (resolution.outcome === 'inactive') return fail('inactive');
    if (resolution.outcome === 'two-factor') return fail('two-factor');

    const token = await createPgUserSessionToken(resolution.userId);
    if (!token) return fail('failed');

    // The ordinary session cookie — same name and attributes
    // createSessionCookie (src/lib/auth.ts) gives the password login.
    cookieStore.set('session', token, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
      secure: process.env.NODE_ENV === 'production',
    });
    return NextResponse.redirect(new URL(payload.returnTo ?? '/dashboard', origin));
  } catch (error) {
    logger.error('PG sign-in callback failed', { error });
    return fail('failed');
  }
}
