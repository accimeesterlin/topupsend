/**
 * @jest-environment node
 *
 * Scheduled-topups executor pins (2026-11-22 fix pass):
 *
 * - C1: a fired schedule performs a REAL DingConnect send through the
 *   shared outcome handling — no placeholder completion.
 * - C2: the wallet debit PERSISTS. The fake db hydrates every read
 *   from the persisted snapshot, so an in-memory-only mutation (the
 *   old bug: reserve/deduct without save) is invisible to re-reads
 *   and these tests fail.
 * - H1: two concurrent executions of the same schedule send ONCE
 *   (atomic claim), and a duplicate transaction create for the same
 *   occurrence is rejected by the unique occurrence key.
 * - H2: the org storefront validateOnly setting is honored (no
 *   provider call, no wallet debit — the reservation is released).
 * - H3: transient failures retry with backoff and do NOT permanently
 *   fail after 3 attempts; insufficient funds retry in 24h without
 *   consuming the failure budget.
 * - H4: naive form times are interpreted in the schedule's timezone;
 *   recurrence advances from the fired occurrence, not wall-clock.
 * - M1: status transitions are guarded (no resurrecting cancelled /
 *   completed schedules; no edits mid-execution).
 * - Settlement: an unknown provider outcome leaves schedule +
 *   transaction "processing" with the reservation held; the settle
 *   pass then converts (completed) or releases (failed) exactly once.
 */
import { Types } from "mongoose";

// ---------------------------------------------------------------------------
// Shared mock handles (mock-prefixed for jest.mock factories)
// ---------------------------------------------------------------------------

const mockDing = {
  sendTransfer: jest.fn(),
  getTransferStatus: jest.fn(),
  getProducts: jest.fn(),
  getProviders: jest.fn(),
  getBalance: jest.fn(),
  estimatePrices: jest.fn(),
};

const mockSettleStuckTransfer = jest.fn();
const mockSendEmail = jest.fn().mockResolvedValue(undefined);
const mockTrackCompletion = jest.fn();

jest.mock("@/lib/services/dingconnect.service", () => ({
  createDingConnectService: jest.fn(() => mockDing),
}));

jest.mock("@/lib/services/fulfillment.service", () => ({
  // Same rule as the real implementation: only an HTTP 4xx from
  // DingConnect itself is a definite rejection.
  isDefiniteProviderRejection: (error: unknown) =>
    /DingConnect API Error: 4\d{2}\b/.test(
      error instanceof Error ? error.message : String(error),
    ),
  pollTransferStatus: jest.fn(
    async (ding: { getTransferStatus: (id: number) => unknown }, id: number) =>
      ding.getTransferStatus(id),
  ),
  settleStuckTransfer: (...args: unknown[]) => mockSettleStuckTransfer(...args),
}));

jest.mock("@/lib/services/usage-tracking.service", () => ({
  trackTransactionCompletion: (...args: unknown[]) => mockTrackCompletion(...args),
  checkTransactionLimit: jest.fn().mockResolvedValue({ allowed: true }),
}));

jest.mock("@/lib/services/email.service", () => ({
  EmailService: { sendEmail: (...args: unknown[]) => mockSendEmail(...args) },
}));

// ---------------------------------------------------------------------------
// In-memory fake db with persisted-snapshot semantics
// ---------------------------------------------------------------------------

