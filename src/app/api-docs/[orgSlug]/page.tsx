"use client";

import { useState, useEffect } from "react";
import { Shield, Zap, Book, Copy, Check } from "lucide-react";

/**
 * Partner API documentation.
 *
 * This page documents ONLY the endpoints that actually exist for
 * API-key callers: the partner API under /api/v1/partner/*. (It
 * previously described endpoints that were never implemented —
 * GET /api/v1/balance, POST /api/v1/transactions, customer balance
 * routes — those have been removed.)
 */
export default function ApiDocsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const [_orgSlug, setOrgSlug] = useState<string>("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    params.then((p) => setOrgSlug(p.orgSlug));
  }, [params]);

  const copyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const CodeBlock = ({
    code,
    language,
    id,
  }: {
    code: string;
    language: string;
    id: string;
  }) => (
    <div className="relative">
      <div className="absolute top-2 right-2 flex items-center gap-2">
        <span className="text-xs text-gray-400 uppercase">{language}</span>
        <button
          onClick={() => copyCode(code, id)}
          className="p-1 hover:bg-gray-700 rounded"
        >
          {copiedCode === id ? (
            <Check className="h-4 w-4 text-green-400" />
          ) : (
            <Copy className="h-4 w-4 text-gray-400" />
          )}
        </button>
      </div>
      <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto">
        <code>{code}</code>
      </pre>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Hero Section */}
      <div className="text-center mb-16">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          Partner API Documentation
        </h1>
        <p className="text-xl text-gray-600 max-w-3xl mx-auto">
          Send prepaid mobile top-ups programmatically with a staff API
          key. The key is bound to one organization — every request acts
          on that organization only.
        </p>
      </div>

      {/* Feature Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <Zap className="h-8 w-8 text-indigo-600 mb-4" />
          <h3 className="font-semibold text-lg mb-2">Server-to-Server</h3>
          <p className="text-gray-600 text-sm">
            Look up products and prices, send top-ups, and read a
            send&apos;s status — no browser session involved.
          </p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <Shield className="h-8 w-8 text-indigo-600 mb-4" />
          <h3 className="font-semibold text-lg mb-2">Secure</h3>
          <p className="text-gray-600 text-sm">
            API key authentication with rate limiting and scope-based
            permissions. Sends require an Idempotency-Key, so retries
            never double-send.
          </p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <Book className="h-8 w-8 text-indigo-600 mb-4" />
          <h3 className="font-semibold text-lg mb-2">Accurate</h3>
          <p className="text-gray-600 text-sm">
            Every endpoint documented below exists and is implemented
            exactly as shown.
          </p>
        </div>
      </div>

      {/* Authentication */}
      <section id="authentication" className="mb-16 scroll-mt-20">
        <h2 className="text-3xl font-bold text-gray-900 mb-6">
          Authentication
        </h2>
        <div className="bg-white rounded-lg shadow-sm border p-8 space-y-6">
          <p className="text-gray-600">
            Create a staff API key in your dashboard (Settings → API
            Keys) with the scopes you need, and send it on every request
            in either header:
          </p>
          <CodeBlock
            id="auth-header"
            language="bash"
            code={`X-API-Key: sk_live_your_api_key_here
# or
Authorization: Bearer sk_live_your_api_key_here`}
          />
          <p className="text-gray-600">
            The key determines the organization for every call — you
            never send an organization id or slug. Keys are rate limited
            (default 1,000 requests/hour per key, 10,000/hour per
            organization); a breached limit returns HTTP 429.
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Scope
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Used by
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                <tr>
                  <td className="px-6 py-4 font-mono text-sm">topup:send</td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    Lookup, providers list, and sending top-ups
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-mono text-sm">
                    transactions:read
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    Reading a top-up&apos;s status by order id
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Endpoints */}
      <section id="endpoints" className="mb-16 scroll-mt-20">
        <h2 className="text-3xl font-bold text-gray-900 mb-6">Endpoints</h2>

        <div className="bg-white rounded-lg shadow-sm border p-8 mb-6 space-y-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded font-mono text-sm font-semibold">
                POST
              </span>
              <code className="text-lg">/api/v1/partner/lookup</code>
            </div>
            <p className="text-gray-600 mb-3">
              Detect the operator for a phone number and list its
              products with your organization&apos;s pricing — the same
              payload the public storefront lookup returns. Required
              scope: <code>topup:send</code>.
            </p>
            <CodeBlock
              id="lookup-curl"
              language="bash"
              code={`curl -X POST /api/v1/partner/lookup \\
  -H "X-API-Key: sk_live_your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{ "phoneNumber": "+50934748112" }'`}
            />
            <h4 className="font-semibold mt-4 mb-2">Response (abridged)</h4>
            <CodeBlock
              id="lookup-response"
              language="json"
              code={`{
  "phoneNumber": "50934748112",
  "country": { "code": "HT", "name": "Haiti" },
  "detectedOperators": [{ "code": "DIGHT", "name": "Digicel", "logo": "..." }],
  "operators": [{ "code": "DIGHT", "name": "Digicel", "logo": "..." }],
  "products": [{
    "skuCode": "...",
    "name": "...",
    "providerCode": "DIGHT",
    "pricing": { "costPrice": 9.5, "markup": 0.5, "finalPrice": 10, "discountApplied": false },
    "isVariableValue": false
  }],
  "totalProducts": 1,
  "testMode": false
}`}
            />
          </div>

          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="px-3 py-1 bg-green-100 text-green-800 rounded font-mono text-sm font-semibold">
                GET
              </span>
              <code className="text-lg">/api/v1/partner/providers</code>
            </div>
            <p className="text-gray-600 mb-3">
              List all DingConnect providers (countries and operators)
              available to your organization. Required scope:{" "}
              <code>topup:send</code>.
            </p>
            <CodeBlock
              id="providers-curl"
              language="bash"
              code={`curl /api/v1/partner/providers \\
  -H "X-API-Key: sk_live_your_api_key_here"`}
            />
            <h4 className="font-semibold mt-4 mb-2">Response (abridged)</h4>
            <CodeBlock
              id="providers-response"
              language="json"
              code={`{
  "providers": [{
    "ProviderCode": "DIGHT",
    "ProviderName": "Digicel",
    "CountryIso": "HT",
    "RegionCode": "...",
    "LogoUrl": "...",
    "CurrencyCode": "HTG"
  }],
  "count": 1
}`}
            />
          </div>

          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded font-mono text-sm font-semibold">
                POST
              </span>
              <code className="text-lg">/api/v1/partner/topups</code>
            </div>
            <p className="text-gray-600 mb-3">
              Send a top-up. Pricing is resolved server-side from the
              SKU — never send a price. The{" "}
              <code>Idempotency-Key</code> header is{" "}
              <strong>required</strong>: repeating a request with the
              same key returns the original transaction instead of
              sending again. Set <code>testMode: true</code> to validate
              only (no delivery) for this request. Required scope:{" "}
              <code>topup:send</code>.
            </p>
            <CodeBlock
              id="send-curl"
              language="bash"
              code={`curl -X POST /api/v1/partner/topups \\
  -H "X-API-Key: sk_live_your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: 3f9c1e2a-your-unique-key" \\
  -d '{
    "phoneNumber": "+50934748112",
    "skuCode": "SKU_FROM_LOOKUP",
    "sendValue": 10,
    "testMode": false
  }'`}
            />
            <p className="text-sm text-gray-500 mt-3">
              <code>sendValue</code> is required only for
              variable-value products (see <code>isVariableValue</code>{" "}
              in the lookup response).
            </p>
            <h4 className="font-semibold mt-4 mb-2">Response</h4>
            <CodeBlock
              id="send-response"
              language="json"
              code={`{
  "success": true,
  "message": "Top-up sent successfully",
  "transaction": {
    "id": "...",
    "orderId": "ORD-...",
    "amount": 10,
    "currency": "USD",
    "status": "completed",
    "recipientPhone": "+50934748112",
    "transferId": 123456789,
    "isTestMode": false
  }
}`}
            />
            <p className="text-sm text-gray-500 mt-3">
              A status of <code>processing</code> means the provider
              accepted the send but has not confirmed it yet — poll the
              status endpoint below. A definitively failed send returns
              HTTP 500 with the failure reason; the transaction is
              recorded as <code>failed</code> and can be read back with
              the status endpoint (or by replaying the same
              Idempotency-Key).
            </p>
          </div>

          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="px-3 py-1 bg-green-100 text-green-800 rounded font-mono text-sm font-semibold">
                GET
              </span>
              <code className="text-lg">
                /api/v1/partner/topups/:orderId
              </code>
            </div>
            <p className="text-gray-600 mb-3">
              Read one top-up&apos;s status. Only your
              organization&apos;s transactions are visible — any other
              order id returns 404. If the transaction is still
              processing, its live provider status is checked before
              answering. Required scope: <code>transactions:read</code>.
            </p>
            <CodeBlock
              id="status-curl"
              language="bash"
              code={`curl /api/v1/partner/topups/ORD-... \\
  -H "X-API-Key: sk_live_your_api_key_here"`}
            />
            <h4 className="font-semibold mt-4 mb-2">Response</h4>
            <CodeBlock
              id="status-response"
              language="json"
              code={`{
  "orderId": "ORD-...",
  "status": "completed",
  "transferId": 123456789,
  "amount": 10,
  "currency": "USD",
  "recipientPhone": "+50934748112",
  "failureReason": null,
  "isTestMode": false
}`}
            />
          </div>
        </div>
      </section>

      {/* Errors */}
      <section id="errors" className="mb-16">
        <h2 className="text-3xl font-bold text-gray-900 mb-6">Errors</h2>
        <div className="bg-white rounded-lg shadow-sm border p-8 space-y-6">
          <p className="text-gray-600">
            Errors are returned as RFC 7807 problem details:
          </p>
          <CodeBlock
            id="error-format"
            language="json"
            code={`{
  "type": "bad-request",
  "title": "Bad Request",
  "status": 400,
  "detail": "Idempotency-Key header is required for partner top-up requests"
}`}
          />
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    HTTP Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Meaning
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                <tr>
                  <td className="px-6 py-4 text-sm">400</td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    Invalid request (missing Idempotency-Key, unknown
                    SKU, sendValue out of range, …)
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm">401</td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    Missing, invalid, or expired API key
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm">403</td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    API key lacks the required scope
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm">404</td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    Transaction not found in your organization
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm">429</td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    Rate limit exceeded
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 text-sm">500</td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    The send failed at the provider, or an unexpected
                    server error
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
