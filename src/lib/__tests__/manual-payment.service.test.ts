/**
 * Tests for the manual payment service, with the db models mocked
 * (the established mock-based style for this repo).
 */
import {
  Customer,
  CustomerBalanceHistory,
  ManualPayment,
  Transaction,
} from "@topupsend/db";
import {
  recordBalanceManualPayment,
  voidManualPayment,
} from "../services/manual-payment.service";
import type { CreateManualPaymentInput } from "../validations/manual-payment";

// Mock api-error: the real module imports next/server, which cannot load
// under the jsdom test environment (same reason the baseline api-error
// suite fails). The mock keeps the status-carrying contract the service
// relies on.
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
      Forbidden: (detail?: string) =>
        new ApiException(403, detail || "Forbidden"),
      NotFound: (detail?: string) =>
        new ApiException(404, detail || "Not Found"),
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

const mockCustomerFindById = Customer.findById as jest.Mock;
const mockHistoryCreate = CustomerBalanceHistory.create as jest.Mock;
const mockPaymentCreate = ManualPayment.create as jest.Mock;
const mockPaymentFindOne = ManualPayment.findOne as jest.Mock;
const mockTransactionFindOne = Transaction.findOne as jest.Mock;

function makeCustomer(overrides: Record<string, unknown> = {}) {
  return {
    _id: "cust-1",
    orgId: "org-1",
    balanceCurrency: "USD",
    currentBalance: 100,
    totalAssigned: 100,
    totalUsed: 0,
    save: jest.fn(async function (this: any) {
      return this;
    }),
    addBalance: jest.fn(
      async function (
        this: any,
        amount: number,
        _description: string,
        _metadata?: unknown,
        _historyType?: string,
      ) {
        this.currentBalance += amount;
        this.totalAssigned += amount;
      },
    ),
    ...overrides,
  };
}

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    _id: "mp-1",
    orgId: "org-1",
    customerId: "cust-1",
    amount: 40,
    currency: "USD",
    method: "moncash",
    reference: "MC-1",
    appliedTo: "customer_balance",
    status: "recorded",
    createdBy: "user-1",
    save: jest.fn(async function (this: any) {
      return this;
    }),
    ...overrides,
  };
}

