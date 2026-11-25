/**
 * @jest-environment node
 *
 * Regression pins for the metadata-schema recovery fix — the sequel
 * to partner-recovery.test.ts, exercising the REAL Transaction model
 * against a REAL (in-memory) MongoDB.
 *
 * Why this suite exists: the round-1 recovery keyed everything off
 * metadata.transferOutcome, but Transaction.metadata is a STRICT
 * sub-schema and transferOutcome was never declared in it, so
 * Mongoose silently dropped the stamp on every save. The sweep query
 * could never match, settleStuckTransfer's marker check could never
 * pass, and five consecutive production sweeps settled nothing —
 * while the round-1 suite stayed green because it mocks @topupsend/db
 * and asserts on in-memory objects that never round-trip through the
 * schema. These pins therefore save and RE-FETCH every document.
 *
 * Covered:
 *  1. Every metadata key the codebase writes persists across
 *     save + re-fetch (fails on origin/main, where the keys are
 *     undeclared and dropped).
 *  2. The exact send-path write pattern (assign transferOutcome on a
 *     saved document, save again) persists the marker.
 *  3. Legacy records — processing, no providerTransactionId field,
 *     NO transferOutcome marker (their stamp was dropped pre-fix) —
 *     are selected by the reconciliation sweep's step 3 and settled
 *     end-to-end through DistributorRef recovery.
 *  4. Test-mode (ValidateOnly) records are never settled or failed
 *     by recovery.
 *
 * Only DingConnect, the refund service, usage tracking and the logger
 * are mocked. Persistence, models and the sweep are real.
 */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const mockDing = {
  getTransferStatus: jest.fn(),
  listTransferRecords: jest.fn(),
};
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
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import {
  Customer,
  Integration,
  StorefrontSettings,
  Transaction,
} from "@topupsend/db";
import { runReconciliationSweep } from "@/lib/services/reconciliation.service";

jest.setTimeout(120000);

const ORG = "org-pgecom-test";
const HOUR = 60 * 60 * 1000;

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create({
    binary: { version: "8.2.6" },
  });
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  jest.clearAllMocks();
  mockProcessRefund.mockResolvedValue({ success: true });
  await Transaction.deleteMany({});
  await Integration.deleteMany({});
  await StorefrontSettings.deleteMany({});
  await Customer.deleteMany({});
});

async function seedOrg() {
  await Integration.create({
    orgId: ORG,
    provider: "dingconnect",
    status: "active",
    credentials: { apiKey: "ding-key" },
  });
  await StorefrontSettings.create({
    orgId: ORG,
    branding: { businessName: "PGecom Test" },
  });
}

function baseTx(overrides: Record<string, unknown> = {}) {
  return {
    orgId: ORG,
    productId: "ding-D0HT",
    amount: 5,
    currency: "USD",
    status: "pending",
    paymentGateway: "partner",
    paymentType: "gateway",
    provider: "dingconnect",
    recipient: { phoneNumber: "+50937923033" },
    operator: { id: "D0HT", name: "Digicel", country: "HT" },
    metadata: { retryCount: 0 },
    timeline: { createdAt: new Date() },
    ...overrides,
  };
}

function recordFor(orderId: string, transferRef = "424242") {
  return [
    {
      TransferRecord: {
        TransferId: { TransferRef: transferRef, DistributorRef: orderId },
        SkuCode: "D0HT",
        AccountNumber: "50937923033",
        ProcessingState: "Complete",
      },
      ResultCode: 1,
      ErrorCodes: [],
    },
  ];
}

