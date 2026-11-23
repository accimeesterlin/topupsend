import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");

    // Scheduled top-ups are NOT started here anymore: the executor is
    // triggered exclusively by the Vercel Cron route
    // (/api/v1/cron/scheduled-topups), which is CRON_SECRET-protected
    // and gated by SCHEDULED_TOPUPS_ENABLED. An in-process timer on
    // serverless both misses ticks (ephemeral instances) and
    // duplicates them (one timer per warm instance).
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
