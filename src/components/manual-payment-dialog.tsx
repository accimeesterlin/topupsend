"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from "@topupsend/ui";

/**
 * Record Manual Payment dialog.
 *
 * Shared by the transactions page (button + pending-order row action) and
 * the customer detail page (balance card action). A manual payment is
 * applied either to a customer's prepaid balance or to an existing unpaid
 * order (full amount, order currency). The reference field is required
 * for every method except cash — enforced here and on the server.
 */

export interface ManualPaymentCustomer {
  id: string;
  name?: string;
  email?: string;
  phoneNumber?: string;
  balanceCurrency: string;
}

export interface ManualPaymentOrder {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  status: string;
  phoneNumber?: string;
}

interface ManualPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected customer (balance mode, from the customer detail page) */
  presetCustomer?: ManualPaymentCustomer;
  /** Pre-selected order (order mode, from a transaction row action) */
  presetOrder?: ManualPaymentOrder;
  onSuccess?: () => void;
}

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "moncash", label: "MonCash" },
  { value: "natcash", label: "Natcash" },
  { value: "check", label: "Check" },
  { value: "other", label: "Other" },
] as const;

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const inputClass =
  "w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary";

export function ManualPaymentDialog({
  open,
  onOpenChange,
  presetCustomer,
  presetOrder,
  onSuccess,
}: ManualPaymentDialogProps) {
  const [appliedTo, setAppliedTo] = useState<"order" | "customer_balance">(
    "customer_balance",
  );
  const [customer, setCustomer] = useState<ManualPaymentCustomer | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<
    ManualPaymentCustomer[]
  >([]);
  const [order, setOrder] = useState<ManualPaymentOrder | null>(null);
  const [orderSearch, setOrderSearch] = useState("");
  const [orderResults, setOrderResults] = useState<ManualPaymentOrder[]>([]);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("cash");
  const [reference, setReference] = useState("");
  const [proofReference, setProofReference] = useState("");
  const [receivedAt, setReceivedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Reset the form every time the dialog opens
  useEffect(() => {
    if (!open) return;
    setError("");
    setMethod("cash");
    setReference("");
    setProofReference("");
    setNotes("");
    setReceivedAt(toLocalInputValue(new Date()));
    setCustomerSearch("");
    setCustomerResults([]);
    setOrderSearch("");
    setOrderResults([]);

    if (presetOrder) {
      setAppliedTo("order");
      setOrder(presetOrder);
      setAmount(presetOrder.amount.toFixed(2));
      setCustomer(null);
    } else if (presetCustomer) {
      setAppliedTo("customer_balance");
      setCustomer(presetCustomer);
      setOrder(null);
      setAmount("");
    } else {
      setAppliedTo("customer_balance");
      setCustomer(null);
      setOrder(null);
      setAmount("");
    }
  }, [open, presetCustomer, presetOrder]);

  // Customer search (balance mode)
  useEffect(() => {
    if (!open || appliedTo !== "customer_balance" || presetCustomer) return;
    if (customerSearch.trim().length < 2) {
      setCustomerResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/v1/customers?search=${encodeURIComponent(customerSearch)}&limit=10`,
        );
        if (!response.ok) return;
        const data = await response.json();
        setCustomerResults(
          (data.customers || []).map((c: any) => ({
            id: c._id,
            name: c.name,
            email: c.email,
            phoneNumber: c.phoneNumber,
            balanceCurrency: c.balanceCurrency || "USD",
          })),
        );
      } catch {
        // Search is best-effort; the form stays usable
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [open, appliedTo, presetCustomer, customerSearch]);

  // Unpaid order search (order mode): pending and failed (retry) orders
  useEffect(() => {
    if (!open || appliedTo !== "order" || presetOrder) return;
    if (orderSearch.trim().length < 2) {
      setOrderResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const fetchByStatus = async (status: string) => {
          const response = await fetch(
            `/api/v1/transactions?status=${status}&search=${encodeURIComponent(orderSearch)}&limit=10`,
          );
          if (!response.ok) return [];
          const data = await response.json();
          return (data.transactions || []) as any[];
        };
        const [pending, failed] = await Promise.all([
          fetchByStatus("pending"),
          fetchByStatus("failed"),
        ]);
        const combined = [...pending, ...failed]
          .filter((t) => !t.isTestMode && !t.metadata?.testMode)
          .map((t) => ({
            id: t._id,
            orderId: t.orderId,
            amount: t.amount,
            currency: t.currency,
            status: t.status,
            phoneNumber: t.recipient?.phoneNumber,
          }));
        setOrderResults(combined);
      } catch {
        // Search is best-effort; the form stays usable
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [open, appliedTo, presetOrder, orderSearch]);

  const currency =
    appliedTo === "order" ? order?.currency : customer?.balanceCurrency;
  const referenceRequired = method !== "cash";
  const amountValue = parseFloat(amount);
  const amountValid = !Number.isNaN(amountValue) && amountValue > 0;
  const orderAmountMismatch =
    appliedTo === "order" &&
    order !== null &&
    amountValid &&
    Math.round(amountValue * 100) !== Math.round(order.amount * 100);

  const canSubmit =
    !submitting &&
    amountValid &&
    !orderAmountMismatch &&
    (!referenceRequired || reference.trim().length > 0) &&
    (appliedTo === "order" ? order !== null : customer !== null);

  const handleSubmit = async () => {
    setError("");
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        appliedTo,
        amount: amountValue,
        currency,
        method,
        receivedAt: receivedAt
          ? new Date(receivedAt).toISOString()
          : undefined,
      };
      if (appliedTo === "order") {
        body.transactionId = order?.id;
      } else {
        body.customerId = customer?.id;
      }
      if (reference.trim()) body.reference = reference.trim();
      if (proofReference.trim()) body.proofReference = proofReference.trim();
      if (notes.trim()) body.notes = notes.trim();

      const response = await fetch("/api/v1/payments/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          data.detail || data.message || "Failed to record manual payment",
        );
      }

      toast({
        title: "Success",
        description: data.message || "Manual payment recorded successfully",
        variant: "success",
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to record manual payment";
      setError(message);
      toast({ title: "Error", description: message, variant: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record Manual Payment</DialogTitle>
          <DialogDescription>
            Record a payment received outside online checkout (cash, bank
            transfer, MonCash, Natcash, check). The record cannot be edited
            afterwards — only voided by an admin.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-1">
          {/* Apply to */}
          {!presetOrder && !presetCustomer && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Apply payment to</label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={
                    appliedTo === "customer_balance" ? "default" : "outline"
                  }
                  size="sm"
                  onClick={() => setAppliedTo("customer_balance")}
                >
                  Customer Balance
                </Button>
                <Button
                  type="button"
                  variant={appliedTo === "order" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setAppliedTo("order")}
                >
                  Existing Order
                </Button>
              </div>
            </div>
          )}

          {/* Customer picker (balance mode) */}
          {appliedTo === "customer_balance" &&
            (presetCustomer || customer ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">Customer</label>
                <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div>
                    <p className="font-medium">
                      {(presetCustomer || customer)?.name || "Customer"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {(presetCustomer || customer)?.phoneNumber ||
                        (presetCustomer || customer)?.email ||
                        ""}
                    </p>
                  </div>
                  {!presetCustomer && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setCustomer(null)}
                    >
                      Change
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Customer <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    className={`${inputClass} pl-10`}
                    placeholder="Search by name, phone, or email..."
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                  />
                </div>
                {customerResults.length > 0 && (
                  <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
                    {customerResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-muted"
                        onClick={() => setCustomer(c)}
                      >
                        <span className="font-medium">{c.name || "Customer"}</span>
                        <span className="block text-xs text-muted-foreground">
                          {c.phoneNumber || c.email || ""} • Balance in{" "}
                          {c.balanceCurrency}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

          {/* Order picker (order mode) */}
          {appliedTo === "order" &&
            (presetOrder || order ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">Order</label>
                <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div>
                    <p className="font-mono font-medium">
                      {(presetOrder || order)?.orderId}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {(presetOrder || order)?.currency}{" "}
                      {(presetOrder || order)?.amount.toFixed(2)} •{" "}
                      {(presetOrder || order)?.phoneNumber || ""} •{" "}
                      {(presetOrder || order)?.status}
                    </p>
                  </div>
                  {!presetOrder && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setOrder(null)}
                    >
                      Change
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Order <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    className={`${inputClass} pl-10`}
                    placeholder="Search unpaid orders by ID or phone..."
                    value={orderSearch}
                    onChange={(e) => setOrderSearch(e.target.value)}
                  />
                </div>
                {orderResults.length > 0 && (
                  <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
                    {orderResults.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-muted"
                        onClick={() => {
                          setOrder(o);
                          setAmount(o.amount.toFixed(2));
                        }}
                      >
                        <span className="font-mono font-medium">{o.orderId}</span>
                        <span className="block text-xs text-muted-foreground">
                          {o.currency} {o.amount.toFixed(2)} •{" "}
                          {o.phoneNumber || ""} • {o.status}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Only pending or failed orders can be settled with a manual
                  payment, and the payment must cover the full amount due.
                </p>
              </div>
            ))}

          {/* Amount + currency */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2 col-span-2">
              <label className="text-sm font-medium">
                Amount <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                className={inputClass}
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              {orderAmountMismatch && (
                <p className="text-xs text-red-600">
                  For an order, the payment must equal the full amount due (
                  {order?.currency} {order?.amount.toFixed(2)}).
                </p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Currency</label>
              <input
                type="text"
                className={`${inputClass} bg-muted`}
                value={currency || ""}
                readOnly
              />
            </div>
          </div>

          {/* Method */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Method <span className="text-red-500">*</span>
            </label>
            <select
              className={inputClass}
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* Reference */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Reference{" "}
              {referenceRequired ? (
                <span className="text-red-500">*</span>
              ) : (
                <span className="text-muted-foreground">(optional for cash)</span>
              )}
            </label>
            <input
              type="text"
              className={inputClass}
              placeholder="Transfer ID, MonCash/Natcash transaction ID, receipt number..."
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>

          {/* Received at */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Date received</label>
            <input
              type="datetime-local"
              className={inputClass}
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
            />
          </div>

          {/* Proof reference */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Proof reference <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              type="text"
              className={inputClass}
              placeholder="Receipt number or where the proof is stored"
              value={proofReference}
              onChange={(e) => setProofReference(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Notes <span className="text-muted-foreground">(optional)</span>
            </label>
            <textarea
              className={`${inputClass} min-h-[60px]`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Recording...
              </>
            ) : (
              "Record Payment"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