jest.mock("@topupsend/db", () => {
  const deepClone = <T,>(value: T): T => {
    if (value instanceof Date) return new Date(value.getTime()) as T;
    if (Array.isArray(value)) return value.map((v) => deepClone(v)) as T;
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        if (typeof v !== "function") out[k] = deepClone(v);
      }
      return out as T;
    }
    return value;
  };

  const stores = {
    schedules: new Map<string, Record<string, any>>(),
    transactions: new Map<string, Record<string, any>>(),
    wallets: new Map<string, Record<string, any>>(),
    products: new Map<string, Record<string, any>>(),
    walletTransactions: [] as Record<string, any>[],
    integration: null as Record<string, any> | null,
    storefrontSettings: null as Record<string, any> | null,
    seq: 0,
  };

  const nextId = (prefix: string) => `${prefix}-${++stores.seq}`;

  const timeOf = (v: unknown): number =>
    v instanceof Date ? v.getTime() : new Date(v as string).getTime();

  const matches = (doc: Record<string, any>, filter: Record<string, any>): boolean => {
    for (const [key, cond] of Object.entries(filter)) {
      if (key === "$or") {
        const clauses = cond as Record<string, any>[];
        if (!clauses.some((c) => matches(doc, c))) return false;
        continue;
      }
      if (cond instanceof Date) {
        if (doc[key] === undefined || timeOf(doc[key]) !== cond.getTime()) return false;
        continue;
      }
      if (cond && typeof cond === "object") {
        if ("$lte" in cond) {
          if (!(timeOf(doc[key]) <= timeOf(cond.$lte))) return false;
          continue;
        }
        if ("$exists" in cond) {
          if ((doc[key] !== undefined) !== cond.$exists) return false;
          continue;
        }
        if ("$ne" in cond) {
          if (doc[key] === cond.$ne) return false;
          continue;
        }
        return false;
      }
      if (doc[key] !== cond) return false;
    }
    return true;
  };

  const withLimit = (docs: Record<string, any>[]) =>
    Object.assign(docs, {
      limit(n: number) {
        return docs.slice(0, n);
      },
    });

  // --- ScheduledTopup -------------------------------------------------
  const hydrateSchedule = (snap: Record<string, any>) => {
    const doc: Record<string, any> = deepClone(snap);
    doc.save = async () => {
      const { save, ...data } = doc;
      stores.schedules.set(String(doc._id), deepClone(data));
      return doc;
    };
    return doc;
  };

  class FakeScheduledTopup {
    static findById = jest.fn(async (id: string) => {
      const snap = stores.schedules.get(String(id));
      return snap ? hydrateSchedule(snap) : null;
    });
    static findOne = jest.fn(async (filter: Record<string, any>) => {
      for (const snap of stores.schedules.values()) {
        if (matches(snap, filter)) return hydrateSchedule(snap);
      }
      return null;
    });
    static find = jest.fn((filter: Record<string, any>) =>
      withLimit(
        [...stores.schedules.values()]
          .filter((snap) => matches(snap, filter))
          .map(hydrateSchedule),
      ),
    );
    static findOneAndUpdate = jest.fn(
      (filter: Record<string, any>, update: Record<string, any>) => {
        // Synchronous check-and-set against the persisted snapshot:
        // this is the atomicity the claim relies on.
        for (const snap of stores.schedules.values()) {
          if (matches(snap, filter)) {
            Object.assign(snap, deepClone(update.$set));
            return Promise.resolve(hydrateSchedule(snap));
          }
        }
        return Promise.resolve(null);
      },
    );

    constructor(data: Record<string, any>) {
      Object.assign(this, {
        _id: nextId("sched"),
        status: "active",
        executionCount: 0,
        failureCount: 0,
        maxRetries: 10,
        transactions: [],
        notifications: {
          enabled: true,
          notifyBeforeMinutes: 60,
          notifyOnSuccess: true,
          notifyOnFailure: true,
          channels: ["email"],
        },
        ...data,
      });
    }
    async save() {
      const data: Record<string, any> = { ...(this as Record<string, any>) };
      stores.schedules.set(String(data._id), deepClone(data));
      return this;
    }
  }

  // --- Transaction ----------------------------------------------------
  const hydrateTransaction = (snap: Record<string, any>) => {
    const doc: Record<string, any> = deepClone(snap);
    doc.save = async () => {
      const { save, ...data } = doc;
      persistTransaction(data);
      return doc;
    };
    return doc;
  };

  const persistTransaction = (data: Record<string, any>) => {
    const key = data.metadata?.scheduledOccurrenceKey;
    if (key) {
      for (const [id, snap] of stores.transactions) {
        if (
          id !== String(data._id) &&
          snap.metadata?.scheduledOccurrenceKey === key
        ) {
          const err = new Error("E11000 duplicate key error") as Error & {
            code: number;
          };
          err.code = 11000;
          throw err;
        }
      }
    }
    stores.transactions.set(String(data._id), deepClone(data));
  };

  class FakeTransaction {
    static findById = jest.fn(async (id: string) => {
      const snap = stores.transactions.get(String(id));
      return snap ? hydrateTransaction(snap) : null;
    });
    static findOne = jest.fn(async (filter: Record<string, any>) => {
      const key = filter["metadata.scheduledOccurrenceKey"];
      for (const snap of stores.transactions.values()) {
        if (snap.metadata?.scheduledOccurrenceKey === key) {
          return hydrateTransaction(snap);
        }
      }
      return null;
    });

    constructor(data: Record<string, any>) {
      Object.assign(this, data);
      (this as Record<string, any>)._id = nextId("tx");
      (this as Record<string, any>).orderId = `ORD-${stores.seq}`;
    }
    async save() {
      persistTransaction({ ...(this as Record<string, any>) });
      return this;
    }
  }

  // --- Wallet -----------------------------------------------------------
  const hydrateWallet = (snap: Record<string, any>) => {
    const doc: Record<string, any> = deepClone(snap);
    doc.hasAvailableBalance = (amount: number) => doc.availableBalance >= amount;
    doc.reserve = (amount: number) => {
      if (!doc.hasAvailableBalance(amount)) return false;
      doc.reservedBalance += amount;
      return true;
    };
    doc.releaseReservation = (amount: number) => {
      doc.reservedBalance = Math.max(0, doc.reservedBalance - amount);
    };
    doc.deduct = (amount: number, reserved = true) => {
      if (reserved) {
        doc.balance -= amount;
        doc.reservedBalance = Math.max(0, doc.reservedBalance - amount);
      } else {
        if (doc.availableBalance < amount) return false;
        doc.balance -= amount;
      }
      doc.metadata.totalSpent += amount;
      doc.metadata.lastTransactionAt = new Date();
      return true;
    };
    doc.save = async () => {
      // Mirrors the real pre-save hook.
      doc.availableBalance = doc.balance - doc.reservedBalance;
      const { save, hasAvailableBalance, reserve, releaseReservation, deduct, ...data } = doc;
      stores.wallets.set(String(doc.orgId), deepClone(data));
      return doc;
    };
    return doc;
  };

  const FakeWallet = {
    findOne: jest.fn(async (filter: Record<string, any>) => {
      const snap = stores.wallets.get(String(filter.orgId));
      if (!snap) return null;
      if (filter.status && snap.status !== filter.status) return null;
      return hydrateWallet(snap);
    }),
  };

  // --- Product / Integration / StorefrontSettings -----------------------
  const FakeProduct = {
    findOne: jest.fn(async (filter: Record<string, any>) => {
      for (const snap of stores.products.values()) {
        // Products are read-only in the service; return the fixture
        // itself so its methods (getEffectivePrice) survive.
        if (matches(snap, filter)) return snap;
      }
      return null;
    }),
  };

  const FakeIntegration = {
    findOne: jest.fn(() => ({
      select: jest.fn(async () => stores.integration),
    })),
  };

  const FakeStorefrontSettings = {
    findOne: jest.fn(async () => stores.storefrontSettings),
  };

  const FakeWalletTransaction = {
    create: jest.fn(async (data: Record<string, any>) => {
      stores.walletTransactions.push(deepClone(data));
      return data;
    }),
  };

  return {
    __stores: stores,
    dbConnection: { connect: jest.fn().mockResolvedValue(undefined) },
    ScheduledTopup: FakeScheduledTopup,
    Transaction: FakeTransaction,
    Wallet: FakeWallet,
    WalletTransaction: FakeWalletTransaction,
    Product: FakeProduct,
    Integration: FakeIntegration,
    StorefrontSettings: FakeStorefrontSettings,
  };
});

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------

