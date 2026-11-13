/**
 * Cluster 6 pins — service worker navigation cache (F-M9).
 *
 * public/sw.js is plain JS with no build step, so these tests load the
 * real file into a vm context with mocked service-worker globals
 * (caches / fetch / self) and drive its install/activate/fetch
 * listeners directly.
 *
 * Pins (fail on pristine sandbox, pass on this branch):
 *  - navigations to authenticated prefixes (/dashboard,
 *    /customer-portal, /staff-portal) are never written to any cache;
 *  - after such a page was "visited" online, going offline serves the
 *    offline page, never a stale cached copy of the authenticated page;
 *  - cache names are versioned per deploy: the old static names
 *    (mobile-topup-v1 / mobile-topup-runtime-v1) are retired by the
 *    activate handler instead of being kept forever.
 *
 * Controls (pass on both): public navigations are still cached and
 * served offline, a merely prefix-similar public path is still
 * cached, /api/ requests stay network-only, static assets are still
 * runtime-cached.
 */
import fs from "fs";
import path from "path";
import vm from "vm";

const ORIGIN = "https://topupsend.example";
const SW_PATH = path.join(__dirname, "../../../public/sw.js");

class FakeResponse {
  body: unknown;
  status: number;
  type = "basic";
  headers: unknown;
  url = "";

  constructor(body?: unknown, init?: { status?: number; headers?: unknown }) {
    this.body = body;
    this.status = init?.status ?? 200;
    this.headers = init?.headers;
  }

  clone(): FakeResponse {
    const copy = new FakeResponse(this.body, { status: this.status });
    copy.url = this.url;
    copy.type = this.type;
    return copy;
  }
}

function pageResponse(url: string): FakeResponse {
  const res = new FakeResponse(`page-content:${url}`, { status: 200 });
  res.url = url;
  return res;
}

type CacheStore = Map<string, FakeResponse>;

interface LoadedSW {
  listeners: Record<string, (event: never) => void>;
  stores: Map<string, CacheStore>;
  fetchMock: jest.Mock;
  runInstall: () => Promise<void>;
  runActivate: () => Promise<void>;
  fireFetch: (request: {
    url: string;
    mode: string;
    destination?: string;
  }) => Promise<FakeResponse | undefined>;
  allCachedUrls: () => string[];
}

function loadServiceWorker(
  fetchImpl: (request: { url: string }) => Promise<FakeResponse>,
  preseededCaches: string[] = [],
): LoadedSW {
  const stores = new Map<string, CacheStore>();
  for (const name of preseededCaches) stores.set(name, new Map());

  const keyOf = (req: unknown): string =>
    typeof req === "string" ? req : (req as { url: string }).url;

  const cachesMock = {
    open: jest.fn(async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name) as CacheStore;
      return {
        put: jest.fn(async (req: unknown, res: FakeResponse) => {
          store.set(keyOf(req), res);
        }),
        addAll: jest.fn(async (urls: string[]) => {
          for (const u of urls) {
            store.set(u, pageResponse(new URL(u, ORIGIN).href));
          }
        }),
        match: jest.fn(async (req: unknown) => store.get(keyOf(req))),
      };
    }),
    keys: jest.fn(async () => [...stores.keys()]),
    delete: jest.fn(async (name: string) => stores.delete(name)),
    match: jest.fn(async (req: unknown) => {
      const key = keyOf(req);
      for (const store of stores.values()) {
        const hit = store.get(key);
        if (hit) return hit;
      }
      return undefined;
    }),
  };

  const fetchMock = jest.fn(fetchImpl);
  const listeners: Record<string, (event: never) => void> = {};
  const selfMock = {
    addEventListener: (type: string, fn: (event: never) => void) => {
      listeners[type] = fn;
    },
    skipWaiting: jest.fn(),
    clients: { claim: jest.fn(async () => {}), openWindow: jest.fn() },
    registration: { showNotification: jest.fn(async () => {}) },
    location: { origin: ORIGIN },
  };

  const sandbox: Record<string, unknown> = {
    self: selfMock,
    caches: cachesMock,
    fetch: fetchMock,
    location: { origin: ORIGIN },
    console,
    URL,
    Response: FakeResponse,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SW_PATH, "utf8"), sandbox, {
    filename: "sw.js",
  });

  const runLifecycle = async (type: "install" | "activate") => {
    let pending: Promise<unknown> | undefined;
    const event = {
      waitUntil: jest.fn((p: Promise<unknown>) => {
        pending = p;
      }),
    };
    (listeners[type] as (e: unknown) => void)(event);
    await pending;
  };

  return {
    listeners,
    stores,
    fetchMock,
    runInstall: () => runLifecycle("install"),
    runActivate: () => runLifecycle("activate"),
    fireFetch: async (request) => {
      let pending: Promise<FakeResponse | undefined> | undefined;
      const event = {
        request: { method: "GET", destination: "", ...request },
        respondWith: jest.fn((p: Promise<FakeResponse | undefined>) => {
          pending = p;
        }),
      };
      (listeners.fetch as (e: unknown) => void)(event);
      return pending as Promise<FakeResponse | undefined>;
    },
    allCachedUrls: () => [...stores.values()].flatMap((s) => [...s.keys()]),
  };
}

