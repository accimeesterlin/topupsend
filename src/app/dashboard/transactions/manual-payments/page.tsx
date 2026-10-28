"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, Plus, RefreshCw } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from "@topupsend/ui";
import { DashboardLayout } from "@/components/dashboard-layout";
import { ManualPaymentDialog } from "@/components/manual-payment-dialog";
import { format } from "date-fns";

interface ManualPayment {
  id: string;
  customerId?: string;
  transactionId?: string;
  orderId?: string;
  amount: number;
  currency: string;
  method: string;
  reference?: string;
  proofReference?: string;
  notes?: string;
  receivedAt: string;
  appliedTo: "order" | "customer_balance";
  status: "recorded" | "voided";
  createdBy: string;
  voidedBy?: string;
  voidedAt?: string;
  voidReason?: string;
  createdAt: string;
}

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  bank_transfer: "Bank Transfer",
  moncash: "MonCash",
  natcash: "Natcash",
  check: "Check",
  other: "Other",
};

const selectClass =
  "px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary";

export default function ManualPaymentsPage() {
  const [payments, setPayments] = useState<ManualPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [methodFilter, setMethodFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 0,
  });
  const [isAdmin, setIsAdmin] = useState(false);
  const [showRecordDialog, setShowRecordDialog] = useState(false);
  const [voidTarget, setVoidTarget] = useState<ManualPayment | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);

  useEffect(() => {
    const fetchMe = async () => {
      try {
        const response = await fetch("/api/v1/auth/me");
        if (response.ok) {
          const data = await response.json();
          setIsAdmin((data.roles || []).includes("admin"));
        }
      } catch {
        // Void button simply stays hidden if the check fails
      }
    };
    void fetchMe();
  }, []);

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(currentPage),
        limit: "25",
      });
      if (methodFilter !== "all") params.set("method", methodFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);

      const response = await fetch(`/api/v1/payments/manual?${params}`);
      if (!response.ok) throw new Error("Failed to fetch manual payments");
      const data = await response.json();
      setPayments(data.manualPayments || []);
      setPagination(data.pagination);
    } catch {
      toast({
        title: "Error",
        description: "Failed to load manual payments",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [currentPage, methodFilter, statusFilter]);

  useEffect(() => {
    void fetchPayments();
  }, [fetchPayments]);

  const handleVoid = async () => {
    if (!voidTarget || !voidReason.trim()) return;
    setVoiding(true);
    try {
      const response = await fetch(
        `/api/v1/payments/manual/${voidTarget.id}/void`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: voidReason.trim() }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || data.message || "Failed to void payment");
      }
      toast({
        title: "Success",
        description: "Manual payment voided",
        variant: "success",
      });
      setVoidTarget(null);
      setVoidReason("");
      void fetchPayments();
    } catch (err) {
      toast({
        title: "Error",
        description:
          err instanceof Error ? err.message : "Failed to void payment",
        variant: "error",
      });
    } finally {
      setVoiding(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard/transactions">
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Transactions
                </Link>
              </Button>
            </div>
            <h1 className="text-3xl font-bold tracking-tight mt-1">
              Manual Payments
            </h1>
            <p className="text-muted-foreground mt-1">
              Payments received outside online checkout, recorded by staff
            </p>
          </div>
          <Button onClick={() => setShowRecordDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Record Manual Payment
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex gap-2 items-center">
            <label className="text-sm font-medium">Method:</label>
            <select
              className={selectClass}
              value={methodFilter}
              onChange={(e) => {
                setMethodFilter(e.target.value);
                setCurrentPage(1);
              }}
            >
              <option value="all">All Methods</option>
              {Object.entries(METHOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 items-center">
            <label className="text-sm font-medium">Status:</label>
            <select
              className={selectClass}
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setCurrentPage(1);
              }}
            >
              <option value="all">All Statuses</option>
              <option value="recorded">Recorded</option>
              <option value="voided">Voided</option>
            </select>
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-16">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : payments.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <h3 className="text-lg font-semibold mb-2">
                No manual payments found
              </h3>
              <p className="text-muted-foreground text-center max-w-md">
                Payments recorded for offline receipts (cash, transfers,
                MonCash, Natcash) will appear here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {payments.map((payment) => (
              <Card key={payment.id}>
                <CardContent className="p-4">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">
                          {METHOD_LABELS[payment.method] || payment.method}
                        </span>
                        {payment.status === "voided" ? (
                          <span className="inline-flex items-center px-2 py-0.5 bg-red-100 text-red-800 border border-red-200 rounded-full text-xs font-medium">
                            Voided
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-full text-xs font-medium">
                            Recorded
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {payment.appliedTo === "order"
                            ? `Order ${payment.orderId || ""}`
                            : "Customer balance"}
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Received{" "}
                        {format(
                          new Date(payment.receivedAt),
                          "MMM dd, yyyy HH:mm",
                        )}
                        {payment.reference && (
                          <>
                            <span className="mx-2">•</span>
                            <span>Ref: {payment.reference}</span>
                          </>
                        )}
                        {payment.proofReference && (
                          <>
                            <span className="mx-2">•</span>
                            <span>Proof: {payment.proofReference}</span>
                          </>
                        )}
                      </div>
                      {payment.notes && (
                        <p className="text-sm text-muted-foreground">
                          {payment.notes}
                        </p>
                      )}
                      {payment.status === "voided" && payment.voidReason && (
                        <p className="text-sm text-red-600">
                          Void reason: {payment.voidReason}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Recorded{" "}
                        {format(
                          new Date(payment.createdAt),
                          "MMM dd, yyyy HH:mm",
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 md:flex-col md:items-end">
                      <span className="text-lg font-bold">
                        {payment.currency} {payment.amount.toFixed(2)}
                      </span>
                      {isAdmin && payment.status === "recorded" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setVoidTarget(payment);
                            setVoidReason("");
                          }}
                        >
                          <Ban className="h-3.5 w-3.5 mr-1" />
                          Void
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {pagination.page} of {pagination.totalPages} •{" "}
              {pagination.total} payments
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= pagination.totalPages}
                onClick={() => setCurrentPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Record dialog */}
      <ManualPaymentDialog
        open={showRecordDialog}
        onOpenChange={setShowRecordDialog}
        onSuccess={() => void fetchPayments()}
      />

      {/* Void dialog (admin only) */}
      <Dialog
        open={voidTarget !== null}
        onOpenChange={(open) => {
          if (!open) setVoidTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Void Manual Payment</DialogTitle>
            <DialogDescription>
              Voiding reverses the payment&apos;s effect where possible. A
              balance credit can only be voided while it is unspent, and an
              order payment cannot be voided once the top-up is delivered.
              The record itself is never deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <label className="text-sm font-medium">
              Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary min-h-[80px]"
              placeholder="Why is this payment being voided?"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setVoidTarget(null)}
              disabled={voiding}
            >
              Cancel
            </Button>
            <Button
              onClick={handleVoid}
              disabled={voiding || !voidReason.trim()}
            >
              {voiding ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Voiding...
                </>
              ) : (
                "Void Payment"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
