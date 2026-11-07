/**
 * Partner Apps catalog data layer.
 *
 * The catalog is owned by PG Top Up and read from its public feed.
 * These tests pin the consumer contract: feed order is display order,
 * the feed wins when it can be read, ANY feed failure (network,
 * non-200, malformed payload) falls back to the static seed list, and
 * TopUpSend's own entry is excluded from both sources.
 */
import {
  FALLBACK_PARTNER_APPS,
  excludeSelfApps,
  getPartnerApps,
  parsePartnerAppsFeed,
  type PartnerApp,
} from './partner-apps';

const feedApp = (overrides: Partial<PartnerApp>): PartnerApp => ({
  name: 'Example',
  tagline: 'An example app.',
  url: 'https://example.com',
  logoUrl: null,
  category: 'pg',
  ...overrides,
});

function mockFetchJson(payload: unknown, status = 200) {
  const fetchMock = jest.fn(async (_url: unknown, _init?: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }));
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function stubFetch(fetchImpl: () => Promise<unknown>) {
  global.fetch = jest.fn(fetchImpl) as unknown as typeof fetch;
}

let savedEnv: string | undefined;
const originalFetch = global.fetch;

beforeEach(() => {
  savedEnv = process.env.PG_PARTNER_APPS_API_URL;
  delete process.env.PG_PARTNER_APPS_API_URL;
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
  if (savedEnv === undefined) delete process.env.PG_PARTNER_APPS_API_URL;
  else process.env.PG_PARTNER_APPS_API_URL = savedEnv;
});

describe('getPartnerApps — live feed', () => {
  it('returns feed apps in feed order, with the feed values winning', async () => {
    const fetchMock = mockFetchJson({
      partnerApps: [
        feedApp({ name: 'Zeta', url: 'https://zeta.example.com', tagline: 'Feed tagline Z.' }),
        feedApp({ name: 'Alpha', url: 'https://alpha.example.com', tagline: 'Feed tagline A.' }),
        feedApp({ name: 'Partner Co', url: 'https://partner.example.com', category: 'affiliated' }),
      ],
    });

    const apps = await getPartnerApps();

    expect(apps.map((a) => a.name)).toEqual(['Zeta', 'Alpha', 'Partner Co']);
    expect(apps[0].tagline).toBe('Feed tagline Z.');
    expect(apps[2].category).toBe('affiliated');
    // Default feed is the PG sandbox deployment (production PG Top Up
    // does not serve the endpoint yet), fetched with the feed's own
    // cache lifetime mirrored as a revalidate window.
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit & { next?: { revalidate?: number } },
    ];
    expect(url).toBe('https://sandbox.pgecom.com/api/v1/partner-apps');
    expect(init.next?.revalidate).toBe(300);
  });

  it('honors the PG_PARTNER_APPS_API_URL override', async () => {
    process.env.PG_PARTNER_APPS_API_URL = 'https://staging.pgecom.example/';
    const fetchMock = mockFetchJson({ partnerApps: [] });

    await getPartnerApps();

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://staging.pgecom.example/api/v1/partner-apps',
    );
  });

  it('excludes TopUpSend itself from the feed (both host spellings)', async () => {
    mockFetchJson({
      partnerApps: [
        feedApp({ name: 'TopUpSend', url: 'https://topupsend.com' }),
        feedApp({ name: 'TopUpSend WWW', url: 'https://www.topupsend.com' }),
        feedApp({ name: 'WhipFleet', url: 'https://whipfleet.com' }),
      ],
    });

    const apps = await getPartnerApps();

    expect(apps.map((a) => a.name)).toEqual(['WhipFleet']);
  });
});

describe('getPartnerApps — fallback seed list', () => {
  it('falls back when the feed returns a non-200 status', async () => {
    mockFetchJson({ error: 'nope' }, 500);

    const apps = await getPartnerApps();

    expect(apps).toEqual(excludeSelfApps(FALLBACK_PARTNER_APPS));
    expect(apps).toHaveLength(FALLBACK_PARTNER_APPS.length - 1);
    expect(apps[0].name).toBe('PGecom');
  });

  it('falls back when the fetch itself rejects (hub unreachable)', async () => {
    stubFetch(async () => {
      throw new Error('ECONNREFUSED');
    });

    const apps = await getPartnerApps();

    expect(apps.map((a) => a.name)).toEqual(
      excludeSelfApps(FALLBACK_PARTNER_APPS).map((a) => a.name),
    );
  });

  it('falls back when the payload does not match the contract', async () => {
    mockFetchJson({ unexpected: true });

    const apps = await getPartnerApps();

    expect(apps).toHaveLength(FALLBACK_PARTNER_APPS.length - 1);
  });

  it('never includes TopUpSend in the fallback either', async () => {
    stubFetch(async () => {
      throw new Error('down');
    });

    const apps = await getPartnerApps();

    expect(apps.some((a) => a.url.includes('topupsend.com'))).toBe(false);
  });
});

describe('excludeSelfApps', () => {
  it('keeps other apps and drops only self hosts', () => {
    const apps = [
      feedApp({ name: 'Self bare', url: 'https://topupsend.com/some/path' }),
      feedApp({ name: 'Self www', url: 'https://www.topupsend.com' }),
      feedApp({ name: 'Lookalike', url: 'https://topupsend.com.example.com' }),
      feedApp({ name: 'Other', url: 'https://whipfleet.com' }),
    ];

    expect(excludeSelfApps(apps).map((a) => a.name)).toEqual([
      'Lookalike',
      'Other',
    ]);
  });
});

describe('parsePartnerAppsFeed', () => {
  it('normalizes entries and drops ones that cannot render safely', () => {
    const apps = parsePartnerAppsFeed({
      partnerApps: [
        feedApp({ name: 'Good', url: 'https://good.example.com', category: 'affiliated', logoUrl: 'https://good.example.com/logo.png' }),
        { name: 'No URL', tagline: 'x', logoUrl: null, category: 'pg' },
        { name: 'Bad scheme', tagline: 'x', url: 'javascript:alert(1)', logoUrl: null, category: 'pg' },
        { name: 'Odd category', tagline: 'x', url: 'https://odd.example.com', logoUrl: null, category: 'partner' },
        'not an object',
      ],
    });

    expect(apps?.map((a) => a.name)).toEqual(['Good', 'Odd category']);
    expect(apps?.[0].category).toBe('affiliated');
    expect(apps?.[0].logoUrl).toBe('https://good.example.com/logo.png');
    expect(apps?.[1].category).toBe('pg');
  });

  it('returns null for non-contract payloads', () => {
    expect(parsePartnerAppsFeed(null)).toBeNull();
    expect(parsePartnerAppsFeed({})).toBeNull();
    expect(parsePartnerAppsFeed({ partnerApps: 'nope' })).toBeNull();
  });
});
