"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
} from "@topupsend/ui";
import {
  Code,
  BookOpen,
  Key,
  Zap,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

export default function ApiDocsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const [orgSlug, setOrgSlug] = useState<string>("");
  const [expandedEndpoints, setExpandedEndpoints] = useState<Set<number>>(
    new Set(),
  );
  const {} = useTranslation();

  useEffect(() => {
    params.then((p) => setOrgSlug(p.orgSlug));
  }, [params]);

  const toggleEndpoint = (index: number) => {
    setExpandedEndpoints((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedEndpoints(new Set(endpoints.map((_, i) => i)));
  };

  const collapseAll = () => {
    setExpandedEndpoints(new Set());
  };

  const endpoints = [
    {
      method: "GET",
      path: "/api/v1/customer-auth/me",
      description: "Get current customer profile information including balance",
      scopes: ["customer:read"],
      example: {
        response: {
          customer: {
            id: "cust_123",
            email: "customer@example.com",
            name: "John Doe",
            phoneNumber: "+50912345678",
            currentBalance: 100.0,
            balanceCurrency: "USD",
            emailVerified: true,
            createdAt: "2024-01-15T10:30:00Z",
          },
        },
      },
    },
    {
      method: "PUT",
      path: "/api/v1/customers/{customerId}",
      description: "Update customer profile information",
      scopes: ["customer:update"],
      body: {
        firstName: "John",
        lastName: "Doe",
        phone: "+50912345678",
      },
      example: {
        response: {
          customer: {
            id: "cust_123",
            name: "John Doe",
            phoneNumber: "+50912345678",
            email: "customer@example.com",
          },
        },
      },
    },
    {
      method: "GET",
      path: "/api/v1/customers/{customerId}/transactions",
      description: "List customer transactions with pagination and filtering",
      scopes: ["transactions:read"],
      params: [
        {
          name: "limit",
          type: "number",
          description: "Number of results per page (default: 10, max: 100)",
        },
        {
          name: "offset",
          type: "number",
          description: "Number of results to skip (default: 0)",
        },
        {
          name: "status",
          type: "string",
          description: "Filter by status: pending, completed, failed, refunded",
        },
      ],
      example: {
        response: {
          data: [
            {
              id: "txn_123",
              amount: 10.0,
              recipientPhone: "+50987654321",
              status: "completed",
              product: {
                name: "Digicel Haiti 10 USD",
              },
              createdAt: "2024-01-15T10:30:00Z",
            },
          ],
          pagination: {
            total: 50,
            limit: 10,
            offset: 0,
          },
        },
      },
    },
    {
      method: "POST",
      path: "/api/v1/customer-transactions",
      description:
        "Send a top-up using the authenticated customer's balance (wallet)",
      scopes: ["topup:send", "balance:read"],
      body: {
        phoneNumber: "+50912345678",
        skuCode: "PROD_123",
        amount: 10.0,
        sendValue: 10.0,
        estimatedUsdCost: 10.0,
      },
      example: {
        response: {
          orderId: "ORD-1234567890",
          status: "completed",
          amount: 10.0,
          currency: "USD",
          paymentType: "balance",
          recipientPhone: "+50912345678",
          createdAt: "2024-01-15T10:30:00Z",
        },
      },
    },
    {
      method: "GET",
      path: "/api/v1/customers/{customerId}/balance",
      description: "Get detailed customer balance information",
      scopes: ["balance:read"],
      example: {
        response: {
          currentBalance: 100.0,
          totalAssigned: 500.0,
          totalUsed: 400.0,
          balanceCurrency: "USD",
        },
      },
    },
    {
      method: "GET",
      path: "/api/v1/customers/{customerId}/balance/history",
      description: "Get customer balance history with pagination",
      scopes: ["balance:read"],
      params: [
        {
          name: "limit",
          type: "number",
          description: "Number of results per page (default: 20)",
        },
        {
          name: "offset",
          type: "number",
          description: "Number of results to skip (default: 0)",
        },
      ],
      example: {
        response: {
          data: [
            {
              id: "bal_123",
              type: "credit",
              amount: 50.0,
              balance: 150.0,
              description: "Balance added",
              createdAt: "2024-01-15T10:30:00Z",
            },
          ],
          pagination: {
            total: 25,
            limit: 20,
            offset: 0,
          },
        },
      },
    },
    {
      method: "POST",
      path: "/api/v1/lookup/phone",
      description:
        "Lookup phone number to detect country, operator, and available products. Returns pricing and product details.",
      scopes: [],
      note: "Public endpoint - no authentication required",
      body: {
        phoneNumber: "+50912345678",
        orgSlug: "your-org-slug",
      },
      example: {
        response: {
          phoneNumber: "50912345678",
          country: {
            code: "HT",
            name: "Haiti",
          },
          detectedOperators: [
            {
              code: "DIGICEL_HT",
              name: "Digicel Haiti",
              logo: "https://example.com/logo.png",
            },
          ],
          products: [
            {
              skuCode: "PROD_123",
              name: "Digicel Haiti 10 USD",
              providerCode: "DIGICEL_HT",
              providerName: "Digicel Haiti",
              benefitType: "airtime",
              benefitAmount: 10.0,
              benefitUnit: "USD",
              pricing: {
                costPrice: 10.0,
                markup: 1.0,
                priceBeforeDiscount: 11.0,
                discount: 0.5,
                finalPrice: 10.5,
                discountApplied: true,
              },
              isVariableValue: false,
            },
          ],
          totalProducts: 25,
          branding: {
            businessName: "Your Business",
            primaryColor: "#6366f1",
          },
        },
      },
    },
    {
      method: "POST",
      path: "/api/v1/estimate",
      description: "Get price estimate for a specific product and amount",
      scopes: [],
      note: "Public endpoint - no authentication required",
      body: {
        orgSlug: "your-org-slug",
        skuCode: "PROD_123",
        sendValue: 10.0,
        sendCurrencyIso: "USD",
      },
      example: {
        response: {
          estimate: {
            sendValue: 10.0,
            sendCurrencyIso: "USD",
            receiveValue: 10.0,
            receiveCurrencyIso: "USD",
            fee: 0.5,
            totalCost: 10.5,
          },
          product: {
            skuCode: "PROD_123",
            name: "Digicel Haiti 10 USD",
          },
        },
      },
    },
    {
      method: "POST",
      path: "/api/v1/payments/process",
      description: "Process a top-up payment transaction",
      scopes: ["topup:send"],
      body: {
        orgSlug: "your-org-slug",
        phoneNumber: "50912345678",
        product: {
          skuCode: "PROD_123",
          name: "Digicel Haiti 10 USD",
          providerCode: "DIGICEL_HT",
          pricing: {
            finalPrice: 10.5,
          },
        },
        customerEmail: "customer@example.com",
        paymentMethod: "pgpay",
        amount: 10.5,
        sendValue: 10.0,
      },
      example: {
        response: {
          orderId: "ORD-1234567890",
          status: "pending",
          paymentUrl: "https://payment-provider.com/pay/abc123",
          pgPayToken: "token_abc123",
          expiresAt: "2024-01-15T10:45:00Z",
        },
      },
    },
    {
      method: "POST",
      path: "/api/v1/payments/verify",
      description: "Verify payment status and complete transaction",
      scopes: ["transactions:read"],
      body: {
        orderId: "ORD-1234567890",
        pgPayToken: "token_abc123",
      },
      example: {
        response: {
          status: "completed",
          transaction: {
            id: "txn_123",
            orderId: "ORD-1234567890",
            amount: 10.5,
            recipientPhone: "+50912345678",
            status: "completed",
            dingTransferId: "12345",
            createdAt: "2024-01-15T10:30:00Z",
          },
        },
      },
    },
    {
      method: "GET",
      path: "/api/v1/api-keys",
      description: "List all API keys for the authenticated customer",
      scopes: [],
      note: "Requires customer authentication. Add ?customer=true query parameter.",
      params: [
        {
          name: "customer",
          type: "boolean",
          description: "Set to 'true' for customer API keys",
        },
      ],
      example: {
        response: {
          keys: [
            {
              id: "key_123",
              name: "Production Key",
              keyPrefix: "pk_live_abc",
              scopes: ["balance:read", "transactions:read"],
              createdAt: "2024-01-15T10:30:00Z",
              lastUsedAt: "2024-01-20T15:45:00Z",
              usageCount: 150,
            },
          ],
        },
      },
    },
    {
      method: "POST",
      path: "/api/v1/api-keys",
      description: "Create a new API key with specified scopes",
      scopes: [],
      note: "Requires customer authentication. Add ?customer=true query parameter. The full key is only shown once.",
      params: [
        {
          name: "customer",
          type: "boolean",
          description: "Set to 'true' for customer API keys",
        },
      ],
      body: {
        name: "Production Key",
        scopes: ["balance:read", "transactions:read", "topup:send"],
      },
      example: {
        response: {
          message:
            "API key created successfully. Store this key securely - you won't be able to see it again.",
          key: "pk_live_abc123def456ghi789jkl012mno345",
          apiKey: {
            id: "key_123",
            name: "Production Key",
            keyPrefix: "pk_live_abc",
            scopes: ["balance:read", "transactions:read", "topup:send"],
            createdAt: "2024-01-15T10:30:00Z",
          },
        },
      },
    },
    {
      method: "DELETE",
      path: "/api/v1/api-keys/{keyId}",
      description: "Revoke an API key. Add ?customer=true query parameter.",
      scopes: [],
      note: "Requires customer authentication. The key will be immediately deactivated.",
      params: [
        {
          name: "customer",
          type: "boolean",
          description: "Set to 'true' for customer API keys",
        },
      ],
      example: {
        response: {
          message: "API key revoked successfully",
        },
      },
    },
  ];

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <BookOpen className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold text-gray-900">
            API Documentation
          </h1>
        </div>
        <p className="text-gray-600 text-lg">
          Learn how to integrate with our API to automate mobile top-ups and
          manage your account programmatically.
        </p>
      </div>

      {/* Getting Started */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <CardTitle>Getting Started</CardTitle>
          </div>
          <CardDescription>Quick guide to start using the API</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="font-semibold text-gray-900 mb-2">
              1. Create an API Key
            </h3>
            <p className="text-gray-600 text-sm">
              Navigate to the{" "}
              <a
                href={`/customer-portal/${orgSlug}/api-keys`}
                className="text-primary hover:underline"
              >
                API Keys
              </a>{" "}
              page and create a new key with the required scopes for your use
              case.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-gray-900 mb-2">
              2. Authenticate Your Requests
            </h3>
            <p className="text-gray-600 text-sm mb-2">
              Include your API key in the Authorization header:
            </p>
            <div className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm font-mono overflow-x-auto">
              <code>Authorization: Bearer YOUR_API_KEY</code>
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-gray-900 mb-2">
              3. Make API Requests
            </h3>
            <p className="text-gray-600 text-sm mb-2">
              All API requests should be made to:
            </p>
            <div className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm font-mono overflow-x-auto">
              <code>
                {typeof window !== "undefined"
                  ? window.location.origin
                  : "https://your-domain.com"}
                /api/v1/...
              </code>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Base URL */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code className="h-5 w-5" />
            Base URL
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-gray-900 text-gray-100 p-4 rounded-lg font-mono text-sm overflow-x-auto">
            {typeof window !== "undefined"
              ? window.location.origin
              : "https://your-domain.com"}
            /api/v1
          </div>
        </CardContent>
      </Card>

      {/* Authentication */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Authentication
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-gray-600">
            The API uses Bearer token authentication. Include your API key in
            the Authorization header of every request.
          </p>

          <div>
            <h4 className="font-semibold text-gray-900 mb-2">
              Example Request:
            </h4>
            <div className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm font-mono overflow-x-auto">
              <pre>{`curl -X GET \\
  ${typeof window !== "undefined" ? window.location.origin : "https://your-domain.com"}/api/v1/customer-auth/me \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json"`}</pre>
            </div>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg">
            <p className="text-sm text-yellow-800">
              <strong>Security Note:</strong> Keep your API keys secure and
              never share them publicly. Rotate keys regularly and revoke any
              compromised keys immediately.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* API Endpoints */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">API Endpoints</h2>
          <div className="flex gap-2">
            <button
              onClick={expandAll}
              className="text-sm text-primary hover:underline font-medium"
            >
              Expand All
            </button>
            <span className="text-sm text-gray-400">|</span>
            <button
              onClick={collapseAll}
              className="text-sm text-primary hover:underline font-medium"
            >
              Collapse All
            </button>
          </div>
        </div>

        {endpoints.map((endpoint, index) => {
          const isExpanded = expandedEndpoints.has(index);
          return (
            <Card key={index}>
              <CardHeader
                className="cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => toggleEndpoint(index)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      {isExpanded ? (
                        <ChevronDown className="h-5 w-5 text-gray-500 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="h-5 w-5 text-gray-500 flex-shrink-0" />
                      )}
                      <Badge
                        variant={
                          endpoint.method === "GET" ? "default" : "secondary"
                        }
                        className="font-mono"
                      >
                        {endpoint.method}
                      </Badge>
                      <code className="text-sm font-mono text-gray-700">
                        {endpoint.path}
                      </code>
                    </div>
                    <CardDescription className="ml-8">
                      {endpoint.description}
                    </CardDescription>
                  </div>
                </div>

                {endpoint.scopes && endpoint.scopes.length > 0 && (
                  <div className="flex items-center gap-2 mt-3 ml-8">
                    <span className="text-xs font-semibold text-gray-500">
                      Required Scopes:
                    </span>
                    {endpoint.scopes.map((scope) => (
                      <Badge key={scope} variant="outline" className="text-xs">
                        {scope}
                      </Badge>
                    ))}
                  </div>
                )}

                {endpoint.note && (
                  <div className="bg-blue-50 border border-blue-200 p-2 rounded text-sm text-blue-800 mt-3 ml-8">
                    <strong>Note:</strong> {endpoint.note}
                  </div>
                )}
              </CardHeader>

              {isExpanded && (
                <CardContent className="space-y-4 border-t">
                  {endpoint.params && (
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-2">
                        Query Parameters:
                      </h4>
                      <div className="space-y-2">
                        {endpoint.params.map((param) => (
                          <div key={param.name} className="flex gap-2 text-sm">
                            <code className="text-primary font-mono">
                              {param.name}
                            </code>
                            <span className="text-gray-400">
                              ({param.type})
                            </span>
                            <span className="text-gray-600">
                              - {param.description}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {endpoint.body && (
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-2">
                        Request Body:
                      </h4>
                      <div className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm font-mono overflow-x-auto">
                        <pre>{JSON.stringify(endpoint.body, null, 2)}</pre>
                      </div>
                    </div>
                  )}

                  {endpoint.example && (
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-2">
                        Example Response:
                      </h4>
                      <div className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm font-mono overflow-x-auto">
                        <pre>
                          {JSON.stringify(endpoint.example.response, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {/* Rate Limits */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Rate Limits</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-gray-600">
            API requests are rate-limited to ensure fair usage and system
            stability.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border rounded-lg p-4">
              <div className="text-2xl font-bold text-primary">1,000</div>
              <div className="text-sm text-gray-600">requests per hour</div>
            </div>
            <div className="border rounded-lg p-4">
              <div className="text-2xl font-bold text-primary">100</div>
              <div className="text-sm text-gray-600">requests per minute</div>
            </div>
            <div className="border rounded-lg p-4">
              <div className="text-2xl font-bold text-primary">429</div>
              <div className="text-sm text-gray-600">
                status on limit exceeded
              </div>
            </div>
          </div>

          <p className="text-sm text-gray-600">
            Rate limit information is included in response headers:
          </p>
          <div className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm font-mono overflow-x-auto">
            <pre>{`X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1640995200`}</pre>
          </div>
        </CardContent>
      </Card>

      {/* Error Handling */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Error Handling</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-gray-600">
            The API uses standard HTTP response codes and returns errors in RFC
            7807 Problem Details format.
          </p>

          <div>
            <h4 className="font-semibold text-gray-900 mb-2">
              Common Error Codes:
            </h4>
            <div className="space-y-2">
              <div className="flex gap-3 text-sm">
                <code className="text-red-600 font-mono font-semibold">
                  400
                </code>
                <span className="text-gray-600">
                  Bad Request - Invalid request parameters
                </span>
              </div>
              <div className="flex gap-3 text-sm">
                <code className="text-red-600 font-mono font-semibold">
                  401
                </code>
                <span className="text-gray-600">
                  Unauthorized - Invalid or missing API key
                </span>
              </div>
              <div className="flex gap-3 text-sm">
                <code className="text-red-600 font-mono font-semibold">
                  403
                </code>
                <span className="text-gray-600">
                  Forbidden - Insufficient permissions for the requested
                  resource
                </span>
              </div>
              <div className="flex gap-3 text-sm">
                <code className="text-red-600 font-mono font-semibold">
                  404
                </code>
                <span className="text-gray-600">
                  Not Found - Resource does not exist
                </span>
              </div>
              <div className="flex gap-3 text-sm">
                <code className="text-red-600 font-mono font-semibold">
                  429
                </code>
                <span className="text-gray-600">
                  Too Many Requests - Rate limit exceeded
                </span>
              </div>
              <div className="flex gap-3 text-sm">
                <code className="text-red-600 font-mono font-semibold">
                  500
                </code>
                <span className="text-gray-600">
                  Internal Server Error - Something went wrong on our end
                </span>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-gray-900 mb-2">
              Error Response Format:
            </h4>
            <div className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm font-mono overflow-x-auto">
              <pre>
                {JSON.stringify(
                  {
                    type: "https://api.example.com/errors/invalid-request",
                    title: "Invalid Request",
                    status: 400,
                    detail: "The 'phoneNumber' field is required",
                    instance: "/api/v1/topup/send",
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Support */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Need Help?</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-600 mb-4">
            If you have questions or need assistance with the API, please
            contact our support team.
          </p>
          <div className="flex gap-4">
            <a
              href={`/customer-portal/${orgSlug}/settings`}
              className="text-primary hover:underline text-sm"
            >
              View Contact Information
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