describe("Transaction metadata schema persistence (real model)", () => {
  it("persists every written-but-previously-undeclared metadata key across save + re-fetch", async () => {
    const webhookCheckAt = new Date("2026-11-24T10:00:00.000Z");
    const tx = await Transaction.create(
      baseTx({
        status: "processing",
        metadata: {
          retryCount: 0,
          // Transfer outcome & provider recovery
          transferOutcome: "unknown",
          dingTransferId: 424242,
          dingStatus: "Processing",
          dingconnectStatus: "Processing",
          dingconnectErrorCode: "ProviderError",
          dingconnectProcessingState: "Complete",
          recoveredViaDistributorRef: true,
          testMode: true,
          // PGPay verification bookkeeping
          pgpayVerification: { status: "completed", orderId: "pg-1" },
          bindingFailure: "amount mismatch",
          lastVerificationError: "transport timeout",
          lastWebhookCheck: webhookCheckAt,
          // Manual payment bookkeeping
          manualPayment: { manualPaymentId: "mp-1", method: "cash" },
          manualPaymentVoided: { manualPaymentId: "mp-1", reason: "dup" },
          // Refund bookkeeping
          refundError: "credit failed",
          refundedAmount: 12.5,
          refundCustomerId: "cust-1",
          refundSource: "admin_manual",
          refundedBy: "admin-1",
          refundedAt: "2026-11-24T11:00:00.000Z",
          refundReversedAt: "2026-11-24T12:00:00.000Z",
          refundReversedAmount: 12.5,
          refundReversalShortfall: 1.25,
          refundReversalError: "Customer not found for refund reversal",
          internalNote: "URGENT: DingConnect account needs funding",
          // Retry bookkeeping
          retriedBy: "admin-1",
          retriedAt: "2026-11-24T13:00:00.000Z",
        },
      }),
    );

    const saved = await Transaction.findById(tx._id).lean();
    expect(saved).not.toBeNull();
    const md = (saved!.metadata || {}) as Record<string, unknown>;

    expect(md.transferOutcome).toBe("unknown");
    expect(md.dingTransferId).toBe(424242);
    expect(md.dingStatus).toBe("Processing");
    expect(md.dingconnectStatus).toBe("Processing");
    expect(md.dingconnectErrorCode).toBe("ProviderError");
    expect(md.dingconnectProcessingState).toBe("Complete");
    expect(md.recoveredViaDistributorRef).toBe(true);
    expect(md.testMode).toBe(true);
    expect(md.pgpayVerification).toEqual({
      status: "completed",
      orderId: "pg-1",
    });
    expect(md.bindingFailure).toBe("amount mismatch");
    expect(md.lastVerificationError).toBe("transport timeout");
    expect(new Date(md.lastWebhookCheck as string).getTime()).toBe(
      webhookCheckAt.getTime(),
    );
    expect(md.manualPayment).toEqual({
      manualPaymentId: "mp-1",
      method: "cash",
    });
    expect(md.manualPaymentVoided).toEqual({
      manualPaymentId: "mp-1",
      reason: "dup",
    });
    expect(md.refundError).toBe("credit failed");
    expect(md.refundedAmount).toBe(12.5);
    expect(md.refundCustomerId).toBe("cust-1");
    expect(md.refundSource).toBe("admin_manual");
    expect(md.refundedBy).toBe("admin-1");
    expect(md.refundedAt).toBe("2026-11-24T11:00:00.000Z");
    expect(md.refundReversedAt).toBe("2026-11-24T12:00:00.000Z");
    expect(md.refundReversedAmount).toBe(12.5);
    expect(md.refundReversalShortfall).toBe(1.25);
    expect(md.refundReversalError).toBe(
      "Customer not found for refund reversal",
    );
    expect(md.internalNote).toBe(
      "URGENT: DingConnect account needs funding",
    );
    expect(md.retriedBy).toBe("admin-1");
    expect(md.retriedAt).toBe("2026-11-24T13:00:00.000Z");
  });

  it("persists the marker stamped by the send path's post-creation assignment", async () => {
    // Exactly what the partner send does on an unknown outcome:
    // create the transaction, then assign the marker and save again.
    const tx = await Transaction.create(
      baseTx({ status: "processing" }),
    );
    (tx.metadata as Record<string, unknown>).transferOutcome = "unknown";
    tx.metadata.failureReason =
      "DingConnect request outcome unknown (possible timeout); awaiting status verification";
    await tx.save();

    const saved = await Transaction.findById(tx._id).lean();
    expect(saved!.metadata!.transferOutcome).toBe("unknown");
    expect(saved!.metadata!.failureReason).toContain(
      "outcome unknown",
    );
  });
});