import * as dbMock from "@topupsend/db";
import {
  createScheduledTopup,
  updateScheduledTopup,
  cancelScheduledTopup,
  toggleSchedulePause,
  executeScheduledTopup,
  processScheduledTopups,
  parseScheduleDateTime,
  calculateNextExecution,
  retryBackoffMinutes,
} from "@/lib/services/scheduled-topups.service";

const stores = (dbMock as unknown as { __stores: any }).__stores;

const ORG = "org-1";
const PAST = new Date(Date.now() - 60_000);

function seedProduct(overrides: Record<string, any> = {}) {
  const product = {
    _id: "prod-1",
    orgId: ORG,
    status: "active",
    provider: "dingconnect",
    providerProductId: "SKU-1",
    skuCode: "SKU-1",
    providerCode: "dingconnect",
    benefitType: "usd",
    name: "Test Top-up",
    operatorId: "OP-1",
    operatorName: "Test Operator",
    operatorCountry: "HT",
    pricing: { costPrice: 8, sellPrice: 10 },
    denomination: { type: "fixed", fixedAmount: 10, unit: "USD" },
    isVariableValue: false,
    minAmount: undefined,
    maxAmount: undefined,
    getEffectivePrice: () => 10,
    ...overrides,
  };
  stores.products.set(product._id, product);
  return product;
}

function seedWallet(balance = 100) {
  stores.wallets.set(ORG, {
    _id: "wallet-1",
    orgId: ORG,
    balance,
    reservedBalance: 0,
    availableBalance: balance,
    currency: "USD",
    status: "active",
    metadata: { totalDeposits: 0, totalWithdrawals: 0, totalSpent: 0 },
  });
}