describe("service worker navigation cache (Cluster 6, F-M9)", () => {
  describe("pins: authenticated navigations are never cached", () => {
    it.each([
      "/dashboard",
      "/dashboard/transactions",
      "/customer-portal/acme/dashboard",
      "/staff-portal/my-account",
    ])("navigation to %s is fetched but not written to any cache", async (p) => {
      const sw = loadServiceWorker(async (req) => pageResponse(req.url));
      await sw.runInstall();

      const res = await sw.fireFetch({ url: `${ORIGIN}${p}`, mode: "navigate" });

      expect(res?.body).toBe(`page-content:${ORIGIN}${p}`);
      expect(sw.allCachedUrls()).not.toContain(`${ORIGIN}${p}`);
    });

    it("an authenticated page visited online is not re-served when offline", async () => {
      let online = true;
      const sw = loadServiceWorker(async (req) => {
        if (!online) throw new Error("offline");
        return pageResponse(req.url);
      });
      await sw.runInstall();

      const url = `${ORIGIN}/dashboard`;
      const first = await sw.fireFetch({ url, mode: "navigate" });
      expect(first?.body).toBe(`page-content:${url}`);

      online = false;
      const second = await sw.fireFetch({ url, mode: "navigate" });
      // Must be the offline page, never the stale authenticated page.
      expect(second?.body).toBe(`page-content:${ORIGIN}/offline`);
    });
  });

  describe("pins: cache names are versioned per deploy", () => {
    it("install does not create the old static v1 caches", async () => {
      const sw = loadServiceWorker(async (req) => pageResponse(req.url));
      await sw.runInstall();
      const names = [...sw.stores.keys()];
      expect(names.length).toBeGreaterThan(0);
      expect(names).not.toContain("mobile-topup-v1");
      expect(names).not.toContain("mobile-topup-runtime-v1");
      expect(names.some((n) => /^mobile-topup-v\d+$/.test(n))).toBe(true);
    });

    it("activate retires the previous deploy's caches and keeps the current ones", async () => {
      const sw = loadServiceWorker(async (req) => pageResponse(req.url), [
        "mobile-topup-v1",
        "mobile-topup-runtime-v1",
      ]);
      await sw.runInstall();
      const currentNames = [...sw.stores.keys()].filter(
        (n) => n !== "mobile-topup-v1" && n !== "mobile-topup-runtime-v1",
      );
      expect(currentNames.length).toBeGreaterThan(0);

      await sw.runActivate();

      expect(sw.stores.has("mobile-topup-v1")).toBe(false);
      expect(sw.stores.has("mobile-topup-runtime-v1")).toBe(false);
      for (const name of currentNames) {
        expect(sw.stores.has(name)).toBe(true);
      }
    });
  });

  describe("controls: behavior that must not change", () => {
    it("public navigations are cached and served when offline", async () => {
      let online = true;
      const sw = loadServiceWorker(async (req) => {
        if (!online) throw new Error("offline");
        return pageResponse(req.url);
      });
      await sw.runInstall();

      const url = `${ORIGIN}/pricing`;
      const first = await sw.fireFetch({ url, mode: "navigate" });
      expect(first?.body).toBe(`page-content:${url}`);
      expect(sw.allCachedUrls()).toContain(url);

      online = false;
      const second = await sw.fireFetch({ url, mode: "navigate" });
      expect(second?.body).toBe(`page-content:${url}`);
    });

    it("a prefix-similar public path (/dashboards) is still cached", async () => {
      const sw = loadServiceWorker(async (req) => pageResponse(req.url));
      await sw.runInstall();
      const url = `${ORIGIN}/dashboards`;
      await sw.fireFetch({ url, mode: "navigate" });
      expect(sw.allCachedUrls()).toContain(url);
    });

    it("/api/ requests stay network-only and are never cached", async () => {
      const apiResponse = pageResponse(`${ORIGIN}/api/v1/health`);
      const sw = loadServiceWorker(async () => apiResponse);
      await sw.runInstall();

      const res = await sw.fireFetch({
        url: `${ORIGIN}/api/v1/health`,
        mode: "cors",
      });
      expect(res).toBe(apiResponse);
      expect(sw.allCachedUrls()).not.toContain(`${ORIGIN}/api/v1/health`);
    });

    it("/api/ requests offline still get the synthetic 503", async () => {
      const sw = loadServiceWorker(async () => {
        throw new Error("offline");
      });
      await sw.runInstall();
      const res = await sw.fireFetch({
        url: `${ORIGIN}/api/v1/health`,
        mode: "cors",
      });
      expect(res?.status).toBe(503);
    });

    it("static assets are still runtime-cached", async () => {
      const sw = loadServiceWorker(async (req) => pageResponse(req.url));
      await sw.runInstall();
      const url = `${ORIGIN}/icons/icon-192x192.png`;
      await sw.fireFetch({ url, mode: "no-cors", destination: "image" });
      expect(sw.allCachedUrls()).toContain(url);
    });
  });
});
