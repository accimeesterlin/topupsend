/**
 * @jest-environment node
 *
 * Regression pins for the partner settle fix —
 * exercises the REAL settleStuckTransfer from fulfillment.service
 * with only persistence, DingConnect and the refund service mocked.
 *
 * Audit question: a PARTNER transaction (paymentGateway "partner",
 * no customer, funded by the org's DingConnect account) that settles
 * to Failed must NOT go through processRefund — processRefund finds
 * or CREATES a Customer by phone and credits that customer's balance
 * (refund.service.ts), i.e. it would mint balance for a person who
 * never paid TopUpSend anything, while PGecom separately refunds its
 * organization. Partner failures must simply record "failed".
 */
const mockDing = { getTransferStatus: jest.fn() };
const mockProcessRefund = jest.fn().mockResolvedValue({ success: true });

jest.mock("@/lib/services/dingconnect.service", () => ({
  createDingConnectService: jest.fn(() => mockDing),
}));
jest.mock("@/lib/services/refund.service", () => ({
  processRefund: (...args: unknown[]) => mockProcessRefund(...args),
}));
jest.mock("@/lib/services/usage-tracking.service", () => ({
  trackTransactionCompletion: jest.fn(),
}));
jest.mock("@/lib/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("@topupsend/db", () => ({
  Customer: { findByOrgAndIdentifier: jest.fn(), create: jest.fn() },
  Integration: {
    findOne: jest.fn(() => ({
      select: jest.fn().mockResolvedValue({ credentials: { apiKey: "ding-key" } }),
    })),
  },
  StorefrontSettings: {
    findOne: jest.fn().mockResolvedValue({ metadata: {}, save: jest.fn() }),
  },
  Transaction: { findOneAndUpdate: jest.fn() },
}));

import { settleStuckTransfer } from "@/lib/services/fulfillment.service";

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    _id: "tx-1",
    orderId: "ORD-1",
    orgId: "org1",
    status: "processing",
    providerTransactionId: "777",
    amount: 10,
    currency: "USD",
    recipient: { phoneNumber: "+50934748112" },
    timeline: { processingAt: new Date() },
    metadata: {},
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockProcessRefund.mockResolvedValue({ success: true });
});

describe("VERIFY settleStuckTransfer — Failed settle", () => {
  it("partner transaction: records failed WITHOUT processRefund (no phantom customer balance)", async () => {
    mockDing.getTransferStatus.mockResolvedValue({
      TransferId: 777,
      Status: "Failed",
      ErrorMessage: "InsufficientBalance",
    });
    const tx = makeTx({ paymentGateway: "partner", paymentType: "gateway", customerId: undefined });

    const result = await settleStuckTransfer(tx);

    console.log("SETTLE PARTNER FAILED:", JSON.stringify({ result, status: tx.status, failureReason: tx.metadata.failureReason, refundCalled: mockProcessRefund.mock.calls.length }));
    expect(mockProcessRefund).not.toHaveBeenCalled();
    expect(tx.status).toBe("failed");
    expect(tx.metadata.failureReason).toBe("InsufficientBalance");
    expect(result).toBe("failed");
  });

  it("customer transaction (control): still refunds via processRefund", async () => {
    mockDing.getTransferStatus.mockResolvedValue({
      TransferId: 777,
      Status: "Failed",
      ErrorMessage: "InsufficientBalance",
    });
    const tx = makeTx({ paymentGateway: "stripe", paymentType: "gateway", customerId: "cust-1" });

    const result = await settleStuckTransfer(tx);

    console.log("SETTLE CUSTOMER FAILED:", JSON.stringify({ result, refundCalled: mockProcessRefund.mock.calls.length }));
    expect(mockProcessRefund).toHaveBeenCalledTimes(1);
    expect(result).toBe("refunded");
  });

  it("partner transaction settling to Completed completes without refund", async () => {
    mockDing.getTransferStatus.mockResolvedValue({ TransferId: 777, Status: "Completed" });
    const tx = makeTx({ paymentGateway: "partner", paymentType: "gateway" });

    const result = await settleStuckTransfer(tx);

    expect(result).toBe("completed");
    expect(tx.status).toBe("completed");
    expect(mockProcessRefund).not.toHaveBeenCalled();
  });
});
