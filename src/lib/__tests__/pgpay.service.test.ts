/**
 * PGPayService dual-contract tests (Phase 5 migration): the service
 * selects v1 vs v2 purely from the credentials it is built with.
 * v1 stays byte-identical (userID in the token payload, v1 base);
 * with an org apiKey present it speaks the v2 org contract (v2 base,
 * Bearer header, NO userID in the payload — PG's v2 schema rejects
 * one) and captures the merchantId PG names in the token response,
 * which the connection test returns for the caller to persist.
 */
import { PGPayService, createPGPayService } from "../services/pgpay.service";

jest.mock("@/lib/logger", () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

const fetchMock = jest.fn();

function jsonResponse(status: number, body: Record<string, unknown>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const TOKEN_OK = {
  token: "jwt-token",
  orderId: "ord-1",
  redirectUrl: "https://sandbox.pgecom.com/payment/pgpay/jwt-token",
  amount: 10,
  currency: "usd",
  status: "pending",
};

const REQUEST = {
  amount: 10,
  orderId: "ord-1",
  customerEmail: "buyer@example.com",
  customerFirstName: "Buyer",
  customerLastName: "One",
  successUrl: "https://topupsend.example/ok",
  errorUrl: "https://topupsend.example/err",
};

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe("PGPayService — v1 (user ID only)", () => {
  it("posts userID to the v1 token endpoint without an auth header", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, TOKEN_OK));
    const service = createPGPayService({
      userId: "4b6e660b-29a8-4cb9-95a5-72154d8a3374",
      environment: "sandbox",
    });
    expect(service.isV2).toBe(false);
    await service.createPayment(REQUEST);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sandbox.pgecom.com/api/pgpay/token");
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body).userID).toBe(
      "4b6e660b-29a8-4cb9-95a5-72154d8a3374",
    );
  });

  it("verifies against the v1 order endpoint", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        orderId: "ord-1",
        status: "completed",
        paymentStatus: "completed",
        amount: 10,
      }),
    );
    const service = createPGPayService({
      userId: "4b6e660b-29a8-4cb9-95a5-72154d8a3374",
      environment: "sandbox",
    });
    const result = await service.verifyPayment({ pgPayToken: "jwt-token" });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sandbox.pgecom.com/api/pgpay/order");
    expect(result.status).toBe("completed");
  });
});

describe("PGPayService — v2 (org API key)", () => {
  const v2 = () =>
    createPGPayService({
      userId: "4b6e660b-29a8-4cb9-95a5-72154d8a3374",
      merchantId: "pg-org-77",
      apiKey: "sk_sandbox_example",
      environment: "sandbox",
    });

  it("posts to the v2 token endpoint with Bearer auth and NO userID", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { ...TOKEN_OK, merchantId: "pg-org-77" }),
    );
    const service = v2();
    expect(service.isV2).toBe(true);
    const result = await service.createPayment(REQUEST);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sandbox.pgecom.com/api/pgpay/v2/token");
    expect(init.headers.Authorization).toBe("Bearer sk_sandbox_example");
    expect(JSON.parse(init.body).userID).toBeUndefined();
    expect(result.merchantId).toBe("pg-org-77");
  });

  it("treats the key alone as sufficient (no userId needed)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, TOKEN_OK));
    const service = createPGPayService({
      apiKey: "sk_sandbox_example",
      environment: "production",
    });
    await service.createPayment(REQUEST);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.pgecom.com/api/pgpay/v2/token");
  });

  it("verifies against the v2 order endpoint with the key header", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        orderId: "ord-1",
        status: "completed",
        paymentStatus: "completed",
        amount: 10,
        merchantId: "pg-org-77",
        refundedAmount: 0,
        refundStatus: "none",
      }),
    );
    const result = await v2().verifyPayment({ pgPayToken: "jwt-token" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sandbox.pgecom.com/api/pgpay/v2/order");
    expect(init.headers.Authorization).toBe("Bearer sk_sandbox_example");
    expect(result.merchantId).toBe("pg-org-77");
    expect(result.refundStatus).toBe("none");
  });

  it("connection test returns the learned merchantId (the flip step)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { ...TOKEN_OK, merchantId: "pg-org-77" }),
    );
    const result = await v2().testConnection();
    expect(result.success).toBe(true);
    expect(result.merchantId).toBe("pg-org-77");
  });

  it("connection test names an unrecognized API key as the failure", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { message: "Invalid API key" }),
    );
    const result = await v2().testConnection();
    expect(result.success).toBe(false);
    expect(result.message).toContain("API key not recognized");
  });
});
