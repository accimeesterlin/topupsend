/**
 * @jest-environment node
 *
 * Regression pins for the DistributorRef recovery fix —
 * exercises the REAL recoverUnknownTransferOutcome and
 * settleStuckTransfer from fulfillment.service with only persistence,
 * DingConnect and the refund service mocked.
 *
 * Audit question: a transaction whose SendTransfer response was lost
 * (timeout / network / 5xx) is saved as "processing" with
 * metadata.transferOutcome "unknown" and NO providerTransactionId.
 * Every settle path keyed off that id, so the transaction stayed
 * "processing" forever even though DingConnect executed the transfer
 * under DistributorRef = the transaction's orderId. Recovery finds the
 * transfer via ListTransferRecords (DingConnect's prescribed timeout
 * recovery), stamps the id, and settles through the ordinary poll
 * path. Partner failures must NEVER reach processRefund (it would
 * mint balance for a by-phone customer who never paid TopUpSend).
 */
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

import {
  recoverUnknownTransferOutcome,
  settleStuckTransfer,
} from "@/lib/services/fulfillment.service";

const NOW = new Date("2026-11-24T12:00:00.000Z");

function makeStuckTx(overrides: Record<string, unknown> = {}) {
  return {
    _id: "tx-stuck",
    orderId: "ORD-1795489828319-A3YNSGO5J",
    orgId: "org1",
    status: "processing",
    providerTransactionId: undefined,
    paymentGateway: "partner",
    paymentType: "gateway",
    amount: 5,
    currency: "USD",
    recipient: { phoneNumber: "+50937923033" },
    createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    timeline: { processingAt: new Date(NOW.getTime() - 60 * 60 * 1000) },
    metadata: {
      transferOutcome: "unknown",
      failureReason:
        "DingConnect request outcome unknown (possible timeout); awaiting status verification",
    },
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;
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

beforeEach(() => {
  jest.clearAllMocks();
  mockProcessRefund.mockResolvedValue({ success: true });
});

describe("VERIFY DistributorRef recovery — record found", () => {
  it("stamps the recovered provider id and completes when DingConnect says Completed", async () => {
    const tx = makeStuckTx();
    mockDing.listTransferRecords.mockResolvedValue(recordFor(tx.orderId));
    mockDing.getTransferStatus.mockResolvedValue({
      TransferId: 424242,
      Status: "Completed",
    });

    // Driven through settleStuckTransfer, the entry point both the
    // reconciliation sweep and the partner status route call.
    const result = await settleStuckTransfer(tx);

    expect(mockDing.listTransferRecords).toHaveBeenCalledWith(
      expect.objectContaining({ distributorRef: tx.orderId }),
    );
    expect(tx.providerTransactionId).toBe("424242");
    expect(tx.metadata.dingTransferId).toBe(424242);
    expect(tx.metadata.recoveredViaDistributorRef).toBe(true);
    expect(mockDing.getTransferStatus).toHaveBeenCalledWith(424242);
    expect(result).toBe("completed");
    expect(tx.status).toBe("completed");
    expect(mockProcessRefund).not.toHaveBeenCalled();
  });

  it("partner transaction: records failed WITHOUT processRefund when DingConnect says Failed", async () => {
    const tx = makeStuckTx();
    mockDing.listTransferRecords.mockResolvedValue(recordFor(tx.orderId));
    mockDing.getTransferStatus.mockResolvedValue({
      TransferId: 424242,
      Status: "Failed",
      ErrorMessage: "Provider rejected the transfer",
      ErrorCode: "ProviderError",
    });

    const result = await recoverUnknownTransferOutcome(tx, NOW);

    expect(result).toBe("failed");
    expect(tx.status).toBe("failed");
    expect(tx.metadata.failureReason).toBe("Provider rejected the transfer");
    expect(mockProcessRefund).not.toHaveBeenCalled();
  });
});

describe("VERIFY DistributorRef recovery — no record at the provider", () => {
  it("partner transaction older than 24h: records failed with the not-found reason, no refund", async () => {
    const tx = makeStuckTx({
      createdAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000),
    });
    mockDing.listTransferRecords.mockResolvedValue([]);

    const result = await recoverUnknownTransferOutcome(tx, NOW);

    expect(result).toBe("failed");
    expect(tx.status).toBe("failed");
    expect(tx.metadata.failureReason).toContain(
      "No transfer found at DingConnect",
    );
    expect(tx.metadata.transferOutcome).toBe("not-found");
    expect(mockDing.getTransferStatus).not.toHaveBeenCalled();
    expect(mockProcessRefund).not.toHaveBeenCalled();
  });

  it("young transaction: stays processing for the next attempt", async () => {
    const tx = makeStuckTx({
      createdAt: new Date(NOW.getTime() - 30 * 60 * 1000),
    });
    mockDing.listTransferRecords.mockResolvedValue([]);

    const result = await recoverUnknownTransferOutcome(tx, NOW);

    expect(result).toBe("unknown");
    expect(tx.status).toBe("processing");
    expect(mockProcessRefund).not.toHaveBeenCalled();
  });

  it("a failed records lookup proves nothing: stays processing", async () => {
    const tx = makeStuckTx({
      createdAt: new Date(NOW.getTime() - 48 * 60 * 60 * 1000),
    });
    mockDing.listTransferRecords.mockRejectedValue(new Error("network down"));

    const result = await recoverUnknownTransferOutcome(tx, NOW);

    expect(result).toBe("unknown");
    expect(tx.status).toBe("processing");
  });
});

describe("VERIFY regression pins — ordinary settle path unchanged", () => {
  it("transaction WITH a provider id polls GetTransferStatus and never lists records", async () => {
    const tx = makeStuckTx({ providerTransactionId: "777" });
    mockDing.getTransferStatus.mockResolvedValue({
      TransferId: 777,
      Status: "Completed",
    });

    const result = await settleStuckTransfer(tx);

    expect(result).toBe("completed");
    expect(tx.status).toBe("completed");
    expect(mockDing.getTransferStatus).toHaveBeenCalledWith(777);
    expect(mockDing.listTransferRecords).not.toHaveBeenCalled();
  });

  it("no provider id and outcome NOT unknown: still skipped, no DingConnect calls", async () => {
    const tx = makeStuckTx({ metadata: {} });

    const result = await settleStuckTransfer(tx);

    expect(result).toBe("skipped");
    expect(tx.status).toBe("processing");
    expect(mockDing.listTransferRecords).not.toHaveBeenCalled();
    expect(mockDing.getTransferStatus).not.toHaveBeenCalled();
  });
});
