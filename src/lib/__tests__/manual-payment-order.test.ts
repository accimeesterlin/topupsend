/**
 * Tests for applying a manual payment to an existing order, plus the
 * double-fulfillment guard predicate used by the PGPay webhook.
 * Models and the fulfillment service are mocked (repo test style).
 */
import { ManualPayment, Transaction } from "@topupsend/db";
import { fulfillPaidTransaction } from "@/lib/services/fulfillment.service";
import {
  isManuallyPaidTransaction,
  recordOrderManualPayment,
} from "../services/manual-payment.service";
import type { CreateManualPaymentInput } from "../validations/manual-payment";

// Mock api-error: the real module imports next/server, which cannot load
// under the jsdom test environment.
jest.mock("@/lib/api-error", () => {
  class ApiException extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiException,
    ApiErrors: {
      BadRequest: (detail?: string) =>
        new ApiException(400, detail || "Bad Request"),
      Conflict: (detail?: string) =>
        new ApiException(409, detail || "Conflict"),
      Forbidden: (detail?: string) =>
        new ApiException(403, detail || "Forbidden"),
      NotFound: (detail?: string) =>
        new ApiException(404, detail || "Not Found"),
      InternalServerError: (detail?: string) =>
        new ApiException(500, detail || "Internal Server Error"),
    },
    handleApiError: jest.fn(),
  };
});

jest.mock("@topupsend/db", () => ({
  Customer: { findById: jest.fn() },
  CustomerBalanceHistory: { create: jest.fn() },
  ManualPayment: {
    create: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    countDocuments: jest.fn(),
  },
  Transaction: { findOne: jest.fn() },
}));

jest.mock("@/lib/services/fulfillment.service", () => ({
  fulfillPaidTransaction: jest.fn(),
}));

const mockTransactionFindOne = Transaction.findOne as jest.Mock;
const mockPaymentCreate = ManualPayment.create as jest.Mock;
const mockPaymentFindOne = ManualPayment.findOne as jest.Mock;
const mockFulfill = fulfillPaidTransaction as jest.Mock;

function makeTransaction(overrides: Record<string, unknown> = {}) {
  return {
    _id: "txn-1",
    orderId: "ORD-1",
    orgId: "org-1",
    customerId: "cust-1",
    amount: 40,
    currency: "USD",
    status: "pending",
    paymentType: "gateway",
    paymentGateway: undefined as string | undefined,
    paymentId: undefined as string | undefined,
    isTestMode: false,
    timeline: { createdAt: new Date(), paidAt: undefined as Date | undefined },
    metadata: { retryCount: 0 },
    save: jest.fn(async function (this: any) {
      return this;
    }),
    ...overrides,
  };
}

const orderInput: CreateManualPaymentInput = {
  appliedTo: "order",
  transactionId: "txn-1",
  amount: 40,
  currency: "USD",
  method: "bank_transfer",
  reference: "BT-123",
  receivedAt: "2026-10-27T15:00:00.000Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPaymentFindOne.mockResolvedValue(null);
  mockPaymentCreate.mockImplementation(async (data: any) => ({
    _id: "mp-1",
    ...data,
    save: jest.fn(),
  }));
  mockFulfill.mockResolvedValue({ outcome: "fulfilled", status: "completed" });
});

