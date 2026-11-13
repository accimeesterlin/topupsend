/**
 * Cluster 1 pins — fulfillment atomic claim (F-C7), honest
 * DingConnect outcomes (F-H6/F-H7), refund idempotency and refund
 * reversal (F-C8).
 *
 * FAIL on pristine sandbox (fulfillment had no claim/guard and marked
 * Processing results completed; refunds could double-credit), PASS on
 * the fix branch.
 */
import {
  Customer,
  CustomerBalanceHistory,
  Integration,
  StorefrontSettings,
  Transaction,
} from "@topupsend/db";
import {
  fulfillPaidTransaction,
  isDefiniteProviderRejection,
} from "../services/fulfillment.service";
import { processRefund, reverseRefundCredit } from "../services/refund.service";

const mockSendTransfer = jest.fn();
const mockGetTransferStatus = jest.fn();

jest.mock("@topupsend/db", () => ({
  Transaction: { findOneAndUpdate: jest.fn(), findOne: jest.fn() },
  Integration: { findOne: jest.fn() },
  StorefrontSettings: { findOne: jest.fn() },
  Customer: {
    findById: jest.fn(),
    findByOrgAndIdentifier: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
  },
  CustomerBalanceHistory: { create: jest.fn() },
  Organization: { findOne: jest.fn() },
}));

jest.mock("@/lib/services/dingconnect.service", () => ({
  createDingConnectService: jest.fn(() => ({
    sendTransfer: mockSendTransfer,
    getTransferStatus: mockGetTransferStatus,
  })),
}));

jest.mock("@/lib/services/usage-tracking.service", () => ({
  trackTransactionCompletion: jest.fn(),
}));

jest.mock("@/lib/services/email.service", () => ({
  EmailService: jest.fn(),
}));

const mockTxFindOneAndUpdate = Transaction.findOneAndUpdate as jest.Mock;
const mockIntegrationFindOne = Integration.findOne as jest.Mock;
const mockSettingsFindOne = StorefrontSettings.findOne as jest.Mock;
const mockCustomerFindById = Customer.findById as jest.Mock;
const mockCustomerFindByIdentifier =
  Customer.findByOrgAndIdentifier as jest.Mock;
const mockHistoryCreate = CustomerBalanceHistory.create as jest.Mock;

function makeTransaction(overrides: Record<string, unknown> = {}) {
  const tx: Record<string, unknown> = {
    _id: "tx1",
    orderId: "ORD-1",
    orgId: "org1",
    amount: 25,
    currency: "USD",
    status: "paid",
    paymentType: "pgpay",
    paymentGateway: "pgpay",
    provider: "dingconnect",
    productId: "ding-SKU1",
    customerId: "cust1",
    recipient: { phoneNumber: "+50937000000", email: "buyer@example.com" },
    operator: { id: "OP1", name: "Op One", country: "HT" },
    metadata: {
      productSkuCode: "SKU1",
      productName: "Top-up",
      isVariableValue: false,
      sendValue: 10,
    },
    timeline: {},
    save: jest.fn(async function (this: Record<string, unknown>) {
      return this;
    }),
    ...overrides,
  };
  return tx as never;
}

