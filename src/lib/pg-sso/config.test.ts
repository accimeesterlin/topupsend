/**
 * @jest-environment node
 */
import { getPgSsoConfig, isPgSsoConfigured, PG_SSO_SCOPES } from './config';

const ENV_KEYS = [
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

function configureSandbox() {
  process.env.PG_SSO_SANDBOX_CLIENT_ID = 'topupsend-sandbox';
  process.env.PG_SSO_SANDBOX_CLIENT_SECRET = 'sandbox-secret';
}

describe('getPgSsoConfig', () => {
  it('returns null when the client is not configured (button stays hidden)', () => {
    expect(getPgSsoConfig()).toBeNull();
    expect(isPgSsoConfigured()).toBe(false);
  });

  it('returns null when only half the credential pair is set', () => {
    process.env.PG_SSO_SANDBOX_CLIENT_ID = 'topupsend-sandbox';
    expect(getPgSsoConfig()).toBeNull();
    delete process.env.PG_SSO_SANDBOX_CLIENT_ID;
    process.env.PG_SSO_SANDBOX_CLIENT_SECRET = 'sandbox-secret';
    expect(getPgSsoConfig()).toBeNull();
  });

  it('resolves the sandbox client with the default PG issuer', () => {
    configureSandbox();
    expect(getPgSsoConfig()).toEqual({
      issuer: 'https://sandbox.pgecom.com',
      clientId: 'topupsend-sandbox',
      clientSecret: 'sandbox-secret',
    });
    expect(isPgSsoConfigured()).toBe(true);
  });

  it('honors an issuer override and trims a trailing slash', () => {
    configureSandbox();
    process.env.PG_SSO_SANDBOX_ISSUER_URL = 'https://staging.pgecom.example/';
    expect(getPgSsoConfig()?.issuer).toBe('https://staging.pgecom.example');
  });

  it('requests identity scopes only', () => {
    expect(PG_SSO_SCOPES).toBe('openid profile email');
  });
});
