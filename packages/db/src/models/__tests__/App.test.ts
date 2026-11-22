/**
 * @jest-environment node
 *
 * Developer App model + ApiKey app-linkage pins. Document
 * construction is local (no DB connection): these tests pin schema
 * defaults and indexes only.
 */
import { App } from "../App";
import { ApiKey } from "../ApiKey";

describe("App model", () => {
  it("applies defaults: isActive true, timestamps present", () => {
    const app = new App({
      orgId: "org-1",
      name: "PGecom integration",
      createdBy: "user-1",
    });
    expect(app.isActive).toBe(true);
    expect(app.orgId).toBe("org-1");
    expect(app.createdBy).toBe("user-1");
    expect(app.description).toBeUndefined();
  });

  it("indexes orgId lookups", () => {
    const indexes = App.schema.indexes().map(([keys]) => keys);
    expect(indexes).toContainEqual({ orgId: 1 });
    expect(indexes).toContainEqual({ orgId: 1, isActive: 1 });
  });
});

describe("ApiKey app linkage", () => {
  const base = {
    key: "a".repeat(64),
    keyPrefix: "sk_live_ab12",
    orgId: "org-1",
    ownerId: "user-1",
    ownerType: "staff" as const,
    name: "Legacy key",
    scopes: ["topup:send"],
    rateLimit: { requests: 2000, window: 3600 },
  };

  it("legacy keys have no appId or createdBy by default", () => {
    const key = new ApiKey(base);
    expect(key.appId).toBeUndefined();
    expect(key.createdBy).toBeUndefined();
  });

  it("app keys record appId and createdBy", () => {
    const key = new ApiKey({ ...base, appId: "app-1", createdBy: "user-9" });
    expect(key.appId).toBe("app-1");
    expect(key.createdBy).toBe("user-9");
  });

  it("indexes appId lookups", () => {
    const indexes = ApiKey.schema.indexes().map(([keys]) => keys);
    expect(indexes).toContainEqual({ appId: 1, isActive: 1 });
  });
});