describe("recordOrderManualPayment", () => {
  it("records the payment, marks the order paid as manual, and fulfills it", async () => {
    const transaction = makeTransaction();
    mockTransactionFindOne.mockResolvedValue(transaction);

    const result = await recordOrderManualPayment({
      orgId: "org-1",
      recordedBy: "user-1",
      input: orderInput,
    });

    expect(mockPaymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        appliedTo: "order",
        transactionId: "txn-1",
        orderId: "ORD-1",
        amount: 40,
      }),
    );
    expect(transaction.paymentGateway).toBe("manual");
    expect(transaction.paymentId).toBe("mp-1");
    expect(transaction.timeline.paidAt).toEqual(
      new Date("2026-10-27T15:00:00.000Z"),
    );
    expect(mockFulfill).toHaveBeenCalledTimes(1);
    const fulfillArgs = mockFulfill.mock.calls[0][0];
    expect(fulfillArgs.refundSource).toBe("manual_payment");
    expect(fulfillArgs.transaction.status).toBe("paid");
    expect(result.manualPayment._id).toBe("mp-1");
  });

  it("looks the order up scoped to the session org and 404s otherwise", async () => {
    mockTransactionFindOne.mockResolvedValue(null);

    await expect(
      recordOrderManualPayment({
        orgId: "org-9",
        recordedBy: "user-1",
        input: orderInput,
      }),
    ).rejects.toMatchObject({ status: 404 });

    expect(mockTransactionFindOne).toHaveBeenCalledWith({
      _id: "txn-1",
      orgId: "org-9",
    });
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it("rejects an order that is not awaiting payment", async () => {
    mockTransactionFindOne.mockResolvedValue(
      makeTransaction({ status: "completed" }),
    );

    await expect(
      recordOrderManualPayment({
        orgId: "org-1",
        recordedBy: "user-1",
        input: orderInput,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(mockPaymentCreate).not.toHaveBeenCalled();
    expect(mockFulfill).not.toHaveBeenCalled();
  });

  it("rejects a second manual payment for the same order", async () => {
    mockTransactionFindOne.mockResolvedValue(makeTransaction());
    mockPaymentFindOne.mockResolvedValue({ _id: "mp-existing" });

    await expect(
      recordOrderManualPayment({
        orgId: "org-1",
        recordedBy: "user-1",
        input: orderInput,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it("rejects partial payment of an order (full amount only)", async () => {
    mockTransactionFindOne.mockResolvedValue(makeTransaction());

    await expect(
      recordOrderManualPayment({
        orgId: "org-1",
        recordedBy: "user-1",
        input: { ...orderInput, amount: 20 },
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it("rejects a currency mismatch instead of converting", async () => {
    mockTransactionFindOne.mockResolvedValue(makeTransaction());

    await expect(
      recordOrderManualPayment({
        orgId: "org-1",
        recordedBy: "user-1",
        input: { ...orderInput, currency: "HTG" },
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it("rejects test-mode orders", async () => {
    mockTransactionFindOne.mockResolvedValue(
      makeTransaction({ isTestMode: true }),
    );

    await expect(
      recordOrderManualPayment({
        orgId: "org-1",
        recordedBy: "user-1",
        input: orderInput,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it("accepts a failed order as a retry and fulfills it", async () => {
    const transaction = makeTransaction({ status: "failed" });
    mockTransactionFindOne.mockResolvedValue(transaction);

    const result = await recordOrderManualPayment({
      orgId: "org-1",
      recordedBy: "user-1",
      input: orderInput,
    });

    expect(mockFulfill).toHaveBeenCalledTimes(1);
    expect(result.transaction.paymentGateway).toBe("manual");
  });

  it("surfaces a fulfillment configuration error while keeping the payment recorded", async () => {
    mockTransactionFindOne.mockResolvedValue(makeTransaction());
    mockFulfill.mockResolvedValue({
      outcome: "configuration-error",
      errorMessage: "DingConnect integration not configured",
    });

    await expect(
      recordOrderManualPayment({
        orgId: "org-1",
        recordedBy: "user-1",
        input: orderInput,
      }),
    ).rejects.toMatchObject({ status: 500 });
    // The payment record stays — the money was really received.
    expect(mockPaymentCreate).toHaveBeenCalledTimes(1);
  });
});

describe("isManuallyPaidTransaction (webhook double-fulfillment guard)", () => {
  it("is true for a manually paid order", () => {
    expect(
      isManuallyPaidTransaction({ paymentGateway: "manual", paymentId: "mp-1" }),
    ).toBe(true);
  });

  it("is false for gateway-paid orders", () => {
    expect(
      isManuallyPaidTransaction({ paymentGateway: "pgpay", paymentId: "tok" }),
    ).toBe(false);
  });

  it("is false when the manual payment was voided (fields cleared)", () => {
    expect(isManuallyPaidTransaction({ paymentGateway: undefined, paymentId: undefined })).toBe(
      false,
    );
    expect(isManuallyPaidTransaction({ paymentGateway: "manual" })).toBe(false);
  });
});
