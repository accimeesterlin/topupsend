import * as Sentry from "@sentry/nextjs";
import type { SessionPayload } from "./auth";
import type { UserRole } from "@topupsend/types";

/**
 * User context for Sentry - contains only non-PII data
 */
export interface SentryUserContext {
  id: string;
  orgId: string;
  roles: UserRole[];
}

/**
 * Set Sentry user context with non-PII data only.
 * This should be called after successful login or when user session is available.
 *
 * Non-PII data sent to Sentry:
 * - userId: Internal user identifier
 * - orgId: Organization identifier
 * - roles: User roles (admin, operator, viewer)
 *
 * PII data NOT sent:
 * - email
 * - name
 * - IP address
 * - Device information
 *
 * @param session - The user session payload
 */
export function setSentryUser(session: SessionPayload): void {
  Sentry.setUser({
    id: session.userId,
    // Add custom tags for better error filtering
    orgId: session.orgId,
    roles: session.roles.join(","),
  });

  // Set additional context as tags for easier filtering in Sentry
  Sentry.setTags({
    orgId: session.orgId,
    userRole: session.roles[0] || "unknown", // Primary role
    hasMultipleRoles: session.roles.length > 1,
  });
}

/**
 * Clear Sentry user context.
 * This should be called on logout.
 */
export function clearSentryUser(): void {
  Sentry.setUser(null);
}

/**
 * Set additional context for a specific operation.
 * Use this to add context about what the user was doing when an error occurred.
 *
 * @param context - Additional context information (should not contain PII)
 *
 * @example
 * setSentryContext({
 *   operation: "purchase_topup",
 *   productSku: "D0HTHT85801",
 *   amount: 35.00,
 *   currency: "USD"
 * });
 */
export function setSentryContext(context: Record<string, string | number | boolean>): void {
  Sentry.setContext("operation", context);
}

/**
 * Add breadcrumb for tracking user actions.
 * Breadcrumbs help understand the sequence of events leading to an error.
 *
 * @param message - Description of the action
 * @param category - Category of the action (e.g., "auth", "payment", "api")
 * @param level - Severity level
 * @param data - Additional data (should not contain PII)
 *
 * @example
 * addSentryBreadcrumb("User initiated payment", "payment", "info", {
 *   amount: 35.00,
 *   currency: "USD",
 *   provider: "pgpay"
 * });
 */
export function addSentryBreadcrumb(
  message: string,
  category: string,
  level: Sentry.SeverityLevel = "info",
  data?: Record<string, unknown>
): void {
  Sentry.addBreadcrumb({
    message,
    category,
    level,
    data,
    timestamp: Date.now() / 1000,
  });
}

/**
 * Capture a custom error with context.
 * Use this when you want to report an error with additional context.
 *
 * @param error - The error to capture
 * @param context - Additional context (should not contain PII)
 *
 * @example
 * captureSentryError(new Error("Payment failed"), {
 *   provider: "pgpay",
 *   orderId: "ORD-123",
 *   errorCode: "INSUFFICIENT_FUNDS"
 * });
 */
export function captureSentryError(
  error: Error,
  context?: Record<string, unknown>
): void {
  if (context) {
    Sentry.withScope((scope) => {
      scope.setContext("error_context", context);
      Sentry.captureException(error);
    });
  } else {
    Sentry.captureException(error);
  }
}

/**
 * Capture a message with context.
 * Use this for logging important events that aren't errors.
 *
 * @param message - The message to log
 * @param level - Severity level
 * @param context - Additional context (should not contain PII)
 *
 * @example
 * captureSentryMessage("Low wallet balance warning", "warning", {
 *   balance: 10.00,
 *   threshold: 50.00,
 *   orgId: "org_123"
 * });
 */
export function captureSentryMessage(
  message: string,
  level: Sentry.SeverityLevel = "info",
  context?: Record<string, unknown>
): void {
  if (context) {
    Sentry.withScope((scope) => {
      scope.setContext("message_context", context);
      Sentry.captureMessage(message, level);
    });
  } else {
    Sentry.captureMessage(message, level);
  }
}
