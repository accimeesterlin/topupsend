/**
 * Response-shaping helpers that keep secret / bearer material out of
 * API responses.
 *
 * Storage is deliberately untouched by everything in this module —
 * the values stay in the database (server-side flows such as PG Pay
 * binding and reconciliation read them from there); they are only
 * stripped at the response layer so they never ride out to a caller
 * whose role does not need them.
 */

/**
 * The sanitized payment-provider shape.
 *
 * This is exactly the projection the provider list endpoint has
 * always returned (and the PATCH endpoint mirrors): every field the
 * UI needs, credentials replaced by a `hasCredentials` flag. The
 * single-provider GET used to return the raw document — including
 * the Stripe secret key, PayPal client secret, PG Pay API key and
 * webhook secret stored in the Mixed `credentials` field — to any
 * authenticated org member.
 */
interface PaymentProviderShape {
  _id: unknown;
  provider: string;
  status: string;
  environment: string;
  settings?: unknown;
  metadata?: unknown;
  credentials?: Record<string, unknown> | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export function sanitizePaymentProvider(provider: PaymentProviderShape) {
  return {
    _id: provider._id,
    provider: provider.provider,
    status: provider.status,
    environment: provider.environment,
    settings: provider.settings,
    metadata: provider.metadata,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
    // Only indicate if credentials exist, don't send the actual values
    hasCredentials: !!(
      provider.credentials && Object.keys(provider.credentials).length > 0
    ),
  };
}

/**
 * Return a plain copy of a transaction (Mongoose document or lean
 * object) with `metadata.pgpayToken` removed.
 *
 * The token is bearer material for the PG Pay payment flow. It is
 * stored on the transaction for server-side binding/reconciliation,
 * but list responses handed it to every staff session that could
 * read transactions.
 */
export function stripTransactionPgpayToken<T>(transaction: T): T {
  if (!transaction || typeof transaction !== "object") {
    return transaction;
  }

  const source = transaction as Record<string, any>;
  const obj: Record<string, any> =
    typeof source.toObject === "function"
      ? source.toObject()
      : { ...source };

  if (obj.metadata && typeof obj.metadata === "object") {
    const metadata = { ...obj.metadata };
    delete metadata.pgpayToken;
    obj.metadata = metadata;
  }

  return obj as T;
}

const REDACTED = "[REDACTED]";

/**
 * Deep-redact any `pgPayToken` value inside a stored webhook payload
 * (object or JSON string) before the payload is returned to a caller.
 * PG Pay webhook bodies are persisted raw, token included; the
 * webhook-log detail endpoint must not hand the token back out.
 */
export function redactWebhookPayload(payload: unknown): unknown {
  if (typeof payload === "string") {
    return payload.replace(
      /("pgPayToken"\s*:\s*")[^"]*(")/gi,
      `$1${REDACTED}$2`,
    );
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => redactWebhookPayload(item));
  }

  if (payload && typeof payload === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      out[key] =
        key.toLowerCase() === "pgpaytoken"
          ? REDACTED
          : redactWebhookPayload(value);
    }
    return out;
  }

  return payload;
}
