/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';

jest.mock('next/headers', () => {
  const jar = new Map<string, string>();
  const store = {
    jar,
    get: jest.fn((name: string) =>
      jar.has(name) ? { name, value: jar.get(name) as string } : undefined
    ),
    set: jest.fn((name: string, value: string) => {
      jar.set(name, value);
    }),
    delete: jest.fn((name: string) => {
      jar.delete(name);
    }),
  };
  return { cookies: async () => store, __store: store };
});

jest.mock('@topupsend/db', () => ({
  dbConnection: { connect: jest.fn(async () => undefined) },
}));

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('@/lib/pg-sso/client', () => ({
  fetchPgDiscovery: jest.fn(async () => ({
    issuer: 'https://sandbox.pgecom.com',
    authorization_endpoint: 'https://sandbox.pgecom.com/oauth/authorize',
    token_endpoint: 'https://sandbox.pgecom.com/oauth/token',
    userinfo_endpoint: 'https://sandbox.pgecom.com/oauth/userinfo',
    jwks_uri: 'https://sandbox.pgecom.com/oauth/jwks',
  })),
  buildPgAuthorizeUrl: jest.fn(
    (input: { state: string }) =>
      `https://sandbox.pgecom.com/oauth/authorize?state=${input.state}`
  ),
  computeCodeChallenge: jest.fn((v: string) => `challenge:${v}`),
  validatePgCallback: jest.fn(),
}));

jest.mock('@/lib/pg-sso/user-resolve', () => ({ resolvePgUser: jest.fn() }));
jest.mock('@/lib/pg-sso/session', () => ({ createPgUserSessionToken: jest.fn() }));

import { GET as startGET } from '@/app/api/auth/pg/start/route';
import { GET as callbackGET } from '@/app/api/auth/pg/callback/route';
import { fetchPgDiscovery, validatePgCallback } from '@/lib/pg-sso/client';
import { resolvePgUser } from '@/lib/pg-sso/user-resolve';
import { createPgUserSessionToken } from '@/lib/pg-sso/session';
import {
  PG_SSO_STATE_COOKIE_NAME,
  newPgSsoStatePayload,
  signPgSsoState,
  verifyPgSsoState,
} from '@/lib/pg-sso/state';

const cookieStore = (
  jest.requireMock('next/headers') as { __store: {
    jar: Map<string, string>;
    get: jest.Mock;
    set: jest.Mock;
    delete: jest.Mock;
  } }
).__store;

const validateMock = validatePgCallback as unknown as jest.Mock;
const discoveryMock = fetchPgDiscovery as unknown as jest.Mock;
const resolveMock = resolvePgUser as unknown as jest.Mock;
const sessionMock = createPgUserSessionToken as unknown as jest.Mock;

const ORIGIN = 'http://localhost:3000';
const ENV_KEYS = ['PG_SSO_SANDBOX_CLIENT_ID', 'PG_SSO_SANDBOX_CLIENT_SECRET'] as const;
let savedEnv: Record<string, string | undefined>;

function configureEnv() {
  process.env.PG_SSO_SANDBOX_CLIENT_ID = 'topupsend-sandbox';
  process.env.PG_SSO_SANDBOX_CLIENT_SECRET = 'sandbox-secret';
}

function seedStateCookie(overrides: { returnTo?: string } = {}) {
  const payload = newPgSsoStatePayload({
    returnTo: overrides.returnTo ?? '/dashboard',
    state: 'state-xyz',
    nonce: 'nonce-xyz',
    codeVerifier: 'verifier-xyz',
  });
  cookieStore.jar.set(PG_SSO_STATE_COOKIE_NAME, signPgSsoState(payload));
  return payload;
}

