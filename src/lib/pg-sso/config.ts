/**
 * Sign in with PG — client configuration (TopUpSend as relying party).
 *
 * Mirrors the Servanzo implementation (lib/pg-sso/config.ts there),
 * adapted to this rollout wave: TopUpSend registers ONE confidential
 * OAuth client, against the PG Top Up SANDBOX issuer only.
 *
 * Environment variables:
 *   PG_SSO_SANDBOX_CLIENT_ID / PG_SSO_SANDBOX_CLIENT_SECRET
 *   PG_SSO_SANDBOX_ISSUER_URL (optional override; defaults to the
 *     sandbox issuer below)
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
 * The sandbox client config, or null when the client id/secret are
 * not set — an unconfigured deployment has no PG sign-in, everywhere.
 */
export function getPgSsoConfig(): PgSsoClientConfig | null {
  const clientId = process.env.PG_SSO_SANDBOX_CLIENT_ID;
  const clientSecret = process.env.PG_SSO_SANDBOX_CLIENT_SECRET;
  if (!clientId?.trim() || !clientSecret?.trim()) return null;
  const issuer = (
    process.env.PG_SSO_SANDBOX_ISSUER_URL?.trim() || PG_SSO_DEFAULT_ISSUER
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
