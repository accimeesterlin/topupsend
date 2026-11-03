import { NextRequest, NextResponse } from 'next/server';
import { getPgSsoConfig } from '@/lib/pg-sso/config';
import { buildPgAuthorizeUrl, computeCodeChallenge, fetchPgDiscovery } from '@/lib/pg-sso/client';
import {
  PG_SSO_STATE_COOKIE_NAME,
  PG_SSO_STATE_TTL_MS,
  newPgSsoStatePayload,
  signPgSsoState,
} from '@/lib/pg-sso/state';
import { logger } from '@/lib/logger';

/**
 * Sign in with PG — flow start.
 *
 * GET /api/auth/pg/start[?callbackUrl=<in-app path>]
 *
 * Mints the state/nonce/PKCE triple into the signed state cookie and
 * 302s to PG's authorize endpoint. While the PG client env is unset
 * the feature is off and this refuses like any unavailable surface —
 * back to the login page with a plain reason, never a raw error.
 */

/** Same rule Servanzo's main login applies to its callbackUrl param. */
function sanitizeReturnTo(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/dashboard';
}

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const config = getPgSsoConfig();
  if (!config) {
    return NextResponse.redirect(new URL('/login?pg_error=unavailable', origin));
  }
  try {
    const discovery = await fetchPgDiscovery(config.issuer);
    const payload = newPgSsoStatePayload({
      returnTo: sanitizeReturnTo(request.nextUrl.searchParams.get('callbackUrl')),
    });
    const redirectUri = `${origin}/api/auth/pg/callback`;
    const authorizeUrl = buildPgAuthorizeUrl({
      discovery,
      config,
      redirectUri,
      state: payload.state,
      nonce: payload.nonce,
      codeChallenge: computeCodeChallenge(payload.codeVerifier),
    });
    const response = NextResponse.redirect(authorizeUrl);
    response.cookies.set(PG_SSO_STATE_COOKIE_NAME, signPgSsoState(payload), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(PG_SSO_STATE_TTL_MS / 1000),
    });
    return response;
  } catch (error) {
    logger.error('PG sign-in start failed', { error });
    return NextResponse.redirect(new URL('/login?pg_error=failed', origin));
  }
}
