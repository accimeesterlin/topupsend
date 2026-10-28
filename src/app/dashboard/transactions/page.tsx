"use client";

import { useState, useEffect, useRef } from "react";
import {
  Search,
  Filter,
  Download,
  Beaker,
  CheckCircle,
  XCircle,
  Clock,
  Phone,
  Mail,
  X,
  Copy,
  Calendar,
  DollarSign,
  User,
  RefreshCw,
  AlertTriangle,
  MoreVertical,
  Plus,
} from "lucide-react";
import Link from "next/link";
import {
  Button,
  Card,
  CardContent,
  toast,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@topupsend/ui";
import { DashboardLayout } from "@/components/dashboard-layout";
import { ManualPaymentDialog } from "@/components/manual-payment-dialog";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { format } from "date-fns";
import { TransactionStatus } from "@topupsend/types";

interface Transaction {
  _id: string;
  orderId: string;
  orgId: string;
  status: string;
  amount: number;
  currency: string;
  recipient: {
    phoneNumber: string;
    email?: string;
    name?: string;
  };
  operator: {
    id: string;
    name: string;
    country: string;
  };
  productName?: string;
  providerTransactionId?: string;
  paymentGateway?: string;
  paymentId?: string;
  metadata: {
    testMode?: boolean;
    productName?: string;
    productSkuCode?: string;
    isVariableValue?: boolean;
    sendValue?: number;
    failureReason?: string;
    retryCount?: number;
    retriedBy?: string;
    retriedAt?: string;
    [key: string]: any;
  };
  createdAt: string;
  timeline: {
    createdAt?: Date;
    paidAt?: Date;
    completedAt?: Date;
    failedAt?: Date;
    refundedAt?: Date;
  };
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [showTestMode, setShowTestMode] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 0,
  });
  const [selectedTransaction, setSelectedTransaction] =
    useState<Transaction | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [newStatus, setNewStatus] = useState("");
  const [statusReason, setStatusReason] = useState("");
  const [showRetryDialog, setShowRetryDialog] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryForm, setRetryForm] = useState({
    phoneNumber: "",
    skuCode: "",
    sendValue: "",
    validateOnly: false,
  });
  const [showRefundDialog, setShowRefundDialog] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [showManualPaymentDialog, setShowManualPaymentDialog] =
    useState(false);
  const [manualPaymentTransaction, setManualPaymentTransaction] =
    useState<Transaction | null>(null);

  // Load filters from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("transactionFilters");
      if (saved) {
        try {
          const filters = JSON.parse(saved);
          if (filters.search !== undefined) setSearch(filters.search);
          if (filters.statusFilter !== undefined)
            setStatusFilter(filters.statusFilter);
          if (filters.showTestMode !== undefined)
            setShowTestMode(filters.showTestMode);
          if (filters.pageSize !== undefined) setPageSize(filters.pageSize);
          if (filters.currentPage !== undefined)
            setCurrentPage(filters.currentPage);
          if (filters.showFilters !== undefined)
            setShowFilters(filters.showFilters);
        } catch (e) {
          console.error("Failed to load saved filters:", e);
        }
      }
    }
  }, []);

  // Save filters to localStorage whenever they change
  useEffect(() => {
    if (typeof window !== "undefined") {
      const filters = {
        search,
        statusFilter,
        showTestMode,
        pageSize,
        currentPage,
        showFilters,
      };
      localStorage.setItem("transactionFilters", JSON.stringify(filters));
    }
  }, [search, statusFilter, showTestMode, pageSize, currentPage, showFilters]);

  // Debounce search input - wait 300ms after user stops typing
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentPage(1);
    }, 300);
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [search]);

  useEffect(() => {
    fetchTransactions();
  }, [debouncedSearch, statusFilter, showTestMode, currentPage, pageSize]);

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.append("search", debouncedSearch);
      if (statusFilter !== "all") params.append("status", statusFilter);
      if (!showTestMode) params.append("excludeTestMode", "true");
      params.append("page", currentPage.toString());
      params.append("limit", pageSize.toString());

      const response = await fetch(`/api/v1/transactions?${params}`);
      if (response.ok) {
        const data = await response.json();
        setTransactions(data.transactions || []);
        setPagination(
          data.pagination || { page: 1, limit: 25, total: 0, totalPages: 0 },
        );
      }
    } catch (_error) {
      console.error("Failed to fetch transactions:", _error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const styles =
      {
        completed: "bg-green-100 text-green-800 border-green-200",
        pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
        paid: "bg-blue-100 text-blue-800 border-blue-200",
        processing: "bg-purple-100 text-purple-800 border-purple-200",
        failed: "bg-red-100 text-red-800 border-red-200",
        refunded: "bg-gray-100 text-gray-800 border-gray-200",
      }[status] || "bg-gray-100 text-gray-800 border-gray-200";

    const Icon =
      {
        completed: CheckCircle,
        failed: XCircle,
        pending: Clock,
        paid: CheckCircle,
        processing: Clock,
        refunded: XCircle,
      }[status] || Clock;

    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${styles}`}
      >
        <Icon className="h-3 w-3" />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied!",
      description: `${label} copied to clipboard`,
      variant: "success",
    });
  };

  const handleTransactionClick = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setShowDetails(true);
  };

  const handleUpdateStatus = async () => {
    if (!selectedTransaction || !newStatus) return;

    setUpdatingStatus(true);
    try {
      const response = await fetch(
        `/api/v1/transactions/${selectedTransaction._id}/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: newStatus,
            reason: statusReason || undefined,
          }),
        },
      );

      if (response.ok) {
        toast({
          title: "Success",
          description: "Transaction status updated successfully",
          variant: "success",
        });
        setShowStatusDialog(false);
        setNewStatus("");
        setStatusReason("");
        fetchTransactions();
        // Update selected transaction if details panel is open
        if (showDetails && selectedTransaction) {
          const updatedTx = transactions.find(
            (t) => t._id === selectedTransaction._id,
          );
          if (updatedTx) {
            setSelectedTransaction({ ...updatedTx, status: newStatus });
          }
        }
      } else {
        const error = await response.json();
        toast({
          title: "Error",
          description: error.detail || "Failed to update transaction status",
          variant: "error",
        });
      }
    } catch (_error) {
      toast({
        title: "Error",
        description: "Failed to update transaction status",
        variant: "error",
      });
    } finally {
      setUpdatingStatus(false);
    }
  };

  const openStatusDialog = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setNewStatus(transaction.status);
    setStatusReason("");
    setShowStatusDialog(true);
  };

  const openRetryDialog = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setRetryForm({
      phoneNumber: transaction.recipient.phoneNumber,
      skuCode: transaction.metadata?.productSkuCode || "",
      sendValue: transaction.metadata?.sendValue?.toString() || "",
      validateOnly: false,
    });
    setShowRetryDialog(true);
  };

  const openRefundDialog = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setRefundReason("");
    setShowRefundDialog(true);
  };

  const handleRetryTransaction = async () => {
    if (!selectedTransaction) return;

    setRetrying(true);
    try {
      const body: Record<string, unknown> = {
        validateOnly: retryForm.validateOnly,
      };

      // Only send fields that differ from originals
      if (retryForm.phoneNumber !== selectedTransaction.recipient.phoneNumber) {
        body.phoneNumber = retryForm.phoneNumber;
      }
      if (
        retryForm.skuCode !==
        (selectedTransaction.metadata?.productSkuCode || "")
      ) {
        body.skuCode = retryForm.skuCode;
      }
      if (
        retryForm.sendValue &&
        Number(retryForm.sendValue) !== selectedTransaction.metadata?.sendValue
      ) {
        body.sendValue = Number(retryForm.sendValue);
      }

      const response = await fetch(
        `/api/v1/transactions/${selectedTransaction._id}/retry`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      const data = await response.json();

      if (response.ok && data.data?.retrySuccess) {
        toast({
          title: retryForm.validateOnly
            ? "Validation Successful"
            : "Retry Successful",
          description: retryForm.validateOnly
            ? "DingConnect validated the transfer successfully."
            : "Transaction has been retried and completed successfully.",
          variant: "success",
        });
        setShowRetryDialog(false);
        setShowDetails(false);
        fetchTransactions();
      } else if (response.ok && data.data?.retrySuccess === false) {
        toast({
          title: "Retry Failed",
          description:
            data.data?.transferResult?.errorMessage ||
            data.data?.transaction?.metadata?.failureReason ||
            "DingConnect transfer failed. Check the failure reason and try again.",
          variant: "error",
          duration: 0,
        });
        fetchTransactions();
      } else {
        toast({
          title: "Error",
          description: data.detail || data.title || "Failed to retry transaction",
          variant: "error",
        });
      }
    } catch {
      toast({
        title: "Error",
        description: "Failed to retry transaction. Please try again.",
        variant: "error",
      });
    } finally {
      setRetrying(false);
    }
  };

  const handleRefundTransaction = async () => {
    if (!selectedTransaction) return;

    setRefunding(true);
    try {
      const response = await fetch(
        `/api/v1/transactions/${selectedTransaction._id}/refund`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: refundReason || undefined,
          }),
        },
      );

      const data = await response.json();

      if (response.ok && data.success) {
        toast({
          title: "Refund Successful",
          description:
            data.message ||
            "Transaction has been refunded successfully.",
          variant: "success",
        });
        setShowRefundDialog(false);
        setShowDetails(false);
        fetchTransactions();
      } else {
        toast({
          title: "Refund Failed",
          description:
            data.detail || data.title || "Failed to process refund.",
          variant: "error",
        });
      }
    } catch {
      toast({
        title: "Error",
        description: "Failed to process refund. Please try again.",
        variant: "error",
      });
    } finally {
      setRefunding(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading transactions...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Transactions</h1>
            <p className="text-muted-foreground mt-1">
              View and manage all your top-up transactions
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href="/dashboard/transactions/manual-payments">
                Manual Payments
              </Link>
            </Button>
            <Button
              onClick={() => {
                setManualPaymentTransaction(null);
                setShowManualPaymentDialog(true);
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Record Manual Payment
            </Button>
            <Button variant="outline" disabled={transactions.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by order ID, phone, or email..."
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button
            variant={showFilters ? "default" : "outline"}
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-4 w-4 mr-2" />
            Filters
          </Button>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                <div className="flex gap-2 items-center">
                  <label className="text-sm font-medium">Status:</label>
                  <select
                    className="px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                  >
                    <option value="all">All Statuses</option>
                    <option value="pending">Pending</option>
                    <option value="paid">Paid</option>
                    <option value="processing">Processing</option>
                    <option value="completed">Completed</option>
                    <option value="failed">Failed</option>
                    <option value="refunded">Refunded</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="showTestMode"
                    checked={showTestMode}
                    onChange={(e) => {
                      setShowTestMode(e.target.checked);
                      setCurrentPage(1);
                    }}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <label
                    htmlFor="showTestMode"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Show test mode transactions
                  </label>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Pagination Info */}
        {!loading && pagination.total > 0 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <div>
              Showing {(pagination.page - 1) * pagination.limit + 1} to{" "}
              {Math.min(pagination.page * pagination.limit, pagination.total)}{" "}
              of {pagination.total} transactions
            </div>
            <div className="flex items-center gap-2">
              <label className="font-medium">Per page:</label>
              <select
                className="px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
              >
                <option value="10">10</option>
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
          </div>
        )}

        {/* Transactions List */}
        {transactions.length > 0 ? (
          <div className="space-y-3">
            {transactions.map((transaction) => (
              <Card
                key={transaction._id}
                className="hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => handleTransactionClick(transaction)}
              >
                <CardContent className="p-4">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    {/* Left: Transaction Info */}
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-medium">
                          {transaction.orderId}
                        </span>
                        {transaction.metadata?.testMode && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-800 border border-amber-200 rounded-full text-xs font-medium">
                            <Beaker className="h-3 w-3" />
                            Test Mode
                          </span>
                        )}
                        {transaction.paymentGateway === "manual" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-full text-xs font-medium">
                            <DollarSign className="h-3 w-3" />
                            Manual
                          </span>
                        )}
                        {getStatusBadge(transaction.status)}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Phone className="h-3.5 w-3.5" />
                          <span>{transaction.recipient.phoneNumber}</span>
                          <WhatsAppButton phoneNumber={transaction.recipient.phoneNumber} size="sm" />
                        </div>
                        {transaction.recipient.email && (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Mail className="h-3.5 w-3.5" />
                            <span className="truncate">
                              {transaction.recipient.email}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="text-xs text-muted-foreground">
                        <span>
                          {transaction.metadata?.productName ||
                            transaction.operator?.name ||
                            "N/A"}
                        </span>
                        <span className="mx-2">•</span>
                        <span>
                          {format(
                            new Date(transaction.createdAt),
                            "MMM dd, yyyy HH:mm",
                          )}
                        </span>
                        {transaction.providerTransactionId && (
                          <>
                            <span className="mx-2">•</span>
                            <span className="font-mono">
                              {transaction.providerTransactionId}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Right: Amount and Actions */}
                    <div className="flex items-center justify-between md:justify-end md:flex-col md:items-end gap-2">
                      <span className="text-lg font-bold">
                        {formatCurrency(
                          transaction.amount,
                          transaction.currency,
                        )}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="sr-only">Open menu</span>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTransactionClick(transaction);
                            }}
                          >
                            <User className="h-3.5 w-3.5 mr-2" />
                            View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              openStatusDialog(transaction);
                            }}
                          >
                            <RefreshCw className="h-3.5 w-3.5 mr-2" />
                            Update Status
                          </DropdownMenuItem>
                          {(transaction.status === "pending" ||
                            transaction.status === "failed") && (
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                setManualPaymentTransaction(transaction);
                                setShowManualPaymentDialog(true);
                              }}
                            >
                              <DollarSign className="h-3.5 w-3.5 mr-2" />
                              Record Offline Payment
                            </DropdownMenuItem>
                          )}
                          {transaction.status === "failed" && (
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                openRetryDialog(transaction);
                              }}
                            >
                              <Beaker className="h-3.5 w-3.5 mr-2" />
                              Retry Transaction
                            </DropdownMenuItem>
                          )}
                          {transaction.status === "failed" && (
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                openRefundDialog(transaction);
                              }}
                            >
                              <DollarSign className="h-3.5 w-3.5 mr-2" />
                              Refund Transaction
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              copyToClipboard(transaction.orderId, "Order ID");
                            }}
                          >
                            <Copy className="h-3.5 w-3.5 mr-2" />
                            Copy Order ID
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <Search className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">
                {search || statusFilter !== "all"
                  ? "No transactions found"
                  : "No transactions yet"}
              </h3>
              <p className="text-muted-foreground text-center max-w-md mb-6">
                {search || statusFilter !== "all"
                  ? "Try adjusting your search or filters"
                  : "Your transaction history will appear here once you start processing top-ups."}
              </p>
              {(search || statusFilter !== "all") && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch("");
                    setStatusFilter("all");
                  }}
                >
                  Clear Filters
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Pagination Controls - Shadcn Style */}
        {!loading && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between border-t pt-4">
            <div className="text-sm text-muted-foreground">
              Page <span className="font-medium">{pagination.page}</span> of{" "}
              <span className="font-medium">{pagination.totalPages}</span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
              >
                First
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>

              {/* Page Numbers */}
              <div className="hidden sm:flex items-center gap-1">
                {Array.from(
                  { length: Math.min(5, pagination.totalPages) },
                  (_, i) => {
                    let pageNum;
                    if (pagination.totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= pagination.totalPages - 2) {
                      pageNum = pagination.totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }

                    return (
                      <Button
                        key={pageNum}
                        variant={
                          currentPage === pageNum ? "default" : "outline"
                        }
                        size="sm"
                        onClick={() => setCurrentPage(pageNum)}
                        className="min-w-[2.5rem]"
                      >
                        {pageNum}
                      </Button>
                    );
                  },
                )}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setCurrentPage((p) => Math.min(pagination.totalPages, p + 1))
                }
                disabled={currentPage === pagination.totalPages}
              >
                Next
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(pagination.totalPages)}
                disabled={currentPage === pagination.totalPages}
              >
                Last
              </Button>
            </div>
          </div>
        )}

        {/* Transaction Details Sidebar */}
        {showDetails && selectedTransaction && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/50 z-40 animate-in fade-in"
              onClick={() => setShowDetails(false)}
            />

            {/* Sidebar */}
            <div className="fixed inset-y-0 right-0 w-full sm:w-[500px] bg-background shadow-xl z-50 overflow-y-auto animate-in slide-in-from-right duration-300">
              <div className="sticky top-0 bg-background border-b px-6 py-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Transaction Details</h2>
                <div className="flex items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          setShowDetails(false);
                          openStatusDialog(selectedTransaction);
                        }}
                      >
                        <RefreshCw className="h-3.5 w-3.5 mr-2" />
                        Update Status
                      </DropdownMenuItem>
                      {selectedTransaction.status === "failed" && (
                        <DropdownMenuItem
                          onClick={() => {
                            setShowDetails(false);
                            openRetryDialog(selectedTransaction);
                          }}
                        >
                          <Beaker className="h-3.5 w-3.5 mr-2" />
                          Retry Transaction
                        </DropdownMenuItem>
                      )}
                      {selectedTransaction.status === "failed" && (
                        <DropdownMenuItem
                          onClick={() => {
                            setShowDetails(false);
                            openRefundDialog(selectedTransaction);
                          }}
                        >
                          <DollarSign className="h-3.5 w-3.5 mr-2" />
                          Refund Transaction
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() =>
                          copyToClipboard(
                            selectedTransaction.orderId,
                            "Order ID",
                          )
                        }
                      >
                        <Copy className="h-3.5 w-3.5 mr-2" />
                        Copy Order ID
                      </DropdownMenuItem>
                      {selectedTransaction.providerTransactionId && (
                        <DropdownMenuItem
                          onClick={() =>
                            copyToClipboard(
                              selectedTransaction.providerTransactionId!,
                              "Provider Transaction ID",
                            )
                          }
                        >
                          <Copy className="h-3.5 w-3.5 mr-2" />
                          Copy Provider ID
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDetails(false)}
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* Status Badge */}
                <div className="flex items-center gap-2">
                  {getStatusBadge(selectedTransaction.status)}
                  {selectedTransaction.metadata?.testMode && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-800 border border-amber-200 rounded-full text-xs font-medium">
                      <Beaker className="h-3 w-3" />
                      Test Mode
                    </span>
                  )}
                </div>

                {/* Order ID */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase">
                    Order ID
                  </label>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="text-sm font-mono">
                      {selectedTransaction.orderId}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(
                          selectedTransaction.orderId,
                          "Order ID",
                        );
                      }}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                {/* Amount */}
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-5 w-5 text-muted-foreground" />
                        <span className="text-sm font-medium">Amount</span>
                      </div>
                      <span className="text-2xl font-bold">
                        {formatCurrency(
                          selectedTransaction.amount,
                          selectedTransaction.currency,
                        )}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                {/* Recipient Information */}
                <div>
                  <h3 className="text-sm font-semibold mb-3">Recipient</h3>
                  <Card>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        <Phone className="h-4 w-4 text-muted-foreground mt-0.5" />
                        <div className="flex-1">
                          <p className="text-xs text-muted-foreground">
                            Phone Number
                          </p>
                          <p className="text-sm font-medium">
                            {selectedTransaction.recipient.phoneNumber}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyToClipboard(
                              selectedTransaction.recipient.phoneNumber,
                              "Phone number",
                            );
                          }}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                        <WhatsAppButton phoneNumber={selectedTransaction.recipient.phoneNumber} />
                      </div>

                      {selectedTransaction.recipient.email && (
                        <div className="flex items-start gap-3">
                          <Mail className="h-4 w-4 text-muted-foreground mt-0.5" />
                          <div className="flex-1">
                            <p className="text-xs text-muted-foreground">
                              Email
                            </p>
                            <p className="text-sm font-medium">
                              {selectedTransaction.recipient.email}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyToClipboard(
                                selectedTransaction.recipient.email!,
                                "Email",
                              );
                            }}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      )}

                      {selectedTransaction.recipient.name && (
                        <div className="flex items-start gap-3">
                          <User className="h-4 w-4 text-muted-foreground mt-0.5" />
                          <div className="flex-1">
                            <p className="text-xs text-muted-foreground">
                              Name
                            </p>
                            <p className="text-sm font-medium">
                              {selectedTransaction.recipient.name}
                            </p>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Product & Operator */}
                <div>
                  <h3 className="text-sm font-semibold mb-3">
                    Product Details
                  </h3>
                  <Card>
                    <CardContent className="p-4 space-y-2">
                      <div>
                        <p className="text-xs text-muted-foreground">Product</p>
                        <p className="text-sm font-medium">
                          {selectedTransaction.metadata?.productName ||
                            selectedTransaction.operator?.name ||
                            "N/A"}
                        </p>
                      </div>
                      {selectedTransaction.operator && (
                        <>
                          <div>
                            <p className="text-xs text-muted-foreground">
                              Operator
                            </p>
                            <p className="text-sm font-medium">
                              {selectedTransaction.metadata?.providerName ||
                                selectedTransaction.operator.name}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">
                              Country
                            </p>
                            <p className="text-sm font-medium">
                              {selectedTransaction.metadata?.countryName ||
                                selectedTransaction.operator.country}
                            </p>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Pricing & Fees */}
                {(selectedTransaction.metadata?.costPrice != null ||
                  selectedTransaction.metadata?.dingConnectCost != null) && (
                  <div>
                    <h3 className="text-sm font-semibold mb-3">
                      Pricing & Fees
                    </h3>
                    <Card>
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-sm text-muted-foreground">
                            Cost Price
                          </p>
                          <p className="text-sm font-medium">
                            {formatCurrency(
                              selectedTransaction.metadata?.costPrice ??
                                selectedTransaction.metadata?.dingConnectCost ??
                                0,
                              selectedTransaction.currency,
                            )}
                          </p>
                        </div>
                        {(selectedTransaction.metadata?.markup ?? 0) > 0 && (
                          <div className="flex items-center justify-between">
                            <p className="text-sm text-muted-foreground">
                              Markup
                              {selectedTransaction.metadata?.pricingRuleName &&
                                selectedTransaction.metadata.pricingRuleName !==
                                  "None" && (
                                  <span className="text-xs ml-1">
                                    ({selectedTransaction.metadata.pricingRuleName})
                                  </span>
                                )}
                            </p>
                            <p className="text-sm font-medium text-amber-600">
                              +
                              {formatCurrency(
                                selectedTransaction.metadata.markup,
                                selectedTransaction.currency,
                              )}
                            </p>
                          </div>
                        )}
                        {(selectedTransaction.metadata?.discountAmount ??
                          selectedTransaction.metadata?.discount ??
                          0) > 0 && (
                          <div className="flex items-center justify-between">
                            <p className="text-sm text-muted-foreground">
                              Discount
                            </p>
                            <p className="text-sm font-medium text-green-600">
                              -
                              {formatCurrency(
                                selectedTransaction.metadata?.discountAmount ??
                                  selectedTransaction.metadata?.discount ??
                                  0,
                                selectedTransaction.currency,
                              )}
                            </p>
                          </div>
                        )}
                        <div className="border-t pt-2 flex items-center justify-between">
                          <p className="text-sm font-semibold">Total Charged</p>
                          <p className="text-sm font-bold">
                            {formatCurrency(
                              selectedTransaction.metadata?.finalPrice ??
                                selectedTransaction.amount,
                              selectedTransaction.currency,
                            )}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {/* Provider Transaction ID */}
                {selectedTransaction.providerTransactionId && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase">
                      Provider Transaction ID
                    </label>
                    <div className="mt-1 flex items-center gap-2">
                      <code className="text-sm font-mono">
                        {selectedTransaction.providerTransactionId}
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(
                            selectedTransaction.providerTransactionId!,
                            "Provider Transaction ID",
                          );
                        }}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* Timeline */}
                <div>
                  <h3 className="text-sm font-semibold mb-3">Timeline</h3>
                  <Card>
                    <CardContent className="p-4 space-y-3">
                      {selectedTransaction.timeline.createdAt && (
                        <div className="flex items-start gap-3">
                          <Calendar className="h-4 w-4 text-muted-foreground mt-0.5" />
                          <div>
                            <p className="text-xs text-muted-foreground">
                              Created
                            </p>
                            <p className="text-sm font-medium">
                              {format(
                                new Date(
                                  selectedTransaction.timeline.createdAt,
                                ),
                                "MMM dd, yyyy HH:mm:ss",
                              )}
                            </p>
                          </div>
                        </div>
                      )}
                      {selectedTransaction.timeline.paidAt && (
                        <div className="flex items-start gap-3">
                          <CheckCircle className="h-4 w-4 text-green-600 mt-0.5" />
                          <div>
                            <p className="text-xs text-muted-foreground">
                              Paid
                            </p>
                            <p className="text-sm font-medium">
                              {format(
                                new Date(selectedTransaction.timeline.paidAt),
                                "MMM dd, yyyy HH:mm:ss",
                              )}
                            </p>
                          </div>
                        </div>
                      )}
                      {selectedTransaction.timeline.completedAt && (
                        <div className="flex items-start gap-3">
                          <CheckCircle className="h-4 w-4 text-green-600 mt-0.5" />
                          <div>
                            <p className="text-xs text-muted-foreground">
                              Completed
                            </p>
                            <p className="text-sm font-medium">
                              {format(
                                new Date(
                                  selectedTransaction.timeline.completedAt,
                                ),
                                "MMM dd, yyyy HH:mm:ss",
                              )}
                            </p>
                          </div>
                        </div>
                      )}
                      {selectedTransaction.timeline.failedAt && (
                        <div className="flex items-start gap-3">
                          <XCircle className="h-4 w-4 text-red-600 mt-0.5" />
                          <div>
                            <p className="text-xs text-muted-foreground">
                              Failed
                            </p>
                            <p className="text-sm font-medium">
                              {format(
                                new Date(selectedTransaction.timeline.failedAt),
                                "MMM dd, yyyy HH:mm:ss",
                              )}
                            </p>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Metadata */}
                {selectedTransaction.metadata &&
                  (() => {
                    // Filter out fields already displayed in dedicated sections
                    const hiddenKeys = new Set([
                      "testMode",
                      "productName",
                      "productSkuCode",
                      "providerName",
                      "countryCode",
                      "countryName",
                      "costPrice",
                      "dingConnectCost",
                      "customerPrice",
                      "markup",
                      "discountAmount",
                      "discount",
                      "finalPrice",
                      "pricingRuleName",
                      "ipAddress",
                      "userAgent",
                      "pgpayToken",
                      "pgpayOrderId",
                    ]);
                    const filtered = Object.fromEntries(
                      Object.entries(selectedTransaction.metadata).filter(
                        ([key]) => !hiddenKeys.has(key),
                      ),
                    );
                    if (Object.keys(filtered).length === 0) return null;
                    return (
                      <div>
                        <h3 className="text-sm font-semibold mb-3">
                          Additional Information
                        </h3>
                        <Card>
                          <CardContent className="p-4">
                            <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
                              {JSON.stringify(filtered, null, 2)}
                            </pre>
                          </CardContent>
                        </Card>
                      </div>
                    );
                  })()}
              </div>
            </div>
          </>
        )}

        {/* Status Update Dialog */}
        <Dialog open={showStatusDialog} onOpenChange={setShowStatusDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Update Transaction Status</DialogTitle>
              <DialogDescription>
                Change the status of transaction {selectedTransaction?.orderId}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* Current Status */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Current Status</label>
                <div className="flex items-center gap-2">
                  {selectedTransaction &&
                    getStatusBadge(selectedTransaction.status)}
                </div>
              </div>

              {/* New Status */}
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  New Status <span className="text-red-500">*</span>
                </label>
                <select
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                >
                  <option value={TransactionStatus.PENDING}>Pending</option>
                  <option value={TransactionStatus.PAID}>Paid</option>
                  <option value={TransactionStatus.PROCESSING}>
                    Processing
                  </option>
                  <option value={TransactionStatus.COMPLETED}>Completed</option>
                  <option value={TransactionStatus.FAILED}>Failed</option>
                  <option value={TransactionStatus.REFUNDED}>Refunded</option>
                </select>
              </div>

              {/* Reason (required for failed/refunded status) */}
              {(newStatus === TransactionStatus.FAILED ||
                newStatus === TransactionStatus.REFUNDED) && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Reason <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary min-h-[80px]"
                    placeholder={`Explain why this transaction ${newStatus === TransactionStatus.FAILED ? "failed" : "was refunded"}...`}
                    value={statusReason}
                    onChange={(e) => setStatusReason(e.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    A reason is required when marking a transaction as{" "}
                    {newStatus}
                  </p>
                </div>
              )}

              {/* Warning for certain status changes */}
              {selectedTransaction &&
                newStatus !== selectedTransaction.status && (
                  <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                    <div className="text-sm text-amber-800">
                      <p className="font-medium">Confirm Status Change</p>
                      <p className="text-xs mt-1">
                        You are changing the status from{" "}
                        <strong>{selectedTransaction.status}</strong> to{" "}
                        <strong>{newStatus}</strong>. This action will update
                        the transaction timeline.
                      </p>
                    </div>
                  </div>
                )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowStatusDialog(false)}
                disabled={updatingStatus}
              >
                Cancel
              </Button>
              <Button
                onClick={handleUpdateStatus}
                disabled={
                  updatingStatus ||
                  !newStatus ||
                  newStatus === selectedTransaction?.status ||
                  ((newStatus === TransactionStatus.FAILED ||
                    newStatus === TransactionStatus.REFUNDED) &&
                    !statusReason?.trim())
                }
              >
                {updatingStatus ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Updating...
                  </>
                ) : (
                  "Update Status"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Retry Transaction Dialog */}
        <Dialog open={showRetryDialog} onOpenChange={setShowRetryDialog}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Retry Failed Transaction</DialogTitle>
              <DialogDescription>
                Retry DingConnect transfer for{" "}
                <span className="font-mono text-xs">
                  {selectedTransaction?.orderId}
                </span>
                . You can adjust the payload before retrying.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* Failure Reason Banner */}
              {selectedTransaction?.metadata?.failureReason && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                  <div className="text-sm text-red-800">
                    <p className="font-medium">Previous Failure Reason</p>
                    <p className="text-xs mt-1 break-words">
                      {selectedTransaction.metadata.failureReason}
                    </p>
                  </div>
                </div>
              )}

              {/* Retry Count */}
              {(selectedTransaction?.metadata?.retryCount ?? 0) > 0 && (
                <p className="text-sm text-muted-foreground">
                  This transaction has been retried{" "}
                  <strong>{selectedTransaction?.metadata?.retryCount}</strong>{" "}
                  time
                  {selectedTransaction?.metadata?.retryCount === 1
                    ? ""
                    : "s"}{" "}
                  before.
                </p>
              )}

              {/* Phone Number */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Phone Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  value={retryForm.phoneNumber}
                  onChange={(e) =>
                    setRetryForm((prev) => ({
                      ...prev,
                      phoneNumber: e.target.value,
                    }))
                  }
                  placeholder="e.g., +50937001234"
                />
              </div>

              {/* SKU Code */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  SKU Code <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                  value={retryForm.skuCode}
                  onChange={(e) =>
                    setRetryForm((prev) => ({
                      ...prev,
                      skuCode: e.target.value,
                    }))
                  }
                  placeholder="e.g., DBHTHT91705"
                />
              </div>

              {/* Send Value - shown for variable-value products or when there's a sendValue */}
              {(selectedTransaction?.metadata?.isVariableValue ||
                selectedTransaction?.metadata?.sendValue) && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Send Value (USD) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    value={retryForm.sendValue}
                    onChange={(e) =>
                      setRetryForm((prev) => ({
                        ...prev,
                        sendValue: e.target.value,
                      }))
                    }
                    placeholder="e.g., 5.00"
                  />
                </div>
              )}

              {/* Validate Only Toggle */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="retryValidateOnly"
                  checked={retryForm.validateOnly}
                  onChange={(e) =>
                    setRetryForm((prev) => ({
                      ...prev,
                      validateOnly: e.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded border-gray-300"
                />
                <label
                  htmlFor="retryValidateOnly"
                  className="text-sm font-medium cursor-pointer"
                >
                  Validate only (do not send real top-up)
                </label>
              </div>

              {/* Warning */}
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="text-sm text-amber-800">
                  <p className="font-medium">
                    {retryForm.validateOnly
                      ? "Validation Mode"
                      : "Confirm Retry"}
                  </p>
                  <p className="text-xs mt-1">
                    {retryForm.validateOnly
                      ? "This will validate the transfer with DingConnect without sending a real top-up."
                      : "This will send a real top-up via DingConnect. The recipient will receive the credit."}
                  </p>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowRetryDialog(false)}
                disabled={retrying}
              >
                Cancel
              </Button>
              <Button
                onClick={handleRetryTransaction}
                disabled={
                  retrying ||
                  !retryForm.phoneNumber.trim() ||
                  !retryForm.skuCode.trim() ||
                  !!(
                    (selectedTransaction?.metadata?.isVariableValue ||
                      selectedTransaction?.metadata?.sendValue) &&
                    !retryForm.sendValue
                  )
                }
              >
                {retrying ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    {retryForm.validateOnly ? "Validating..." : "Retrying..."}
                  </>
                ) : retryForm.validateOnly ? (
                  "Validate Transfer"
                ) : (
                  "Retry Transfer"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Refund Transaction Dialog */}
        <Dialog open={showRefundDialog} onOpenChange={setShowRefundDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Refund Transaction</DialogTitle>
              <DialogDescription>
                Refund transaction{" "}
                <span className="font-mono text-xs">
                  {selectedTransaction?.orderId}
                </span>
                . This will credit the customer&apos;s balance.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* Transaction Summary */}
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <div>
                  <p className="text-sm font-medium">
                    {selectedTransaction?.recipient?.phoneNumber}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {selectedTransaction?.metadata?.productName ||
                      selectedTransaction?.productName ||
                      "Unknown product"}
                  </p>
                </div>
                <p className="text-lg font-bold">
                  {selectedTransaction &&
                    formatCurrency(
                      selectedTransaction.amount,
                      selectedTransaction.currency,
                    )}
                </p>
              </div>

              {/* Failure Reason Banner */}
              {selectedTransaction?.metadata?.failureReason && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                  <div className="text-sm text-red-800">
                    <p className="font-medium">Failure Reason</p>
                    <p className="text-xs mt-1 break-words">
                      {selectedTransaction.metadata.failureReason}
                    </p>
                  </div>
                </div>
              )}

              {/* Refund Reason */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Refund Reason</label>
                <textarea
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary min-h-[80px]"
                  placeholder="Explain the reason for this refund..."
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                />
              </div>

              {/* Warning */}
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="text-sm text-amber-800">
                  <p className="font-medium">Confirm Refund</p>
                  <p className="text-xs mt-1">
                    This will credit{" "}
                    <strong>
                      {selectedTransaction &&
                        formatCurrency(
                          selectedTransaction.amount,
                          selectedTransaction.currency,
                        )}
                    </strong>{" "}
                    to the customer&apos;s balance and send them an email
                    notification. This action cannot be undone.
                  </p>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowRefundDialog(false)}
                disabled={refunding}
              >
                Cancel
              </Button>
              <Button
                onClick={handleRefundTransaction}
                disabled={refunding}
                variant="destructive"
              >
                {refunding ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  "Confirm Refund"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Manual Payment Dialog */}
        <ManualPaymentDialog
          open={showManualPaymentDialog}
          onOpenChange={setShowManualPaymentDialog}
          presetOrder={
            manualPaymentTransaction
              ? {
                  id: manualPaymentTransaction._id,
                  orderId: manualPaymentTransaction.orderId,
                  amount: manualPaymentTransaction.amount,
                  currency: manualPaymentTransaction.currency,
                  status: manualPaymentTransaction.status,
                  phoneNumber:
                    manualPaymentTransaction.recipient.phoneNumber,
                }
              : undefined
          }
          onSuccess={() => fetchTransactions()}
        />
      </div>
    </DashboardLayout>
  );
}