function seedSchedule(overrides: Record<string, any> = {}) {
  const schedule = {
    _id: "sched-1",
    organizationId: ORG,
    createdBy: "user-1",
    phoneNumber: "+50937000000",
    customerEmail: "customer@example.com",
    productId: "prod-1",
    productSnapshot: {
      skuCode: "SKU-1",
      name: "Test Top-up",
      providerCode: "dingconnect",
      benefitType: "usd",
    },
    amount: 10,
    estimatedCost: 10,
    scheduledDate: PAST,
    timezone: "America/Port-au-Prince",
    recurrence: { enabled: false },
    status: "active",
    executionCount: 0,
    lastExecutedAt: undefined,
    nextExecutionAt: PAST,
    transactions: [] as string[],
    failureCount: 0,
    lastFailureReason: undefined,
    maxRetries: 3,
    notifications: {
      enabled: false,
      notifyBeforeMinutes: 60,
      notifyOnSuccess: true,
      notifyOnFailure: true,
      channels: ["email"],
    },
    ...overrides,
  };
  stores.schedules.set(schedule._id, schedule);
  return schedule;
}

function persistedSchedule(id = "sched-1") {
  return stores.schedules.get(id);
}

async function persistedWallet() {
  const { Wallet } = dbMock as unknown as { Wallet: any };
  return Wallet.findOne({ orgId: ORG, status: "active" });
}

function persistedTransactions() {
  return [...stores.transactions.values()];
}

beforeEach(() => {
  stores.schedules.clear();
  stores.transactions.clear();
  stores.wallets.clear();
  stores.products.clear();
  stores.walletTransactions.length = 0;
  stores.integration = {
    orgId: ORG,
    provider: "dingconnect",
    status: "active",
    credentials: { apiKey: "ding-key" },
  };
  stores.storefrontSettings = {
    orgId: ORG,
    topupSettings: { validateOnly: false },
  };
  jest.clearAllMocks();
  mockSendEmail.mockResolvedValue(undefined);
  seedProduct();
  seedWallet(100);
});

// ---------------------------------------------------------------------------
// C1 + C2: real send, persisted debit
// ---------------------------------------------------------------------------

describe("execution: real send with persisted wallet debit", () => {
  it("sends via DingConnect and persists the debit exactly once", async () => {
    seedSchedule();
    mockDing.sendTransfer.mockResolvedValue({
      TransferId: 555,
      Status: "Completed",
    });

    const result = await executeScheduledTopup("sched-1");

    expect(result.success).toBe(true);
    expect(result.status).toBe("completed");
    expect(mockDing.sendTransfer).toHaveBeenCalledTimes(1);
    expect(mockDing.sendTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        SkuCode: "SKU-1",
        AccountNumber: "50937000000",
        ValidateOnly: false,
        DistributorRef: expect.stringContaining("ORD-"),
      }),
    );

    // C2: a fresh read (hydrated from the persisted snapshot) shows
    // the debit — in-memory-only mutation would leave 100 here.
    const wallet = await persistedWallet();
    expect(wallet.balance).toBe(90);
    expect(wallet.reservedBalance).toBe(0);
    expect(wallet.availableBalance).toBe(90);

    const txns = persistedTransactions();
    expect(txns).toHaveLength(1);
    expect(txns[0].status).toBe("completed");
    expect(txns[0].providerTransactionId).toBe("555");
    expect(txns[0].metadata.scheduledTopupId).toBe("sched-1");
    expect(txns[0].metadata.scheduledOccurrenceKey).toContain("sched-1:");

    const schedule = persistedSchedule();
    expect(schedule.status).toBe("completed");
    expect(schedule.executionCount).toBe(1);
    expect(schedule.transactions).toHaveLength(1);
    expect(stores.walletTransactions).toHaveLength(1);
    expect(stores.walletTransactions[0].amount).toBe(-10);
  });

  it("marks the transaction failed and releases the reservation on a definite provider rejection", async () => {
    seedSchedule();
    mockDing.sendTransfer.mockRejectedValue(
      new Error("DingConnect API Error: 400 Invalid SkuCode"),
    );

    const result = await executeScheduledTopup("sched-1");

    expect(result.success).toBe(false);
    const wallet = await persistedWallet();
    expect(wallet.balance).toBe(100);
    expect(wallet.reservedBalance).toBe(0);

    const txns = persistedTransactions();
    expect(txns).toHaveLength(1);
    expect(txns[0].status).toBe("failed");

    const schedule = persistedSchedule();
    expect(schedule.status).toBe("active"); // retry scheduled
    expect(schedule.failureCount).toBe(1);
    expect(schedule.lastFailureReason).toContain("400");
  });
});

