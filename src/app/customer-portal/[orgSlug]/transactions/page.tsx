"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import {
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import {
  Input,
  Alert,
  AlertDescription,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@topupsend/ui";

interface Transaction {
  _id: string;
  amount: number;
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
  status: string;
  createdAt: string;
  isTestMode?: boolean;
  paymentType: string;
  orderId?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  dingTransferId?: string;
  errorMessage?: string;
  metadata?: any;
}

export default function TransactionsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const [orgSlug, setOrgSlug] = useState<string>("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [testModeFilter, setTestModeFilter] = useState<string>(""); // "", "true", or "false"
  const [currency, setCurrency] = useState("USD");
  const [selectedTransaction, setSelectedTransaction] =
    useState<Transaction | null>(null);
  const router = useRouter();
  const { t } = useTranslation();

  useEffect(() => {
    params.then((p) => setOrgSlug(p.orgSlug));
  }, [params]);

  useEffect(() => {
    if (orgSlug) {
      loadTransactions();
    }
  }, [orgSlug, page, limit, search, testModeFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1); // Reset to first page on new search
    setSearch(searchInput);
  };

  const handleClearSearch = () => {
    setSearchInput("");
    setSearch("");
    setPage(1);
  };

  const loadTransactions = async () => {
    setLoading(true);
    try {
      // Get customer data first
      const customerRes = await fetch("/api/v1/customer-auth/me", {
        credentials: "include",
      });

      if (!customerRes.ok) {
        if (customerRes.status === 401) {
          router.push(`/customer-portal/${orgSlug}/login`);
          return;
        }
        throw new Error("Authentication failed");
      }

      const customerData = await customerRes.json();
      setCurrency(customerData.customer?.balanceCurrency || "USD");

      // Get transactions
      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      });

      if (search) {
        queryParams.append("search", search);
      }

      if (testModeFilter) {
        queryParams.append("testMode", testModeFilter);
      }

      const res = await fetch(
        `/api/v1/customers/${customerData.customer._id}/transactions?${queryParams}`,
        {
          credentials: "include",
        },
      );

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(
          errorData.detail || errorData.title || "Failed to load transactions",
        );
      }

      const data = await res.json();
      setTransactions(data.transactions || []);
      setTotalPages(data.pagination?.pages || 1);
      setTotal(data.pagination?.total || 0);
    } catch (err: any) {
      setError(err.message || t("portal.transactions.loadError"));
    } finally {
      setLoading(false);
    }
  };

  if (loading && page === 1) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-4 sm:mb-0">
            {t("portal.transactions.title")}
          </h1>

          {/* Search bar */}
          <form onSubmit={handleSearch} className="flex-1 max-w-md">
            <div className="relative">
              <Input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by phone, order ID, or status..."
                className="pl-10 pr-10"
              />
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              {searchInput && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>
          </form>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Results count and filters */}
        {!loading && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-4">
            <div className="text-sm text-gray-600">
              Showing {transactions.length} of {total} transactions
              {search && ` matching "${search}"`}
              {testModeFilter &&
                ` (${testModeFilter === "true" ? "Test Mode Only" : "Live Mode Only"})`}
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <label htmlFor="testMode" className="text-sm text-gray-600">
                  Mode:
                </label>
                <select
                  id="testMode"
                  value={testModeFilter}
                  onChange={(e) => {
                    setTestModeFilter(e.target.value);
                    setPage(1);
                  }}
                  className="border border-input rounded-md px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">All Transactions</option>
                  <option value="false">Live Mode Only</option>
                  <option value="true">Test Mode Only</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="pageSize" className="text-sm text-gray-600">
                  Per page:
                </label>
                <select
                  id="pageSize"
                  value={limit}
                  onChange={(e) => {
                    setLimit(Number(e.target.value));
                    setPage(1);
                  }}
                  className="border border-input rounded-md px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="5">5</option>
                  <option value="10">10</option>
                  <option value="20">20</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {transactions.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg">
              {t("portal.transactions.noTransactions")}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t("portal.transactions.table.date")}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t("portal.transactions.table.recipient")}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t("portal.transactions.table.product")}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t("portal.transactions.table.amount")}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t("portal.transactions.table.type")}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t("portal.transactions.table.status")}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {transactions.map((tx) => (
                    <tr
                      key={tx._id}
                      onClick={() => setSelectedTransaction(tx)}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {new Date(tx.createdAt).toLocaleDateString()}{" "}
                        <span className="text-gray-500">
                          {new Date(tx.createdAt).toLocaleTimeString()}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {tx.recipient?.phoneNumber || "-"}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {tx.metadata?.productName ? (
                          <>
                            <div className="font-medium text-gray-900">
                              {tx.metadata.productName}
                            </div>
                            {tx.operator?.name &&
                              tx.operator.name !== "unknown" && (
                                <div className="text-xs text-gray-400">
                                  {tx.operator.name}
                                  {tx.operator.country &&
                                    tx.operator.country !== "unknown" &&
                                    ` - ${tx.operator.country}`}
                                </div>
                              )}
                          </>
                        ) : tx.operator?.name &&
                          tx.operator.name !== "unknown" ? (
                          <>
                            <div className="font-medium text-gray-900">
                              {tx.operator.name}
                            </div>
                            {tx.operator.country &&
                              tx.operator.country !== "unknown" && (
                                <div className="text-xs text-gray-400">
                                  {tx.operator.country}
                                </div>
                              )}
                          </>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                        {currency} {tx.amount.toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {tx.paymentType === "balance" ? (
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-primary/10 text-primary">
                            Balance
                          </span>
                        ) : (
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                            Gateway
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                              tx.status === "completed"
                                ? "bg-green-100 text-green-800"
                                : tx.status === "pending"
                                  ? "bg-yellow-100 text-yellow-800"
                                  : "bg-red-100 text-red-800"
                            }`}
                          >
                            {tx.status.charAt(0).toUpperCase() +
                              tx.status.slice(1)}
                          </span>
                          {tx.isTestMode && (
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-orange-100 text-orange-800">
                              TEST
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex flex-col sm:flex-row items-center justify-between mt-6 pt-4 border-t gap-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(1)}
                  disabled={page === 1 || loading}
                  className="p-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="First page"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1 || loading}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  <ChevronLeft className="h-4 w-4" />
                  {t("portal.transactions.previous")}
                </button>
              </div>

              <span className="text-sm text-gray-700">
                {t("portal.transactions.page")} {page} of {totalPages}
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || loading}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  {t("portal.transactions.next")}
                  <ChevronRight className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setPage(totalPages)}
                  disabled={page >= totalPages || loading}
                  className="p-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Last page"
                >
                  <ChevronsRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Transaction Detail Modal */}
      <Dialog
        open={!!selectedTransaction}
        onOpenChange={() => setSelectedTransaction(null)}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedTransaction && (
            <>
              <DialogHeader>
                <DialogTitle>Transaction Details</DialogTitle>
              </DialogHeader>

              <div className="space-y-6 mt-4">
                {/* Status Badge */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">
                    Status
                  </span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-3 py-1 inline-flex text-sm leading-5 font-semibold rounded-full ${
                        selectedTransaction.status === "completed"
                          ? "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400"
                          : selectedTransaction.status === "pending"
                            ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400"
                            : "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400"
                      }`}
                    >
                      {selectedTransaction.status}
                    </span>
                    {selectedTransaction.isTestMode && (
                      <span className="px-3 py-1 inline-flex text-sm leading-5 font-semibold rounded-full bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400">
                        TEST MODE
                      </span>
                    )}
                  </div>
                </div>

                {/* Transaction Information */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      Order ID
                    </p>
                    <p className="text-sm text-foreground font-mono">
                      {selectedTransaction.orderId || selectedTransaction._id}
                    </p>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      Date & Time
                    </p>
                    <p className="text-sm text-foreground">
                      {new Date(
                        selectedTransaction.createdAt,
                      ).toLocaleDateString()}{" "}
                      {new Date(
                        selectedTransaction.createdAt,
                      ).toLocaleTimeString()}
                    </p>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      Recipient Phone
                    </p>
                    <p className="text-sm text-foreground font-semibold">
                      {selectedTransaction.recipient?.phoneNumber || "-"}
                    </p>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      Amount
                    </p>
                    <p className="text-lg font-bold text-foreground">
                      {currency} {selectedTransaction.amount.toFixed(2)}
                    </p>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      Payment Type
                    </p>
                    <span
                      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        selectedTransaction.paymentType === "balance"
                          ? "bg-primary/10 text-primary"
                          : "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400"
                      }`}
                    >
                      {selectedTransaction.paymentType === "balance"
                        ? "Balance"
                        : "Gateway"}
                    </span>
                  </div>

                  {selectedTransaction.paymentMethod && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-1">
                        Payment Method
                      </p>
                      <p className="text-sm text-foreground capitalize">
                        {selectedTransaction.paymentMethod}
                      </p>
                    </div>
                  )}
                </div>

                {/* Product Information */}
                {selectedTransaction.metadata?.productName && (
                  <div className="border-t pt-4">
                    <h3 className="text-lg font-semibold text-foreground mb-3">
                      Product Details
                    </h3>
                    <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm font-medium text-muted-foreground">
                          Product Name
                        </span>
                        <span className="text-sm text-foreground">
                          {selectedTransaction.metadata.productName}
                        </span>
                      </div>
                      {selectedTransaction.operator?.country &&
                        selectedTransaction.operator.country !== "unknown" && (
                          <div className="flex justify-between">
                            <span className="text-sm font-medium text-muted-foreground">
                              Country
                            </span>
                            <span className="text-sm text-foreground">
                              {selectedTransaction.operator.country}
                            </span>
                          </div>
                        )}
                      {selectedTransaction.operator?.name &&
                        selectedTransaction.operator.name !== "unknown" && (
                          <div className="flex justify-between">
                            <span className="text-sm font-medium text-muted-foreground">
                              Operator
                            </span>
                            <span className="text-sm text-foreground">
                              {selectedTransaction.operator.name}
                            </span>
                          </div>
                        )}
                      {selectedTransaction.metadata.benefitAmount > 0 && (
                        <div className="flex justify-between">
                          <span className="text-sm font-medium text-muted-foreground">
                            Benefit
                          </span>
                          <span className="text-sm text-foreground">
                            {selectedTransaction.metadata.benefitAmount}{" "}
                            {selectedTransaction.metadata.benefitUnit ||
                              "units"}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* DingConnect Transfer ID */}
                {(selectedTransaction.metadata?.dingTransferId ||
                  selectedTransaction.dingTransferId) && (
                  <div className="border-t pt-4">
                    <h3 className="text-lg font-semibold text-foreground mb-3">
                      Provider Details
                    </h3>
                    <div className="bg-muted/50 rounded-lg p-4">
                      <div className="flex justify-between">
                        <span className="text-sm font-medium text-muted-foreground">
                          Transfer ID
                        </span>
                        <span className="text-sm text-foreground font-mono">
                          {selectedTransaction.metadata?.dingTransferId ||
                            selectedTransaction.dingTransferId}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Error Message */}
                {selectedTransaction.errorMessage && (
                  <div className="border-t pt-4">
                    <h3 className="text-lg font-semibold text-destructive mb-3">
                      Error Details
                    </h3>
                    <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                      <p className="text-sm text-destructive">
                        {selectedTransaction.errorMessage}
                      </p>
                    </div>
                  </div>
                )}

                {/* Additional Metadata */}
                {selectedTransaction.metadata &&
                  Object.keys(selectedTransaction.metadata).length > 0 && (
                    <div className="border-t pt-4">
                      <h3 className="text-lg font-semibold text-foreground mb-3">
                        Additional Information
                      </h3>
                      <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                        {Object.entries(selectedTransaction.metadata).map(
                          ([key, value]) => (
                            <div key={key} className="flex justify-between">
                              <span className="text-sm font-medium text-muted-foreground capitalize">
                                {key.replace(/([A-Z])/g, " $1").trim()}
                              </span>
                              <span className="text-sm text-foreground">
                                {typeof value === "object"
                                  ? JSON.stringify(value)
                                  : String(value)}
                              </span>
                            </div>
                          ),
                        )}
                      </div>
                    </div>
                  )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
