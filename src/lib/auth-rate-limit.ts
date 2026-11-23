import { NextRequest } from "next/server";
import { rateLimitService } from "./services/rate-limit.service";

/**
 * Rate limiting for credential endpoints (F-M6): staff + customer
 * login, 2FA send-code and 2FA verify.
 *
 * Built on the repo's existing in-memory RateLimitService — the same
 * store the API-key limiter uses — with two buckets per attempt:
 * one keyed by account + IP (stops credential stuffing against one
 * account from one source) and one keyed by IP alone (stops one
 * source spraying many accounts). Every attempt is recorded,
 * successful or not; limits are per 15-minute window.
 *
 * Like the API-key limiter, the store is per-process in-memory: on a
 * multi-instance deployment each instance keeps its own counters, so
 * the effective ceiling is limit × instances. That matches the
 * repo's existing posture; a shared store is a separate upgrade.
 */

export type AuthRateLimitKind = "login" | "twoFactorSend" | "twoFactorVerify";

const WINDOW_SECONDS = 15 * 60;

const LIMITS: Record<
  AuthRateLimitKind,
  { accountIp: number; ipOnly: number }
> = {
  login: { accountIp: 10, ipOnly: 50 },
  twoFactorSend: { accountIp: 5, ipOnly: 25 },
  twoFactorVerify: { accountIp: 10, ipOnly: 50 },
};

export interface AuthRateLimitResult {
  allowed: boolean;
  /** Seconds until the tripped bucket resets (0 when allowed). */
  retryAfterSeconds: number;
}

/** Best-effort client IP: first hop of X-Forwarded-For, else X-Real-IP. */
export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") || "unknown";
}

/**
 * Check (and, when allowed, record) one credential-endpoint attempt.
 * `accountKey` identifies the account being attempted — an email, or
 * `orgSlug:email` for customer endpoints.
 */
export async function checkAuthRateLimit(
  kind: AuthRateLimitKind,
  accountKey: string,
  ip: string,
): Promise<AuthRateLimitResult> {
  const config = LIMITS[kind];
  const accountId = `auth:${kind}:acct:${accountKey.toLowerCase()}:${ip}`;
  const ipId = `auth:${kind}:ip:${ip}`;

  const accountCheck = await rateLimitService.checkLimit(accountId, "key", {
    requests: config.accountIp,
    window: WINDOW_SECONDS,
  });
  if (!accountCheck.allowed) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((accountCheck.resetAt - Date.now()) / 1000),
      ),
    };
  }

  const ipCheck = await rateLimitService.checkLimit(ipId, "key", {
    requests: config.ipOnly,
    window: WINDOW_SECONDS,
  });
  if (!ipCheck.allowed) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((ipCheck.resetAt - Date.now()) / 1000),
      ),
    };
  }

  await rateLimitService.recordRequest(accountId, "key");
  await rateLimitService.recordRequest(ipId, "key");

  return { allowed: true, retryAfterSeconds: 0 };
}