// ---------------------------------------------------------------------------
// H2: validateOnly honored
// ---------------------------------------------------------------------------

describe("validateOnly (test mode)", () => {
  it("does not call the provider and does not debit the wallet", async () => {
    seedSchedule();
    stores.storefrontSettings = {
      orgId: ORG,
      topupSettings: { validateOnly: true },
    };

    const result = await executeScheduledTopup("sched-1");

    expect(result.success).toBe(true);
    expect(mockDing.sendTransfer).not.toHaveBeenCalled();

    const wallet = await persistedWallet();
    expect(wallet.balance).toBe(100);
    expect(wallet.reservedBalance).toBe(0);
    expect(stores.walletTransactions).toHaveLength(0);

    const txns = persistedTransactions();
    expect(txns).toHaveLength(1);
    expect(txns[0].status).toBe("completed");
    expect(txns[0].isTestMode).toBe(true);
    expect(txns[0].providerTransactionId).toContain("TEST-");
    expect(txns[0].metadata.testMode).toBe(true);
  });

  it("defaults to validate-only when the org has no storefront settings", async () => {
    seedSchedule();
    stores.storefrontSettings = null;

    const result = await executeScheduledTopup("sched-1");

    expect(result.success).toBe(true);
    expect(mockDing.sendTransfer).not.toHaveBeenCalled();
    const txns = persistedTransactions();
    expect(txns[0].isTestMode).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// H1: double-fire protection
// ---------------------------------------------------------------------------

describe("double-fire protection", () => {
  it("two concurrent executions of the same schedule send exactly once", async () => {
    seedSchedule();
    mockDing.sendTransfer.mockResolvedValue({
      TransferId: 777,
      Status: "Completed",
    });

    const [r1, r2] = await Promise.all([
      executeScheduledTopup("sched-1"),
      executeScheduledTopup("sched-1"),
    ]);

    expect(mockDing.sendTransfer).toHaveBeenCalledTimes(1);
    expect([r1.success, r2.success].filter(Boolean)).toHaveLength(1);
    expect(persistedTransactions()).toHaveLength(1);

    const wallet = await persistedWallet();
    expect(wallet.balance).toBe(90); // debited once, not twice
  });

  it("a second processScheduledTopups run does not re-send a completed schedule", async () => {
    seedSchedule();
    mockDing.sendTransfer.mockResolvedValue({
      TransferId: 778,
      Status: "Completed",
    });

    await processScheduledTopups();
    await processScheduledTopups();

    expect(mockDing.sendTransfer).toHaveBeenCalledTimes(1);
  });

  it("does not execute schedules that are not yet due", async () => {
    seedSchedule({ nextExecutionAt: new Date(Date.now() + 3600_000) });
    mockDing.sendTransfer.mockResolvedValue({
      TransferId: 779,
      Status: "Completed",
    });

    const results = await processScheduledTopups();

    expect(results).toHaveLength(0);
    expect(mockDing.sendTransfer).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// H3: failure policy — backoff, budget floor, insufficient funds
// ---------------------------------------------------------------------------

describe("failure policy", () => {
  const definiteRejection = () =>
    mockDing.sendTransfer.mockRejectedValue(
      new Error("DingConnect API Error: 400 Invalid request"),
    );

  it("retries with exponential backoff instead of the next tick", async () => {
    seedSchedule();
    definiteRejection();

    const before = Date.now();
    await executeScheduledTopup("sched-1");

    const schedule = persistedSchedule();
    expect(schedule.status).toBe("active");
    expect(schedule.failureCount).toBe(1);
    // First backoff rung is 5 minutes — not "next 5-minute tick".
    const delay = schedule.nextExecutionAt.getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(5 * 60_000 - 1000);
    expect(delay).toBeLessThan(15 * 60_000);
  });

  it("does not permanently fail after 3 attempts (budget floor)", async () => {
    seedSchedule({ maxRetries: 3 });
    definiteRejection();

    for (let i = 0; i < 3; i++) {
      // Make the schedule due again after each backoff.
      const snap = persistedSchedule();
      snap.nextExecutionAt = new Date(Date.now() - 1000);
      stores.schedules.set("sched-1", snap);
      await executeScheduledTopup("sched-1");
    }

    const schedule = persistedSchedule();
    expect(schedule.failureCount).toBe(3);
    expect(schedule.status).toBe("active"); // NOT 'failed'
    expect(schedule.nextExecutionAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("insufficient funds retries in 24h without consuming the failure budget", async () => {
    seedSchedule();
    seedWallet(5); // cost is 10

    const before = Date.now();
    const result = await executeScheduledTopup("sched-1");

    expect(result.success).toBe(false);
    expect(mockDing.sendTransfer).not.toHaveBeenCalled();
    expect(persistedTransactions()).toHaveLength(0);

    const schedule = persistedSchedule();
    expect(schedule.status).toBe("active");
    expect(schedule.failureCount).toBe(0); // budget untouched
    expect(schedule.lastFailureReason).toContain("Insufficient");
    const delay = schedule.nextExecutionAt.getTime() - before;
    expect(delay).toBeGreaterThan(23 * 3600_000);
    expect(delay).toBeLessThan(25 * 3600_000);
  });

  it("backoff ladder grows and caps", () => {
    expect(retryBackoffMinutes(1)).toBe(5);
    expect(retryBackoffMinutes(2)).toBe(15);
    expect(retryBackoffMinutes(3)).toBe(60);
    expect(retryBackoffMinutes(4)).toBe(240);
    expect(retryBackoffMinutes(5)).toBe(720);
    expect(retryBackoffMinutes(6)).toBe(1440);
    expect(retryBackoffMinutes(20)).toBe(1440);
  });
});

// ---------------------------------------------------------------------------
// Settlement of unknown outcomes
// ---------------------------------------------------------------------------

describe("settlement of unknown provider outcomes", () => {
  async function driveToProcessing() {
    seedSchedule();
    mockDing.sendTransfer.mockRejectedValue(new Error("socket hang up"));
    const result = await executeScheduledTopup("sched-1");
    expect(result.status).toBe("processing");
    const schedule = persistedSchedule();
    expect(schedule.status).toBe("processing");
    expect(schedule.pendingReservationHeld).toBe(true);
    const wallet = await persistedWallet();
    expect(wallet.balance).toBe(100);
    expect(wallet.reservedBalance).toBe(10); // held, not debited
    return schedule;
  }

  it("settles to completed: reservation converts to a persisted debit", async () => {
    await driveToProcessing();
    mockSettleStuckTransfer.mockImplementation(async (txn: any) => {
      txn.status = "completed";
      txn.timeline.completedAt = new Date();
      // Mirror the real settle: terminal state is persisted first.
      const snap = stores.transactions.get(String(txn._id));
      snap.status = "completed";
      return "completed";
    });

    // Backdate the claim so the settle pass picks it up.
    const snap = persistedSchedule();
    snap.processingStartedAt = new Date(Date.now() - 120_000);
    stores.schedules.set("sched-1", snap);

    await processScheduledTopups();

    const wallet = await persistedWallet();
    expect(wallet.balance).toBe(90);
    expect(wallet.reservedBalance).toBe(0);
    const schedule = persistedSchedule();
    expect(schedule.status).toBe("completed");
    expect(schedule.executionCount).toBe(1);
  });

  it("settles to failed: reservation is released and the failure policy runs", async () => {
    await driveToProcessing();
    mockSettleStuckTransfer.mockImplementation(async (txn: any) => {
      txn.status = "failed";
      txn.timeline.failedAt = new Date();
      txn.metadata.failureReason = "DingConnect transfer failed";
      const snap = stores.transactions.get(String(txn._id));
      snap.status = "failed";
      snap.metadata.failureReason = "DingConnect transfer failed";
      return "failed";
    });

    const snap = persistedSchedule();
    snap.processingStartedAt = new Date(Date.now() - 120_000);
    stores.schedules.set("sched-1", snap);

    await processScheduledTopups();

    const wallet = await persistedWallet();
    expect(wallet.balance).toBe(100);
    expect(wallet.reservedBalance).toBe(0);
    const schedule = persistedSchedule();
    expect(schedule.status).toBe("active");
    expect(schedule.failureCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// H4: timezone handling and recurrence math
// ---------------------------------------------------------------------------

describe("timezone handling", () => {
  it("interprets a naive wall-clock time in the schedule's timezone (winter, UTC-5)", () => {
    const parsed = parseScheduleDateTime(
      "2027-01-15T09:00",
      "America/Port-au-Prince",
    );
    expect(parsed.toISOString()).toBe("2027-01-15T14:00:00.000Z");
  });

  it("interprets a naive wall-clock time in the schedule's timezone (summer, UTC-4)", () => {
    const parsed = parseScheduleDateTime(
      "2027-07-15T09:00",
      "America/Port-au-Prince",
    );
    expect(parsed.toISOString()).toBe("2027-07-15T13:00:00.000Z");
  });

  it("passes explicit-offset strings through as instants", () => {
    const parsed = parseScheduleDateTime(
      "2027-01-15T09:00:00Z",
      "America/Port-au-Prince",
    );
    expect(parsed.toISOString()).toBe("2027-01-15T09:00:00.000Z");
  });

  it("rejects an invalid timezone", () => {
    expect(() => parseScheduleDateTime("2027-01-15T09:00", "Not/AZone")).toThrow(
      /Invalid timezone/,
    );
  });

  it("daily recurrence advances from the fired occurrence, not execution time", async () => {
    const occurrence = new Date(Date.now() - 2 * 3600_000); // due 2h ago
    seedSchedule({
      scheduledDate: occurrence,
      nextExecutionAt: occurrence,
      recurrence: { enabled: true, type: "daily", interval: 1 },
    });
    mockDing.sendTransfer.mockResolvedValue({
      TransferId: 888,
      Status: "Completed",
    });

    await executeScheduledTopup("sched-1");

    const schedule = persistedSchedule();
    expect(schedule.status).toBe("active");
    // Exactly occurrence + 1 day (in the schedule's timezone the
    // time-of-day is preserved; PAP has no DST transition here, and
    // the assertion is on the instant computed from the occurrence).
    const expected = calculateNextExecution(
      occurrence,
      "America/Port-au-Prince",
      { enabled: true, type: "daily", interval: 1 },
    );
    expect(schedule.nextExecutionAt.getTime()).toBe(expected.getTime());
    expect(schedule.nextExecutionAt.getTime()).toBeGreaterThan(
      occurrence.getTime() + 23 * 3600_000,
    );
    expect(schedule.nextExecutionAt.getTime()).toBeLessThan(
      occurrence.getTime() + 25 * 3600_000,
    );
  });

  it("monthly recurrence clamps day-of-month to the target month", () => {
    const next = calculateNextExecution(
      new Date("2027-01-31T09:00:00.000Z"),
      "UTC",
      { enabled: true, type: "monthly", interval: 1, dayOfMonth: 31 },
    );
    expect(next.toISOString()).toBe("2027-02-28T09:00:00.000Z");
  });

  it("weekly recurrence finds the next matching weekday", () => {
    // 2027-01-15 is a Friday. Next Sunday (0) is 2027-01-17.
    const next = calculateNextExecution(
      new Date("2027-01-15T09:00:00.000Z"),
      "UTC",
      { enabled: true, type: "weekly", daysOfWeek: [0] },
    );
    expect(next.toISOString()).toBe("2027-01-17T09:00:00.000Z");
  });

  it("non-recurring calculation returns the instant unchanged", () => {
    const base = new Date("2027-01-15T14:00:00.000Z");
    expect(
      calculateNextExecution(base, "America/Port-au-Prince", {
        enabled: false,
        type: "daily",
      }).getTime(),
    ).toBe(base.getTime());
  });
});

// ---------------------------------------------------------------------------
// Create: timezone interpretation + validation (H4/L3)
// ---------------------------------------------------------------------------

describe("create", () => {
  it("stores the first fire time at the chosen wall-clock in the chosen timezone", async () => {
    const created = await createScheduledTopup(
      {
        phoneNumber: "+50937000000",
        productId: "prod-1",
        scheduledDate: "2027-01-15T09:00", // naive, as the form sends
        timezone: "America/Port-au-Prince",
      },
      "user-1",
      ORG,
    );

    expect(created.scheduledDate.toISOString()).toBe(
      "2027-01-15T14:00:00.000Z",
    );
    expect(created.nextExecutionAt?.toISOString()).toBe(
      "2027-01-15T14:00:00.000Z",
    );
  });

  it("rejects an invalid timezone at create", async () => {
    await expect(
      createScheduledTopup(
        {
          phoneNumber: "+50937000000",
          productId: "prod-1",
          scheduledDate: "2027-01-15T09:00",
          timezone: "Not/AZone",
        },
        "user-1",
        ORG,
      ),
    ).rejects.toThrow(/Invalid timezone/);
  });

  it("ignores a client-supplied amount for fixed-price products", async () => {
    const created = await createScheduledTopup(
      {
        phoneNumber: "+50937000000",
        productId: "prod-1",
        amount: 999,
        scheduledDate: "2027-01-15T09:00",
        timezone: "America/Port-au-Prince",
      },
      "user-1",
      ORG,
    );
    expect(created.amount).toBe(10); // the product's effective price
  });

  it("enforces amount bounds for variable-value products", async () => {
    seedProduct({
      _id: "prod-2",
      denomination: { type: "range", minAmount: 5, maxAmount: 50, unit: "USD" },
      isVariableValue: true,
      minAmount: 5,
      maxAmount: 50,
    });
    await expect(
      createScheduledTopup(
        {
          phoneNumber: "+50937000000",
          productId: "prod-2",
          amount: 100,
          scheduledDate: "2027-01-15T09:00",
          timezone: "America/Port-au-Prince",
        },
        "user-1",
        ORG,
      ),
    ).rejects.toThrow(/between 5 and 50/);
  });

  it("cannot schedule another org's product", async () => {
    seedProduct({ _id: "prod-foreign", orgId: "org-2" });
    await expect(
      createScheduledTopup(
        {
          phoneNumber: "+50937000000",
          productId: "prod-foreign",
          scheduledDate: "2027-01-15T09:00",
          timezone: "America/Port-au-Prince",
        },
        "user-1",
        ORG,
      ),
    ).rejects.toThrow(/not found or inactive/);
  });
});

// ---------------------------------------------------------------------------
// M1: status transition guards
// ---------------------------------------------------------------------------

describe("status transition guards", () => {
  it("cannot pause a cancelled schedule or resume a completed one", async () => {
    seedSchedule({ status: "cancelled" });
    await expect(toggleSchedulePause("sched-1", ORG, true)).rejects.toThrow(
      /Cannot pause/,
    );

    seedSchedule({ status: "completed" });
    await expect(toggleSchedulePause("sched-1", ORG, false)).rejects.toThrow(
      /Cannot resume/,
    );
  });

  it("cannot cancel a completed schedule; cancelling twice is a no-op", async () => {
    seedSchedule({ status: "completed" });
    await expect(cancelScheduledTopup("sched-1", ORG)).rejects.toThrow(
      /completed/,
    );

    seedSchedule({ status: "active" });
    await cancelScheduledTopup("sched-1", ORG);
    expect(persistedSchedule().status).toBe("cancelled");
    await cancelScheduledTopup("sched-1", ORG); // idempotent
    expect(persistedSchedule().status).toBe("cancelled");
  });

  it("cannot update a schedule while it is processing", async () => {
    seedSchedule({ status: "processing" });
    await expect(
      updateScheduledTopup("sched-1", { notes: "x" }, ORG),
    ).rejects.toThrow(/being executed/);
  });

  it("resuming a failed schedule resets its failure budget and reactivates it", async () => {
    seedSchedule({
      status: "failed",
      failureCount: 9,
      lastFailureReason: "boom",
      nextExecutionAt: undefined,
    });
    const resumed = await toggleSchedulePause("sched-1", ORG, false);
    expect(resumed.status).toBe("active");
    expect(resumed.failureCount).toBe(0);
    expect(resumed.nextExecutionAt).toBeDefined();
  });

  it("update revalidates that a new date is in the future", async () => {
    seedSchedule();
    await expect(
      updateScheduledTopup(
        "sched-1",
        { scheduledDate: "2020-01-15T09:00" },
        ORG,
      ),
    ).rejects.toThrow(/in the future/);
  });
});

// ---------------------------------------------------------------------------
// Notifications (L2): configured emails actually send
// ---------------------------------------------------------------------------

describe("notifications", () => {
  it("sends a success email when the schedule enables it", async () => {
    seedSchedule({
      notifications: {
        enabled: true,
        notifyBeforeMinutes: 60,
        notifyOnSuccess: true,
        notifyOnFailure: true,
        channels: ["email"],
      },
    });
    mockDing.sendTransfer.mockResolvedValue({
      TransferId: 999,
      Status: "Completed",
    });

    await executeScheduledTopup("sched-1");

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ to: "customer@example.com" }),
    );
  });

  it("sends nothing when notifications are disabled", async () => {
    seedSchedule(); // notifications.enabled = false in the fixture
    mockDing.sendTransfer.mockResolvedValue({
      TransferId: 1000,
      Status: "Completed",
    });

    await executeScheduledTopup("sched-1");

    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

// Keep Types referenced (the service's id types flow through it).
void Types;
