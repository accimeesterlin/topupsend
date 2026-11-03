/**
 * @jest-environment node
 *
 * This suite runs a fake PG issuer on a local HTTP server instead of
 * stubbing fetch: TopUpSend's jose v5 Node build fetches the JWKS
 * with node:https/node:http directly (Servanzo's jose v6 webapi
 * build uses fetch, which is why its suite can stub fetch). Serving
 * real HTTP exercises the client's exact production code path —
 * discovery, token exchange, JWKS retrieval, verification, userinfo.
 */
import http from 'http';
import type { AddressInfo } from 'net';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import {
  PgSsoError,
  buildPgAuthorizeUrl,
  clearPgDiscoveryCache,
  clearPgJwksCache,
  computeCodeChallenge,
  fetchPgDiscovery,
  validatePgCallback,
  type PgDiscovery,
} from './client';
import type { PgSsoClientConfig } from './config';

const REDIRECT_URI = 'https://sandbox.topupsend.com/api/auth/pg/callback';
const NONCE = 'nonce-abc';

let server: http.Server;
let baseUrl: string;
let config: PgSsoClientConfig;
let discovery: PgDiscovery;
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let publicJwk: Record<string, unknown>;

interface IssuerBehavior {
  idToken?: string;
  userinfo?: Record<string, unknown>;
  tokenStatus?: number;
}
let behavior: IssuerBehavior = {};
const issuerCalls: Array<{ path: string; headers: http.IncomingHttpHeaders; body: string }> = [];

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'pg-auth-1', alg: 'RS256' };

  server = http.createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => {
      issuerCalls.push({
        path,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      if (path === '/.well-known/openid-configuration') {
        return sendJson(res, 200, discovery);
      }
      if (path === '/oauth/token') {
        if (behavior.tokenStatus && behavior.tokenStatus !== 200) {
          return sendJson(res, behavior.tokenStatus, { error: 'invalid_grant' });
        }
        return sendJson(res, 200, {
          access_token: 'access-token-1',
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: behavior.idToken,
          // Present in the wire response; the client must never retain it.
          refresh_token: 'refresh-token-must-be-dropped',
        });
      }
      if (path === '/oauth/jwks') {
        return sendJson(res, 200, { keys: [publicJwk] });
      }
      if (path === '/oauth/userinfo') {
        return sendJson(
          res,
          200,
          behavior.userinfo ?? {
            sub: 'auth-id-1',
            pg_user_id: 'pg-user-1',
            email: 'user@example.com',
            email_verified: true,
            name: 'User Example',
            given_name: 'User',
            family_name: 'Example',
          }
        );
      }
      return sendJson(res, 404, { error: 'not_found' });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  config = { issuer: baseUrl, clientId: 'topupsend-sandbox', clientSecret: 'sandbox-secret' };
  discovery = {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    userinfo_endpoint: `${baseUrl}/oauth/userinfo`,
    jwks_uri: `${baseUrl}/oauth/jwks`,
  };
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  behavior = {};
  issuerCalls.length = 0;
  clearPgDiscoveryCache();
  clearPgJwksCache();
});

async function mintIdToken(overrides: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT({
    pg_user_id: 'pg-user-1',
    nonce: NONCE,
    email: 'user@example.com',
    email_verified: true,
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'pg-auth-1' })
    .setIssuer(baseUrl)
    .setAudience(config.clientId)
    .setSubject('auth-id-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

describe('buildPgAuthorizeUrl', () => {
  it('builds the authorize URL with PKCE S256, state and nonce', () => {
    const url = new URL(
      buildPgAuthorizeUrl({
        discovery,
        config,
        redirectUri: REDIRECT_URI,
        state: 'state-1',
        nonce: NONCE,
        codeChallenge: computeCodeChallenge('verifier-1'),
      })
    );
    expect(url.origin + url.pathname).toBe(discovery.authorization_endpoint);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('topupsend-sandbox');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(url.searchParams.get('scope')).toBe('openid profile email');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('nonce')).toBe(NONCE);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(computeCodeChallenge('verifier-1'));
  });
});

describe('fetchPgDiscovery', () => {
  it('fetches and caches the discovery document', async () => {
    const first = await fetchPgDiscovery(baseUrl);
    const second = await fetchPgDiscovery(baseUrl);
    expect(first).toEqual(discovery);
    expect(second).toEqual(discovery);
    expect(
      issuerCalls.filter((c) => c.path === '/.well-known/openid-configuration')
    ).toHaveLength(1);
  });
});

describe('validatePgCallback', () => {
  it('exchanges the code with client_secret_basic + PKCE and returns userinfo claims', async () => {
    behavior.idToken = await mintIdToken();
    const claims = await validatePgCallback({
      config,
      code: 'code-1',
      redirectUri: REDIRECT_URI,
      codeVerifier: 'verifier-1',
      nonce: NONCE,
    });
    expect(claims).toEqual({
      pgAuthId: 'auth-id-1',
      pgUserId: 'pg-user-1',
      email: 'user@example.com',
      emailVerified: true,
      name: 'User Example',
      givenName: 'User',
      familyName: 'Example',
    });
    const tokenCall = issuerCalls.find((c) => c.path === '/oauth/token');
    expect(tokenCall?.headers.authorization).toBe(
      `Basic ${Buffer.from('topupsend-sandbox:sandbox-secret').toString('base64')}`
    );
    const body = new URLSearchParams(tokenCall?.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('code-1');
    expect(body.get('code_verifier')).toBe('verifier-1');
    expect(body.get('redirect_uri')).toBe(REDIRECT_URI);
    // The JWKS really was retrieved over HTTP.
    expect(issuerCalls.some((c) => c.path === '/oauth/jwks')).toBe(true);
  });

  it('does not surface any PG token in its result', async () => {
    behavior.idToken = await mintIdToken();
    const claims = await validatePgCallback({
      config,
      code: 'code-1',
      redirectUri: REDIRECT_URI,
      codeVerifier: 'verifier-1',
      nonce: NONCE,
    });
    expect(JSON.stringify(claims)).not.toContain('access-token-1');
    expect(JSON.stringify(claims)).not.toContain('refresh-token-must-be-dropped');
  });

  it('rejects an ID token with the wrong nonce', async () => {
    behavior.idToken = await mintIdToken({ nonce: 'someone-elses-nonce' });
    await expect(
      validatePgCallback({
        config,
        code: 'code-1',
        redirectUri: REDIRECT_URI,
        codeVerifier: 'verifier-1',
        nonce: NONCE,
      })
    ).rejects.toMatchObject({ code: 'id_token_invalid' });
  });

  it('rejects an ID token minted for another audience', async () => {
    behavior.idToken = await mintIdToken();
    await expect(
      validatePgCallback({
        config: { ...config, clientId: 'a-different-client' },
        code: 'code-1',
        redirectUri: REDIRECT_URI,
        codeVerifier: 'verifier-1',
        nonce: NONCE,
      })
    ).rejects.toBeInstanceOf(PgSsoError);
  });

  it('rejects a token signed by a different key', async () => {
    const other = await generateKeyPair('RS256');
    behavior.idToken = await new SignJWT({ pg_user_id: 'pg-user-1', nonce: NONCE })
      .setProtectedHeader({ alg: 'RS256', kid: 'pg-auth-1' })
      .setIssuer(baseUrl)
      .setAudience(config.clientId)
      .setSubject('auth-id-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(other.privateKey);
    await expect(
      validatePgCallback({
        config,
        code: 'code-1',
        redirectUri: REDIRECT_URI,
        codeVerifier: 'verifier-1',
        nonce: NONCE,
      })
    ).rejects.toMatchObject({ code: 'id_token_invalid' });
  });

  it('rejects when userinfo names a different subject than the ID token', async () => {
    behavior.idToken = await mintIdToken();
    behavior.userinfo = { sub: 'auth-id-2', pg_user_id: 'pg-user-2', email_verified: false };
    await expect(
      validatePgCallback({
        config,
        code: 'code-1',
        redirectUri: REDIRECT_URI,
        codeVerifier: 'verifier-1',
        nonce: NONCE,
      })
    ).rejects.toMatchObject({ code: 'subject_mismatch' });
  });

  it('maps a failed token exchange to token_exchange_failed', async () => {
    behavior.tokenStatus = 400;
    await expect(
      validatePgCallback({
        config,
        code: 'bad-code',
        redirectUri: REDIRECT_URI,
        codeVerifier: 'verifier-1',
        nonce: NONCE,
      })
    ).rejects.toMatchObject({ code: 'token_exchange_failed' });
  });
});
