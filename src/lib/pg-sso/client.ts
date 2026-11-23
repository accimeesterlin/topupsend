import crypto from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { PG_SSO_SCOPES, type PgSsoClientConfig } from './config';

/**
 * Sign in with PG — the OIDC relying-party client.
 *
 * A port of Servanzo's client (lib/pg-sso/client.ts there), which
 * talks to PG's provider exactly as the provider specifies:
 * discovery at `{issuer}/.well-known/openid-configuration` (the
 * endpoints live under /api/oauth/* on the issuer and are taken from
 * the discovery document, never hardcoded), authorize with PKCE S256
 * and nonce, token exchange with client_secret_basic, ID-token
 * verification against the issuer JWKS, and userinfo subject-matched
 * to the ID token. Claims: `sub` is the PG authId, `pg_user_id` the
 * PG User._id.
 *
 * TopUpSend stores NO PG tokens: the token response is used inside
 * the callback only — the ID token is verified, userinfo is fetched
 * with the access token, and both tokens are then dropped. Nothing in
 * this module returns an access or refresh token to callers.
 */

export interface PgDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
}

export interface PgIdentityClaims {
  /** PG authId — the OIDC `sub`. */
  pgAuthId: string;
  /** PG User._id — the stable cross-product link anchor. */
  pgUserId: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  givenName?: string;
  familyName?: string;
}

export class PgSsoError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'discovery_failed'
      | 'token_exchange_failed'
      | 'userinfo_failed'
      | 'id_token_invalid'
      | 'subject_mismatch'
  ) {
    super(message);
    this.name = 'PgSsoError';
  }
}

const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10 * 1000;
const discoveryCache = new Map<string, { doc: PgDiscovery; fetchedAt: number }>();

export async function fetchPgDiscovery(issuer: string): Promise<PgDiscovery> {
  const cached = discoveryCache.get(issuer);
  if (cached && cached.fetchedAt + DISCOVERY_TTL_MS > Date.now()) {
    return cached.doc;
  }
  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new PgSsoError(`PG discovery failed (${response.status})`, 'discovery_failed');
  }
  const doc = (await response.json()) as PgDiscovery;
  if (
    !doc.authorization_endpoint ||
    !doc.token_endpoint ||
    !doc.userinfo_endpoint ||
    !doc.jwks_uri ||
    doc.issuer.replace(/\/$/, '') !== issuer.replace(/\/$/, '')
  ) {
    throw new PgSsoError('PG discovery document is incomplete or for another issuer', 'discovery_failed');
  }
  discoveryCache.set(issuer, { doc, fetchedAt: Date.now() });
  return doc;
}

/** Test seam: drop the cached discovery document for an issuer. */
export function clearPgDiscoveryCache(): void {
  discoveryCache.clear();
}

/**
 * The issuer's JWKS set, cached per jwks_uri: jose only caches keys
 * per set instance, so minting a fresh set per sign-in would refetch
 * the key set on every callback.
 */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(jwksUri: string): ReturnType<typeof createRemoteJWKSet> {
  let set = jwksCache.get(jwksUri);
  if (!set) {
    set = createRemoteJWKSet(new URL(jwksUri));
    jwksCache.set(jwksUri, set);
  }
  return set;
}

/** Test seam: drop cached JWKS sets. */
export function clearPgJwksCache(): void {
  jwksCache.clear();
}

/** PKCE S256 challenge for a verifier minted into the state cookie. */
export function computeCodeChallenge(codeVerifier: string): string {
  return crypto.createHash('sha256').update(codeVerifier).digest('base64url');
}

