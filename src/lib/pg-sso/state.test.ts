/**
 * @jest-environment node
 */
import {
  newPgSsoStatePayload,
  pgSsoStateMatches,
  signPgSsoState,
  verifyPgSsoState,
  type PgSsoStatePayload,
} from './state';

// JWT_SECRET is set for tests by jest.setup.js — the state cookie is
// signed with the same secret (see state.ts).

function payload(overrides: Partial<PgSsoStatePayload> = {}): PgSsoStatePayload {
  return {
    state: 'state-123',
    nonce: 'nonce-123',
    codeVerifier: 'verifier-123',
    returnTo: '/dashboard',
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

describe('PG SSO state cookie', () => {
  it('round-trips a signed payload', () => {
    const signed = signPgSsoState(payload());
    expect(verifyPgSsoState(signed)).toMatchObject({
      state: 'state-123',
      nonce: 'nonce-123',
      codeVerifier: 'verifier-123',
      returnTo: '/dashboard',
    });
  });

  it('rejects a tampered signature', () => {
    const signed = signPgSsoState(payload());
    const [data, sig] = signed.split('.');
    const flipped = `${data}.${sig.slice(0, -1)}${sig.endsWith('a') ? 'b' : 'a'}`;
    expect(verifyPgSsoState(flipped)).toBeNull();
  });

  it('rejects a tampered payload body', () => {
    const signed = signPgSsoState(payload());
    const [, sig] = signed.split('.');
    const forged = Buffer.from(
      JSON.stringify(payload({ returnTo: 'https://evil.example' }))
    ).toString('base64url');
    expect(verifyPgSsoState(`${forged}.${sig}`)).toBeNull();
  });

  it('rejects an expired payload', () => {
    const signed = signPgSsoState(payload({ expiresAt: Date.now() - 1 }));
    expect(verifyPgSsoState(signed)).toBeNull();
  });

  it('rejects malformed values outright', () => {
    expect(verifyPgSsoState('')).toBeNull();
    expect(verifyPgSsoState('no-dot-here')).toBeNull();
    expect(verifyPgSsoState('.')).toBeNull();
  });

  it('mints state/nonce/verifier with a 10-minute life', () => {
    const before = Date.now();
    const minted = newPgSsoStatePayload({ returnTo: '/dashboard' });
    expect(minted.state.length).toBeGreaterThanOrEqual(32);
    expect(minted.nonce.length).toBeGreaterThanOrEqual(32);
    expect(minted.codeVerifier.length).toBeGreaterThanOrEqual(32);
    expect(minted.expiresAt).toBeGreaterThanOrEqual(before + 9 * 60_000);
    expect(minted.expiresAt).toBeLessThanOrEqual(Date.now() + 10 * 60_000 + 1000);
    // And it verifies.
    expect(verifyPgSsoState(signPgSsoState(minted))?.returnTo).toBe('/dashboard');
  });

  it('compares state values in constant time semantics', () => {
    expect(pgSsoStateMatches('abc', 'abc')).toBe(true);
    expect(pgSsoStateMatches('abc', 'abd')).toBe(false);
    expect(pgSsoStateMatches('abc', 'abcd')).toBe(false);
  });
});
