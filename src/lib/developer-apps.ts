/**
 * Developer apps — shared constants and scope definitions for the
 * seller dashboard's self-serve app / API-key experience.
 *
 * Caps live here (single place) so the routes and any future UI copy
 * agree on the numbers.
 */
import { App, type ApiKeyScope, type IApp } from "@topupsend/db";
import { ApiErrors } from "@/lib/api-error";

/** Max simultaneously active apps per organization. */
export const MAX_ACTIVE_APPS_PER_ORG = 10;

/** Max simultaneously active API keys per app. */
export const MAX_ACTIVE_KEYS_PER_APP = 5;

/**
 * Scopes an org admin may grant to an app key from the dashboard.
 * Mirrors the staff-portal checkbox list: admin:* and balance:write
 * are deliberately NOT self-serve (they stay staff-portal / admin
 * tooling concerns).
 */
export const APP_KEY_SCOPES: { value: ApiKeyScope; label: string }[] = [
  { value: "balance:read", label: "Read Balance" },
  { value: "transactions:read", label: "Read Transactions" },
  { value: "transactions:create", label: "Create Transactions" },
  { value: "topup:send", label: "Send Top-ups" },
  { value: "customer:read", label: "Read Customers" },
  { value: "customer:update", label: "Update Customers" },
];

export const APP_KEY_SCOPE_VALUES: ApiKeyScope[] = APP_KEY_SCOPES.map(
  (s) => s.value,
);

export function isAppKeyScope(scope: string): scope is ApiKeyScope {
  return APP_KEY_SCOPE_VALUES.includes(scope as ApiKeyScope);
}

/** Wire shape for an app, shared by every apps route. */
export function serializeApp(app: IApp) {
  return {
    id: String(app._id),
    name: app.name,
    description: app.description ?? null,
    createdBy: app.createdBy,
    isActive: app.isActive,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  };
}

/**
 * Load an app that belongs to the given organization. Cross-org ids
 * are indistinguishable from missing ids (404) so one organization
 * can never probe another's apps.
 */
export async function findOrgApp(
  orgId: string,
  appId: string,
): Promise<IApp> {
  let app: IApp | null = null;
  try {
    app = await App.findById(appId);
  } catch {
    app = null; // malformed ObjectId → not found, not a 500
  }
  if (!app || app.orgId !== orgId) {
    throw ApiErrors.NotFound("App not found");
  }
  return app;
}
