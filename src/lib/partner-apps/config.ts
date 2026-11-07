/**
 * Partner Apps — PG platform catalog feed configuration.
 *
 * PG Top Up is the Partner Apps hub: it owns the catalog (managed in
 * its Platform console) and serves it on a public endpoint,
 *   GET /api/v1/partner-apps
 * Every PG app renders the same catalog on its own Partner Apps page;
 * this module is TopUpSend's consumer-side configuration for that feed
 * (same shape as the Sign in with PG client config in lib/pg-sso).
 *
 * Environment variables:
 *   PG_PARTNER_APPS_API_URL (optional override) — base URL of the PG
 *   platform deployment serving the feed, e.g. a staging deployment.
 *
 * The default is the PG SANDBOX deployment: this branch is the sandbox
 * rollout wave (same convention as the Sign in with PG sandbox client
 * in lib/pg-sso/config.ts). Production PG Top Up does not serve the
 * endpoint yet — when it does, point this variable (or the default) at
 * the production deployment; no code change is needed.
 */

const DEFAULT_API_BASE = 'https://sandbox.pgecom.com';

/** Base URL of the PG platform deployment that serves the catalog feed. */
export function getPartnerAppsApiBase(): string {
  const override = process.env.PG_PARTNER_APPS_API_URL;
  return (override?.trim() || DEFAULT_API_BASE).replace(/\/$/, '');
}

/** Full URL of the public partner-apps catalog feed. */
export function getPartnerAppsFeedUrl(): string {
  return `${getPartnerAppsApiBase()}/api/v1/partner-apps`;
}
