/**
 * @jest-environment node
 */
import { getPgSsoConfig, isPgSsoConfigured, PG_SSO_SCOPES } from './config';

const ENV_KEYS = [
  'PG_SSO_CLIENT_ID',
  'PG_SSO_CLIENT_SECRET',
  'PG_SSO_ISSUER_URL',
  'PG_SSO_SANDBOX_CLIENT_ID',
  'PG_SSO_SANDBOX_CLIENT_SECRET',
  'PG_SSO_SANDBOX_ISSUER_URL',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function configureClient() {
  process.env.PG_SSO_CLIENT_ID = 'topupsend-client';
  process.env.PG_SSO_CLIENT_SECRET = 'client-secret';
}

function configureLegacyClient() {
  process.env.PG_SSO_SANDBOX_CLIENT_ID = 'topupsend-sandbox';
  process.env.PG_SSO_SANDBOX_CLIENT_SECRET = 'sandbox-secret';
}

describe('getPgSsoConfig', () => {
  it('returns null when the client is not configured (button stays hidden)', () => {
    expect(getPgSsoConfig()).toBeNull();
    expect(isPgSsoConfigured()).toBe(false);
  });

  it('returns null when only half the credential pair is set', () => {
    process.env.PG_SSO_CLIENT_ID = 'topupsend-client';
    expect(getPgSsoConfig()).toBeNull();
    delete process.env.PG_SSO_CLIENT_ID;
    process.env.PG_SSO_CLIENT_SECRET = 'client-secret';
    expect(getPgSsoConfig()).toBeNull();
  });

  it('resolves the client with the default PG issuer', () => {
    configureClient();
    expect(getPgSsoConfig()).toEqual({
      issuer: 'https://sandbox.pgecom.com',
      clientId: 'topupsend-client',
      clientSecret: 'client-secret',
    });
    expect(isPgSsoConfigured()).toBe(true);
  });

  it('honors an issuer override and trims a trailing slash', () => {
    configureClient();
    process.env.PG_SSO_ISSUER_URL = 'https://staging.pgecom.example/';
    expect(getPgSsoConfig()?.issuer).toBe('https://staging.pgecom.example');
  });

  it('still resolves the client from the legacy variable names alone', () => {
    configureLegacyClient();
    process.env.PG_SSO_SANDBOX_ISSUER_URL = 'https://legacy.pgecom.example/';
    expect(getPgSsoConfig()).toEqual({
      issuer: 'https://legacy.pgecom.example',
      clientId: 'topupsend-sandbox',
      clientSecret: 'sandbox-secret',
    });
    expect(isPgSsoConfigured()).toBe(true);
  });

  it('prefers the current variable names when both generations are set', () => {
    configureLegacyClient();
    configureClient();
    process.env.PG_SSO_SANDBOX_ISSUER_URL = 'https://legacy.pgecom.example';
    process.env.PG_SSO_ISSUER_URL = 'https://current.pgecom.example';
    expect(getPgSsoConfig()).toEqual({
      issuer: 'https://current.pgecom.example',
      clientId: 'topupsend-client',
      clientSecret: 'client-secret',
    });
  });

  it('requests identity scopes only', () => {
    expect(PG_SSO_SCOPES).toBe('openid profile email');
  });
});