beforeEach(() => {
  jest.clearAllMocks();
  cookieStore.jar.clear();
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('GET /api/auth/pg/start', () => {
  it('refuses back to login while the PG client env is unset', async () => {
    const response = await startGET(new NextRequest(`${ORIGIN}/api/auth/pg/start`));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login?pg_error=unavailable`);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(discoveryMock).not.toHaveBeenCalled();
  });

  it('mints the state cookie and redirects to PG when configured', async () => {
    configureEnv();
    const response = await startGET(new NextRequest(`${ORIGIN}/api/auth/pg/start`));
    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location.startsWith('https://sandbox.pgecom.com/oauth/authorize?state=')).toBe(true);

    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${PG_SSO_STATE_COOKIE_NAME}=`);
    expect(setCookie).toContain('HttpOnly');
    const cookieValue = setCookie
      .split(';')[0]
      .slice(PG_SSO_STATE_COOKIE_NAME.length + 1);
    const payload = verifyPgSsoState(decodeURIComponent(cookieValue));
    expect(payload).not.toBeNull();
    expect(payload?.returnTo).toBe('/dashboard');
    // The state in the authorize URL is the state in the cookie.
    expect(location).toContain(`state=${payload?.state}`);
  });

  it('sanitizes the callbackUrl: in-app paths pass, external URLs fall back', async () => {
    configureEnv();
    const internal = await startGET(
      new NextRequest(`${ORIGIN}/api/auth/pg/start?callbackUrl=/settings`)
    );
    const internalCookie = internal.headers.get('set-cookie') ?? '';
    const internalValue = internalCookie.split(';')[0].split('=').slice(1).join('=');
    expect(verifyPgSsoState(decodeURIComponent(internalValue))?.returnTo).toBe('/settings');

    const external = await startGET(
      new NextRequest(
        `${ORIGIN}/api/auth/pg/start?callbackUrl=${encodeURIComponent('https://evil.example')}`
      )
    );
    const externalCookie = external.headers.get('set-cookie') ?? '';
    const externalValue = externalCookie.split(';')[0].split('=').slice(1).join('=');
    expect(verifyPgSsoState(decodeURIComponent(externalValue))?.returnTo).toBe('/dashboard');
  });

  it('lands back on login when discovery fails', async () => {
    configureEnv();
    discoveryMock.mockRejectedValueOnce(new Error('issuer down'));
    const response = await startGET(new NextRequest(`${ORIGIN}/api/auth/pg/start`));
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login?pg_error=failed`);
  });
});

describe('GET /api/auth/pg/callback', () => {
  const CLAIMS = {
    pgAuthId: 'auth-id-1',
    pgUserId: 'pg-user-1',
    email: 'owner@example.com',
    emailVerified: true,
  };

  function callbackRequest(query: string) {
    return new NextRequest(`${ORIGIN}/api/auth/pg/callback?${query}`);
  }

  it('fails closed with no state cookie — and never mints a session', async () => {
    configureEnv();
    const response = await callbackGET(callbackRequest('code=code-1&state=state-xyz'));
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login?pg_error=failed`);
    expect(validateMock).not.toHaveBeenCalled();
    expect(cookieStore.set).not.toHaveBeenCalledWith(
      'session',
      expect.anything(),
      expect.anything()
    );
  });

  it('maps a PG access_denied back to the denied reason and consumes the cookie', async () => {
    configureEnv();
    seedStateCookie();
    const response = await callbackGET(callbackRequest('error=access_denied&state=state-xyz'));
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login?pg_error=denied`);
    expect(cookieStore.jar.has(PG_SSO_STATE_COOKIE_NAME)).toBe(false);
    expect(validateMock).not.toHaveBeenCalled();
  });

  it('rejects a state mismatch before any token exchange', async () => {
    configureEnv();
    seedStateCookie();
    const response = await callbackGET(callbackRequest('code=code-1&state=WRONG'));
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login?pg_error=failed`);
    expect(validateMock).not.toHaveBeenCalled();
  });

  it('reports unavailable when the env was removed mid-flow', async () => {
    seedStateCookie();
    const response = await callbackGET(callbackRequest('code=code-1&state=state-xyz'));
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login?pg_error=unavailable`);
    expect(validateMock).not.toHaveBeenCalled();
  });

  it('happy path: validates, resolves, sets the ordinary session, redirects to returnTo', async () => {
    configureEnv();
    seedStateCookie({ returnTo: '/settings' });
    validateMock.mockResolvedValue(CLAIMS);
    resolveMock.mockResolvedValue({ outcome: 'signed-in', userId: 'user-1', created: false });
    sessionMock.mockResolvedValue('session-token-123');

    const response = await callbackGET(callbackRequest('code=code-1&state=state-xyz'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/settings`);
    expect(validateMock).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'code-1', codeVerifier: 'verifier-xyz', nonce: 'nonce-xyz' })
    );
    expect(cookieStore.set).toHaveBeenCalledWith(
      'session',
      'session-token-123',
      expect.objectContaining({ httpOnly: true, path: '/', sameSite: 'lax' })
    );
    // State cookie consumed — the callback URL cannot be replayed.
    expect(cookieStore.jar.has(PG_SSO_STATE_COOKIE_NAME)).toBe(false);
  });

  it.each([
    ['conflict', 'conflict'],
    ['unverified-email', 'verify-email'],
    ['inactive', 'inactive'],
    ['two-factor', 'two-factor'],
  ])('maps the %s resolution to pg_error=%s with no session', async (outcome, reason) => {
    configureEnv();
    seedStateCookie();
    validateMock.mockResolvedValue(CLAIMS);
    resolveMock.mockResolvedValue({ outcome });
    const response = await callbackGET(callbackRequest('code=code-1&state=state-xyz'));
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login?pg_error=${reason}`);
    expect(sessionMock).not.toHaveBeenCalled();
    expect(cookieStore.set).not.toHaveBeenCalledWith(
      'session',
      expect.anything(),
      expect.anything()
    );
  });
});
