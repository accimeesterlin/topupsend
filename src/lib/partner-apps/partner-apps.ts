/**
 * Partner Apps — catalog data for TopUpSend's Partner Apps page.
 *
 * The catalog lives in PG Top Up (the hub): platform staff manage it
 * in PG Top Up's Platform console and it is served publicly at
 * GET /api/v1/partner-apps (see lib/partner-apps/config.ts for the
 * feed URL configuration). The response is
 *   { partnerApps: [{ name, tagline, url, logoUrl, category }] }
 * with active apps only, in display order.
 *
 * Resilience contract: the page must never render broken or empty
 * because the hub is unreachable. If the feed errors, times out, or
 * returns a payload that does not match the contract, we fall back to
 * the static seed list below — the PG apps as seeded in the hub on
 * day one. When the feed is up, its data (including taglines and any
 * affiliated apps the platform adds) always wins.
 *
 * Self-exclusion: an app does not promote itself on its own Partner
 * Apps page, so the TopUpSend entry is filtered out of BOTH the feed
 * data and the fallback list.
 */

import { getPartnerAppsFeedUrl } from './config';

export type PartnerAppCategory = 'pg' | 'affiliated';

export interface PartnerApp {
  name: string;
  tagline: string;
  url: string;
  logoUrl: string | null;
  category: PartnerAppCategory;
}

/** Hosts that identify TopUpSend itself in the catalog. */
const SELF_HOSTS = new Set(['topupsend.com', 'www.topupsend.com']);

/** The feed's Cache-Control is `public, max-age=300` — mirror it. */
const FEED_REVALIDATE_SECONDS = 300;

/**
 * Static seed catalog, used ONLY when the live feed cannot be read.
 * Mirrors the hub's day-one seed list; keep names/URLs factual.
 */
export const FALLBACK_PARTNER_APPS: PartnerApp[] = [
  { name: 'PGecom', tagline: 'Payments, wallets, transfers, and cards on the PG platform.', url: 'https://www.pgecom.com', logoUrl: null, category: 'pg' },
  { name: 'Expenci', tagline: 'Expense tracking for individuals and teams.', url: 'https://expenci.com', logoUrl: null, category: 'pg' },
  { name: 'Tradlot', tagline: 'Peer-to-peer currency and crypto exchange.', url: 'https://tradlot.com', logoUrl: null, category: 'pg' },
  { name: 'WhipFleet', tagline: 'Vehicle rentals and fleet management.', url: 'https://whipfleet.com', logoUrl: null, category: 'pg' },
  { name: 'Servanzo', tagline: 'Marketplace for buying and selling services.', url: 'https://servanzo.com', logoUrl: null, category: 'pg' },
  { name: 'ID Verification Hub', tagline: 'Identity verification and document checks.', url: 'https://idverificationhub.com', logoUrl: null, category: 'pg' },
  { name: 'TopUpSend', tagline: 'International mobile top-ups and prepaid minutes.', url: 'https://topupsend.com', logoUrl: null, category: 'pg' },
  { name: 'Captisso', tagline: 'Customer relationship management for growing teams.', url: 'https://captisso.com', logoUrl: null, category: 'pg' },
  { name: 'Educilo', tagline: 'Online school and course platform.', url: 'https://educilo.com', logoUrl: null, category: 'pg' },
  { name: 'SellerGift', tagline: 'Gift cards for sellers and their customers.', url: 'https://sellergift.com', logoUrl: null, category: 'pg' },
];

function isSelfApp(app: PartnerApp): boolean {
  try {
    return SELF_HOSTS.has(new URL(app.url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Remove TopUpSend's own entry — an app does not promote itself. */
export function excludeSelfApps(apps: PartnerApp[]): PartnerApp[] {
  return apps.filter((app) => !isSelfApp(app));
}

/**
 * Validate/normalize one feed entry. Returns null for entries that
 * cannot be rendered safely (no usable name or http(s) URL).
 */
function parseFeedEntry(entry: unknown): PartnerApp | null {
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const url = typeof record.url === 'string' ? record.url.trim() : '';
  if (!name || !/^https?:\/\//i.test(url)) return null;
  return {
    name,
    tagline: typeof record.tagline === 'string' ? record.tagline : '',
    url,
    logoUrl:
      typeof record.logoUrl === 'string' && record.logoUrl
        ? record.logoUrl
        : null,
    category: record.category === 'affiliated' ? 'affiliated' : 'pg',
  };
}

/** Validate the feed payload shape; null when it does not match the contract. */
export function parsePartnerAppsFeed(payload: unknown): PartnerApp[] | null {
  if (!payload || typeof payload !== 'object') return null;
  const list = (payload as Record<string, unknown>).partnerApps;
  if (!Array.isArray(list)) return null;
  const apps: PartnerApp[] = [];
  for (const entry of list) {
    const parsed = parseFeedEntry(entry);
    if (parsed) apps.push(parsed);
  }
  return apps;
}

/**
 * The catalog to render: the live feed when it can be read, the static
 * fallback when it cannot. TopUpSend's own entry is always excluded.
 * Feed order is display order and is preserved.
 */
export async function getPartnerApps(): Promise<PartnerApp[]> {
  try {
    const response = await fetch(getPartnerAppsFeedUrl(), {
      headers: { accept: 'application/json' },
      next: { revalidate: FEED_REVALIDATE_SECONDS },
    });
    if (!response.ok) {
      throw new Error(`Partner apps feed returned ${response.status}`);
    }
    const apps = parsePartnerAppsFeed(await response.json());
    if (!apps) {
      throw new Error('Partner apps feed payload did not match the contract');
    }
    return excludeSelfApps(apps);
  } catch {
    return excludeSelfApps(FALLBACK_PARTNER_APPS);
  }
}