export function buildPgAuthorizeUrl(input: {
  discovery: PgDiscovery;
  config: PgSsoClientConfig;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {
  const url = new URL(input.discovery.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.config.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', PG_SSO_SCOPES);
  url.searchParams.set('state', input.state);
  url.searchParams.set('nonce', input.nonce);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

interface TokenResponse {
  id_token: string;
  access_token: string;
}

/**
 * Exchange the authorization code. Returns ONLY the two short-lived
 * artifacts the callback consumes immediately; the refresh token PG
 * may include is deliberately not even parsed — TopUpSend never asks
 * for `offline_access` and keeps no PG credential.
 */
async function exchangeCode(input: {
  discovery: PgDiscovery;
  config: PgSsoClientConfig;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  const basic = Buffer.from(
    `${encodeURIComponent(input.config.clientId)}:${encodeURIComponent(input.config.clientSecret)}`
  ).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });
  const response = await fetch(input.discovery.token_endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${basic}`,
    },
    body: body.toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new PgSsoError(`PG token exchange failed (${response.status})`, 'token_exchange_failed');
  }
  const json = (await response.json()) as Partial<TokenResponse>;
  if (!json.id_token || !json.access_token) {
    throw new PgSsoError('PG token response is missing tokens', 'token_exchange_failed');
  }
  return { id_token: json.id_token, access_token: json.access_token };
}

function claimsFromPayload(payload: Record<string, unknown>): PgIdentityClaims {
  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  const pgUserId = typeof payload.pg_user_id === 'string' ? payload.pg_user_id : '';
  if (!sub || !pgUserId) {
    throw new PgSsoError('PG identity is missing sub/pg_user_id', 'id_token_invalid');
  }
  return {
    pgAuthId: sub,
    pgUserId,
    email: typeof payload.email === 'string' ? payload.email.toLowerCase() : undefined,
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    givenName: typeof payload.given_name === 'string' ? payload.given_name : undefined,
    familyName: typeof payload.family_name === 'string' ? payload.family_name : undefined,
  };
}

async function verifyIdToken(input: {
  discovery: PgDiscovery;
  config: PgSsoClientConfig;
  idToken: string;
  nonce: string;
}): Promise<Record<string, unknown>> {
  const jwks = jwksFor(input.discovery.jwks_uri);
  try {
    const { payload } = await jwtVerify(input.idToken, jwks, {
      issuer: input.discovery.issuer,
      audience: input.config.clientId,
      algorithms: ['RS256'],
    });
    if (payload.nonce !== input.nonce) {
      throw new PgSsoError('PG ID token nonce does not match the request', 'id_token_invalid');
    }
    return payload as Record<string, unknown>;
  } catch (error) {
    if (error instanceof PgSsoError) throw error;
    throw new PgSsoError(
      `PG ID token verification failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      'id_token_invalid'
    );
  }
}

async function fetchUserinfo(input: {
  discovery: PgDiscovery;
  accessToken: string;
}): Promise<Record<string, unknown>> {
  const response = await fetch(input.discovery.userinfo_endpoint, {
    headers: { authorization: `Bearer ${input.accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new PgSsoError(`PG userinfo failed (${response.status})`, 'userinfo_failed');
  }
  return (await response.json()) as Record<string, unknown>;
}

/**
 * The full callback-side validation: exchange the code, verify the ID
 * token against the issuer's JWKS (signature, issuer, audience,
 * nonce), fetch userinfo with the access token, and require both to
 * name the same subject. The operative claims come from userinfo
 * (PG builds both from the same claims builder, and userinfo also
 * proves the grant is still live). Tokens end their life here.
 */
export async function validatePgCallback(input: {
  config: PgSsoClientConfig;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  nonce: string;
}): Promise<PgIdentityClaims> {
  const discovery = await fetchPgDiscovery(input.config.issuer);
  const tokens = await exchangeCode({
    discovery,
    config: input.config,
    code: input.code,
    redirectUri: input.redirectUri,
    codeVerifier: input.codeVerifier,
  });
  const [idPayload, userinfo] = await Promise.all([
    verifyIdToken({
      discovery,
      config: input.config,
      idToken: tokens.id_token,
      nonce: input.nonce,
    }),
    fetchUserinfo({ discovery, accessToken: tokens.access_token }),
  ]);
  if (userinfo.sub !== idPayload.sub) {
    throw new PgSsoError('PG userinfo subject does not match the ID token', 'subject_mismatch');
  }
  return claimsFromPayload(userinfo);
}