describe("Reconciliation sweep — legacy records without the marker", () => {
  beforeEach(async () => {
    await seedOrg();
  });

  function legacyTx(overrides: Record<string, unknown> = {}) {
    // The pre-fix production shape: status processing, an old
    // processingAt, NO providerTransactionId field at all, and a
    // metadata object with NO transferOutcome — the stamp was
    // silently dropped by the strict schema at the original save.
    return Transaction.create(
      baseTx({
        status: "processing",
        metadata: {
          retryCount: 0,
          isVariableValue: true,
          sendValue: 5,
          idempotencyKey: "legacy-key",
        },
        timeline: {
          createdAt: new Date(Date.now() - 2 * HOUR),
          processingAt: new Date(Date.now() - 2 * HOUR),
        },
        ...overrides,
      }),
    );
  }

  it("recovers a legacy record end-to-end: selected by the sweep, id stamped, completed", async () => {
    const tx = await legacyTx({
      orderId: "ORD-1795489828319-A3YNSGO5J",
    });
    // Prove the fixture really is the legacy shape in the database.
    const before = await Transaction.findById(tx._id).lean();
    expect(before!.providerTransactionId).toBeUndefined();
    expect(
      (before!.metadata as Record<string, unknown>).transferOutcome,
    ).toBeUndefined();

    mockDing.listTransferRecords.mockResolvedValue(
      recordFor("ORD-1795489828319-A3YNSGO5J"),
    );
    mockDing.getTransferStatus.mockResolvedValue({
      TransferId: 424242,
      Status: "Completed",
    });

    const summary = await runReconciliationSweep();

    expect(summary.settledCompleted).toBe(1);
    expect(summary.errors).toBe(0);
    expect(mockDing.listTransferRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        distributorRef: "ORD-1795489828319-A3YNSGO5J",
      }),
    );

    const after = await Transaction.findById(tx._id).lean();
    expect(after!.status).toBe("completed");
    expect(after!.providerTransactionId).toBe("424242");
    expect(after!.metadata!.dingTransferId).toBe(424242);
    expect(after!.metadata!.recoveredViaDistributorRef).toBe(true);
    expect(after!.metadata!.transferOutcome).toBe("completed");
    expect(mockProcessRefund).not.toHaveBeenCalled();
  });

  it("legacy partner record with no provider record after 24h: sweep records failed, no refund", async () => {
    const tx = await legacyTx({
      orderId: "ORD-1795550885624-B3A2I3XH1",
      timeline: {
        createdAt: new Date(Date.now() - 25 * HOUR),
        processingAt: new Date(Date.now() - 25 * HOUR),
      },
    });
    // The abandon window is measured from the document's top-level
    // createdAt, which Mongoose timestamps stamp at save time — so
    // backdate it through the raw collection (Mongoose treats
    // createdAt as immutable and strips it from its own updates),
    // the way a genuinely 25h-old record reads.
    await Transaction.collection.updateOne(
      { _id: tx._id },
      { $set: { createdAt: new Date(Date.now() - 25 * HOUR) } },
    );
    mockDing.listTransferRecords.mockResolvedValue([]);

    const summary = await runReconciliationSweep();

    expect(summary.settledFailed).toBe(1);
    const after = await Transaction.findById(tx._id).lean();
    expect(after!.status).toBe("failed");
    expect(after!.metadata!.failureReason).toContain(
      "No transfer found at DingConnect",
    );
    expect(after!.metadata!.transferOutcome).toBe("not-found");
    expect(mockProcessRefund).not.toHaveBeenCalled();
  });

  it("legacy record with no provider record but younger than 24h: stays processing", async () => {
    const tx = await legacyTx({
      timeline: {
        createdAt: new Date(Date.now() - 30 * 60 * 1000),
        processingAt: new Date(Date.now() - 30 * 60 * 1000),
      },
    });
    mockDing.listTransferRecords.mockResolvedValue([]);

    const summary = await runReconciliationSweep();

    expect(summary.stillProcessing).toBe(1);
    expect(summary.settledFailed).toBe(0);
    const after = await Transaction.findById(tx._id).lean();
    expect(after!.status).toBe("processing");
    expect(mockProcessRefund).not.toHaveBeenCalled();
  });

  it("test-mode record: sweep skips it and recovery never touches it, however old", async () => {
    const tx = await legacyTx({
      isTestMode: true,
      timeline: {
        createdAt: new Date(Date.now() - 48 * HOUR),
        processingAt: new Date(Date.now() - 48 * HOUR),
      },
    });

    const summary = await runReconciliationSweep();

    expect(summary.skipped).toBe(1);
    expect(summary.settledCompleted).toBe(0);
    expect(summary.settledFailed).toBe(0);
    expect(summary.stillProcessing).toBe(0);
    expect(mockDing.listTransferRecords).not.toHaveBeenCalled();
    expect(mockDing.getTransferStatus).not.toHaveBeenCalled();

    const after = await Transaction.findById(tx._id).lean();
    expect(after!.status).toBe("processing");
    expect(after!.metadata!.failureReason).toBeUndefined();
    expect(mockProcessRefund).not.toHaveBeenCalled();
  });
});