const balanceInput: CreateManualPaymentInput = {
  appliedTo: "customer_balance",
  customerId: "cust-1",
  amount: 40,
  currency: "USD",
  method: "moncash",
  reference: "MC-1",
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("recordBalanceManualPayment", () => {
  it("records the payment and credits the balance as a payment history entry", async () => {
    const customer = makeCustomer();
    mockCustomerFindById.mockResolvedValue(customer);
    mockPaymentCreate.mockImplementation(async (data: unknown) =>
      makePayment(data as Record<string, unknown>),
    );

    const result = await recordBalanceManualPayment({
      orgId: "org-1",
      recordedBy: "user-1",
      input: balanceInput,
    });

    expect(result.customer.currentBalance).toBe(140);
    expect(customer.addBalance).toHaveBeenCalledTimes(1);
    const [, , metadata, historyType] = (customer.addBalance as jest.Mock).mock
      .calls[0];
    expect(historyType).toBe("payment");
    expect(metadata).toMatchObject({
      adminId: "user-1",
      method: "moncash",
      reference: "MC-1",
    });
    expect(metadata.manualPaymentId).toBeDefined();
  });

  it("rejects when the customer does not exist", async () => {
    mockCustomerFindById.mockResolvedValue(null);

    await expect(
      recordBalanceManualPayment({
        orgId: "org-1",
        recordedBy: "user-1",
        input: balanceInput,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it("rejects a customer from another org", async () => {
    mockCustomerFindById.mockResolvedValue(makeCustomer({ orgId: "org-2" }));

    await expect(
      recordBalanceManualPayment({
        orgId: "org-1",
        recordedBy: "user-1",
        input: balanceInput,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it("rejects a currency mismatch instead of converting", async () => {
    mockCustomerFindById.mockResolvedValue(makeCustomer());

    await expect(
      recordBalanceManualPayment({
        orgId: "org-1",
        recordedBy: "user-1",
        input: { ...balanceInput, currency: "HTG" },
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it("defaults the currency to the customer's balance currency", async () => {
    const customer = makeCustomer();
    mockCustomerFindById.mockResolvedValue(customer);
    mockPaymentCreate.mockImplementation(async (data: any) =>
      makePayment(data),
    );
    const { currency: _omit, ...inputWithoutCurrency } = balanceInput;

    await recordBalanceManualPayment({
      orgId: "org-1",
      recordedBy: "user-1",
      input: inputWithoutCurrency,
    });

    expect(mockPaymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ currency: "USD" }),
    );
  });
});

describe("voidManualPayment", () => {
  it("scopes the lookup to the session org", async () => {
    mockPaymentFindOne.mockResolvedValue(null);

    await expect(
      voidManualPayment({
        orgId: "org-9",
        voidedBy: "admin-1",
        manualPaymentId: "mp-1",
        reason: "Duplicate",
      }),
    ).rejects.toMatchObject({ status: 404 });

    expect(mockPaymentFindOne).toHaveBeenCalledWith({
      _id: "mp-1",
      orgId: "org-9",
    });
  });

  it("refuses to void an already-voided payment", async () => {
    mockPaymentFindOne.mockResolvedValue(makePayment({ status: "voided" }));

    await expect(
      voidManualPayment({
        orgId: "org-1",
        voidedBy: "admin-1",
        manualPaymentId: "mp-1",
        reason: "Duplicate",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("voids a balance payment and debits the credit back with a compensating history entry", async () => {
    const payment = makePayment();
    const customer = makeCustomer({ currentBalance: 100 });
    mockPaymentFindOne.mockResolvedValue(payment);
    mockCustomerFindById.mockResolvedValue(customer);
    mockHistoryCreate.mockResolvedValue({});

    const result = await voidManualPayment({
      orgId: "org-1",
      voidedBy: "admin-1",
      manualPaymentId: "mp-1",
      reason: "Recorded twice",
    });

    expect(result.status).toBe("voided");
    expect(result.voidReason).toBe("Recorded twice");
    expect(customer.currentBalance).toBe(60);
    expect(mockHistoryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: -40,
        type: "payment",
        previousBalance: 100,
        newBalance: 60,
      }),
    );
  });

  it("refuses to void a balance payment whose credit was already spent", async () => {
    const payment = makePayment();
    const customer = makeCustomer({ currentBalance: 10 });
    mockPaymentFindOne.mockResolvedValue(payment);
    mockCustomerFindById.mockResolvedValue(customer);

    await expect(
      voidManualPayment({
        orgId: "org-1",
        voidedBy: "admin-1",
        manualPaymentId: "mp-1",
        reason: "Recorded twice",
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(customer.save).not.toHaveBeenCalled();
    expect(mockHistoryCreate).not.toHaveBeenCalled();
    expect(payment.status).toBe("recorded");
  });

  it("refuses to void an order payment once the order is fulfilled", async () => {
    const payment = makePayment({
      appliedTo: "order",
      transactionId: "txn-1",
      customerId: undefined,
    });
    mockPaymentFindOne.mockResolvedValue(payment);
    mockTransactionFindOne.mockResolvedValue({
      _id: "txn-1",
      orgId: "org-1",
      status: "completed",
      paymentId: "mp-1",
      timeline: {},
      metadata: {},
      save: jest.fn(),
    });

    await expect(
      voidManualPayment({
        orgId: "org-1",
        voidedBy: "admin-1",
        manualPaymentId: "mp-1",
        reason: "Wrong order",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(payment.status).toBe("recorded");
  });

  it("voids an order payment before fulfillment and returns the order to pending", async () => {
    const payment = makePayment({
      appliedTo: "order",
      transactionId: "txn-1",
      customerId: undefined,
    });
    const transaction = {
      _id: "txn-1",
      orgId: "org-1",
      status: "paid",
      paymentGateway: "manual",
      paymentId: "mp-1",
      timeline: { createdAt: new Date(), paidAt: new Date() },
      metadata: {},
      save: jest.fn(async function (this: any) {
        return this;
      }),
    };
    mockPaymentFindOne.mockResolvedValue(payment);
    mockTransactionFindOne.mockResolvedValue(transaction);

    const result = await voidManualPayment({
      orgId: "org-1",
      voidedBy: "admin-1",
      manualPaymentId: "mp-1",
      reason: "Customer never paid",
    });

    expect(result.status).toBe("voided");
    expect(transaction.status).toBe("pending");
    expect(transaction.paymentId).toBeUndefined();
    expect(transaction.paymentGateway).toBeUndefined();
    expect(transaction.timeline.paidAt).toBeUndefined();
    expect(transaction.save).toHaveBeenCalled();
  });
});
