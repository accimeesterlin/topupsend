import {
  createManualPaymentSchema,
  voidManualPaymentSchema,
} from "../validations/manual-payment";

/**
 * Validation-rule tests for manual payments.
 * (Real Mongoose model tests are not possible under the current jest
 * config — bson's ESM entry is not transformed, which is why the existing
 * model tests avoid runtime model imports. The rules are therefore tested
 * here, through the shared validation module the API routes use, and the
 * model schema carries the same rules as defense-in-depth.)
 */

const balancePayment = {
  appliedTo: "customer_balance" as const,
  customerId: "customer-123",
  amount: 25.5,
  currency: "USD",
  method: "cash" as const,
};

describe("createManualPaymentSchema", () => {
  it("accepts a cash payment without a reference", () => {
    const result = createManualPaymentSchema.safeParse(balancePayment);
    expect(result.success).toBe(true);
  });

  it.each(["bank_transfer", "moncash", "natcash", "check", "other"] as const)(
    "requires a reference for method %s",
    (method) => {
      const result = createManualPaymentSchema.safeParse({
        ...balancePayment,
        method,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((issue) => issue.path.includes("reference")),
        ).toBe(true);
      }
    },
  );

  it("accepts a non-cash payment with a reference", () => {
    const result = createManualPaymentSchema.safeParse({
      ...balancePayment,
      method: "moncash",
      reference: "MC-987654",
    });
    expect(result.success).toBe(true);
  });

  it("rejects zero and negative amounts", () => {
    expect(
      createManualPaymentSchema.safeParse({ ...balancePayment, amount: 0 })
        .success,
    ).toBe(false);
    expect(
      createManualPaymentSchema.safeParse({ ...balancePayment, amount: -5 })
        .success,
    ).toBe(false);
  });

  it("rejects amounts with more than 2 decimal places", () => {
    const result = createManualPaymentSchema.safeParse({
      ...balancePayment,
      amount: 10.999,
    });
    expect(result.success).toBe(false);
  });

  it("requires customerId for balance applications", () => {
    const { customerId: _omitted, ...withoutCustomer } = balancePayment;
    const result = createManualPaymentSchema.safeParse(withoutCustomer);
    expect(result.success).toBe(false);
  });

  it("requires transactionId for order applications", () => {
    const result = createManualPaymentSchema.safeParse({
      appliedTo: "order",
      amount: 25.5,
      method: "cash",
    });
    expect(result.success).toBe(false);

    const withTransaction = createManualPaymentSchema.safeParse({
      appliedTo: "order",
      transactionId: "txn-123",
      amount: 25.5,
      method: "cash",
    });
    expect(withTransaction.success).toBe(true);
  });

  it("rejects an unknown method", () => {
    const result = createManualPaymentSchema.safeParse({
      ...balancePayment,
      method: "carrier_pigeon",
    });
    expect(result.success).toBe(false);
  });
});

describe("voidManualPaymentSchema", () => {
  it("requires a non-empty reason", () => {
    expect(voidManualPaymentSchema.safeParse({}).success).toBe(false);
    expect(voidManualPaymentSchema.safeParse({ reason: "  " }).success).toBe(
      false,
    );
    expect(
      voidManualPaymentSchema.safeParse({ reason: "Recorded twice" }).success,
    ).toBe(true);
  });
});
