/**
 * Sign in with PG — client configuration (TopUpSend as relying party).
 *
 * Mirrors the Servanzo implementation (lib/pg-sso/config.ts there),
 * adapted to this rollout wave: TopUpSend registers ONE confidential
 * OAuth client, against the PG Top Up SANDBOX issuer only.
 *
 * Environment variables:
 *   PG_SSO_CLIENT_ID / PG_SSO_CLIENT_SECRET
 *   PG_SSO_ISSUER_URL (optional override; defaults to the
 *     sandbox issuer below)
 *
 * Transitional fallback: each variable is read under its legacy
 * PG_SSO_SANDBOX_* name when the current name is unset, so SSO keeps
 * working in deployments whose variables have not been renamed yet.
 *
 * The credentials live in server env only — never in the browser,
 * never in the state cookie. While they are unset the feature is
 * simply absent: the login page hides the button and the start route
 * refuses, so the app behaves exactly as it did before this feature.
 */

export interface PgSsoClientConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
}

export const PG_SSO_DEFAULT_ISSUER = 'https://sandbox.pgecom.com';

/**
 * Reads one SSO env var: the current name wins; the legacy
 * PG_SSO_SANDBOX_* name is the fallback when the current name is
 * unset or blank. Transitional — remove the fallback once every
 * deployment's variables have been renamed.
 */
function readPgSsoEnv(currentName: string, legacyName: string): string | undefined {
  const current = process.env[currentName];
  if (current?.trim()) return current;
  return process.env[legacyName];
}

/**
 * The PG client config, or null when the client id/secret are
 * not set — an unconfigured deployment has no PG sign-in, everywhere.
 */
export function getPgSsoConfig(): PgSsoClientConfig | null {
  const clientId = readPgSsoEnv('PG_SSO_CLIENT_ID', 'PG_SSO_SANDBOX_CLIENT_ID');
  const clientSecret = readPgSsoEnv(
    'PG_SSO_CLIENT_SECRET',
    'PG_SSO_SANDBOX_CLIENT_SECRET',
  );
  if (!clientId?.trim() || !clientSecret?.trim()) return null;
  const issuer = (
    readPgSsoEnv('PG_SSO_ISSUER_URL', 'PG_SSO_SANDBOX_ISSUER_URL')?.trim() ||
    PG_SSO_DEFAULT_ISSUER
  ).replace(/\/$/, '');
  return {
    issuer,
    clientId: clientId.trim(),
    clientSecret: clientSecret.trim(),
  };
}

export function isPgSsoConfigured(): boolean {
  return getPgSsoConfig() !== null;
}

/** The scopes TopUpSend requests — identity only. */
export const PG_SSO_SCOPES = 'openid profile email';