function makeCustomer(balance = 100) {
  return {
    _id: "cust1",
    orgId: "org1",
    email: "buyer@example.com",
    phoneNumber: "+50937000000",
    currentBalance: balance,
    totalUsed: 40,
    metadata: {},
    refundBalance: jest.fn(async function (
      this: { currentBalance: number },
      amount: number,
    ) {
      this.currentBalance += amount;
    }),
    save: jest.fn(async function (this: unknown) {
      return this;
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();

  mockIntegrationFindOne.mockReturnValue({
    select: jest.fn().mockResolvedValue({
      credentials: { apiKey: "ding-key" },
    }),
  });
  mockSettingsFindOne.mockResolvedValue({
    topupSettings: { validateOnly: false },
    metadata: {},
    save: jest.fn(async () => ({})),
  });
  mockCustomerFindByIdentifier.mockResolvedValue(makeCustomer());
  mockHistoryCreate.mockResolvedValue({});
});

describe("fulfillment atomic claim (F-C7)", () => {
  it("fulfills a paid transaction when the claim is won", async () => {
    const tx = makeTransaction();
    mockTxFindOneAndUpdate.mockResolvedValue({
      timeline: { processingAt: new Date() },
    });
    mockSendTransfer.mockResolvedValue({
      TransferId: 555,
      Status: "Completed",
    });

    const result = await fulfillPaidTransaction({
      transaction: tx,
      refundSource: "pgpay_webhook",
    });

    expect(result.outcome).toBe("fulfilled");
    expect((tx as { status: string }).status).toBe("completed");
    expect(mockTxFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: "tx1", status: "paid" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "processing" }) }),
      { new: true },
    );
  });

  it("second claim gets nothing — sendTransfer is never called twice", async () => {
    const tx = makeTransaction();
    mockTxFindOneAndUpdate.mockResolvedValue(null); // claim lost

    const result = await fulfillPaidTransaction({
      transaction: tx,
      refundSource: "pgpay_webhook",
    });

    expect(result.outcome).toBe("skipped");
    expect(mockSendTransfer).not.toHaveBeenCalled();
  });

  it("a refunded order is refused fulfillment outright", async () => {
    const tx = makeTransaction({
      status: "refunded",
      timeline: { refundedAt: new Date() },
    });

    const result = await fulfillPaidTransaction({
      transaction: tx,
      refundSource: "pgpay_webhook",
    });

    expect(result.outcome).toBe("skipped");
    expect(mockSendTransfer).not.toHaveBeenCalled();
    expect(mockTxFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("an already-completed order is not re-fulfilled", async () => {
    const tx = makeTransaction({ status: "completed" });

    const result = await fulfillPaidTransaction({
      transaction: tx,
      refundSource: "reconciliation_sweep",
    });

    expect(result.outcome).toBe("skipped");
    expect(mockSendTransfer).not.toHaveBeenCalled();
  });
});

describe("honest DingConnect outcomes (F-H6/F-H7)", () => {
  beforeEach(() => {
    mockTxFindOneAndUpdate.mockResolvedValue({
      timeline: { processingAt: new Date() },
    });
  });

  it("a Processing result is NOT recorded completed", async () => {
    const tx = makeTransaction();
    mockSendTransfer.mockResolvedValue({
      TransferId: 777,
      Status: "Processing",
    });
    mockGetTransferStatus.mockResolvedValue({
      TransferId: 777,
      Status: "Processing",
    });

    const result = await fulfillPaidTransaction({
      transaction: tx,
      refundSource: "pgpay_webhook",
    });

    expect(result.outcome).toBe("pending-verification");
    expect((tx as { status: string }).status).toBe("processing");
    expect(
      (tx as { metadata: Record<string, unknown> }).metadata.transferOutcome,
    ).toBe("unknown");
  });

  it("a Processing result that settles Completed completes the order", async () => {
    const tx = makeTransaction();
    mockSendTransfer.mockResolvedValue({
      TransferId: 778,
      Status: "Processing",
    });
    mockGetTransferStatus.mockResolvedValue({
      TransferId: 778,
      Status: "Completed",
    });

    const result = await fulfillPaidTransaction({
      transaction: tx,
      refundSource: "pgpay_webhook",
    });

    expect(result.outcome).toBe("fulfilled");
    expect((tx as { status: string }).status).toBe("completed");
  });

  it("a post-send timeout is unknown — never refunded, never completed", async () => {
    const tx = makeTransaction();
    const customer = makeCustomer();
    mockCustomerFindById.mockResolvedValue(customer);
    mockSendTransfer.mockRejectedValue(
      new Error("The operation was aborted (timeout)"),
    );

    const result = await fulfillPaidTransaction({
      transaction: tx,
      refundSource: "pgpay_webhook",
    });

    expect(result.outcome).toBe("pending-verification");
    expect((tx as { status: string }).status).toBe("processing");
    expect(customer.refundBalance).not.toHaveBeenCalled();
  });

  it("a definite 4xx rejection takes the refund path", async () => {
    const tx = makeTransaction();
    const customer = makeCustomer();
    mockCustomerFindById.mockResolvedValue(customer);
    // processRefund's atomic claim succeeds
    mockTxFindOneAndUpdate
      .mockResolvedValueOnce({ timeline: { processingAt: new Date() } })
      .mockResolvedValueOnce({ timeline: { refundedAt: new Date() } });
    mockSendTransfer.mockRejectedValue(
      new Error(
        "DingConnect API Error: 400 Bad Request | URL: /api/V1/SendTransfer",
      ),
    );

    const result = await fulfillPaidTransaction({
      transaction: tx,
      refundSource: "pgpay_webhook",
    });

    expect(result.outcome).toBe("refund-error");
    expect(customer.refundBalance).toHaveBeenCalledTimes(1);
  });

  it("classifies only DingConnect 4xx as definite rejection", () => {
    expect(
      isDefiniteProviderRejection(
        new Error("DingConnect API Error: 403 Forbidden"),
      ),
    ).toBe(true);
    expect(
      isDefiniteProviderRejection(
        new Error("DingConnect API Error: 503 Service Unavailable"),
      ),
    ).toBe(false);
    expect(isDefiniteProviderRejection(new Error("fetch failed"))).toBe(
      false,
    );
    expect(isDefiniteProviderRejection(new Error("AbortError"))).toBe(false);
  });
});

describe("refund idempotency (F-C8)", () => {
  beforeEach(() => {
    // Deterministic claim behavior per test (no leaked Once queues).
    mockTxFindOneAndUpdate.mockReset();
  });

  it("a second refund of the same order credits nothing", async () => {
    const tx = makeTransaction({ status: "processing" });
    const customer = makeCustomer();
    mockCustomerFindById.mockResolvedValue(customer);
    // First refund wins the atomic claim. The second call is stopped
    // by the refunded-state guard (and would lose the claim anyway).
    mockTxFindOneAndUpdate.mockResolvedValueOnce({
      timeline: { refundedAt: new Date() },
    });

    const first = await processRefund({
      transaction: tx,
      failureReason: "Provider failed",
    });
    expect(first.balanceRefunded).toBe(true);
    expect(customer.refundBalance).toHaveBeenCalledTimes(1);
    expect(customer.currentBalance).toBe(125);

    const second = await processRefund({
      transaction: tx,
      failureReason: "Provider failed (duplicate attempt)",
    });
    expect(second.balanceRefunded).toBe(false);
    expect(customer.refundBalance).toHaveBeenCalledTimes(1);
    expect(customer.currentBalance).toBe(125);
  });

  it("records the refunded amount for later reversal", async () => {
    const tx = makeTransaction({ status: "processing" });
    const customer = makeCustomer();
    mockCustomerFindById.mockResolvedValue(customer);
    mockTxFindOneAndUpdate.mockResolvedValue({
      timeline: { refundedAt: new Date() },
    });

    await processRefund({ transaction: tx, failureReason: "Failed" });

    const metadata = (tx as { metadata: Record<string, unknown> }).metadata;
    expect(metadata.refundedAmount).toBe(25);
    expect(metadata.refundCustomerId).toBe("cust1");
  });
});

describe("reverseRefundCredit (F-C8)", () => {
  it("deducts the credited amount back before a retry re-sends", async () => {
    const customer = makeCustomer(125);
    mockCustomerFindById.mockResolvedValue(customer);
    const tx = makeTransaction({
      status: "processing",
      timeline: { refundedAt: new Date() },
      metadata: { refundedAmount: 25, refundCustomerId: "cust1" },
    });

    const result = await reverseRefundCredit(tx);

    expect(result.reversed).toBe(true);
    expect(result.reversedAmount).toBe(25);
    expect(customer.currentBalance).toBe(100);
    expect(mockHistoryCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: -25, type: "adjustment" }),
    );
  });

  it("is idempotent — a second reversal takes nothing", async () => {
    const customer = makeCustomer(125);
    mockCustomerFindById.mockResolvedValue(customer);
    const tx = makeTransaction({
      status: "processing",
      timeline: { refundedAt: new Date() },
      metadata: { refundedAmount: 25, refundCustomerId: "cust1" },
    });

    await reverseRefundCredit(tx);
    const second = await reverseRefundCredit(tx);

    expect(second.reversed).toBe(false);
    expect(customer.currentBalance).toBe(100);
  });

  it("records a shortfall instead of driving the balance negative", async () => {
    const customer = makeCustomer(10); // most of the credit already spent
    mockCustomerFindById.mockResolvedValue(customer);
    const tx = makeTransaction({
      status: "processing",
      timeline: { refundedAt: new Date() },
      metadata: { refundedAmount: 25, refundCustomerId: "cust1" },
    });

    const result = await reverseRefundCredit(tx);

    expect(result.reversedAmount).toBe(10);
    expect(result.shortfall).toBe(15);
    expect(customer.currentBalance).toBe(0);
  });
});
