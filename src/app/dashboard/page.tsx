"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DollarSign,
  ShoppingCart,
  Users,
  CheckCircle,
  ArrowUpRight,
  TrendingUp,
  Store,
  Copy,
  ExternalLink,
  Globe,
  Tag,
  X,
  Clock,
  XCircle,
  ArrowRight,
  Wallet,
  RefreshCw,
  Zap,
  Crown,
} from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Dialog,
  DialogContent,
  toast,
} from "@topupsend/ui";
import { DashboardLayout } from "@/components/dashboard-layout";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { getNextTier } from "@/lib/pricing";
import type { SubscriptionData } from "@/types/subscription";
import { SubscriptionUpgradePreview } from "@/components/SubscriptionUpgradePreview";

interface Metrics {
  revenue: {
    total: number;
    trend: number;
  };
  transactions: {
    total: number;
    completed: number;
    trend: number;
  };
  customers: {
    total: number;
    newCustomers: number;
    trend: number;
  };
  successRate: {
    rate: number;
    trend: number;
  };
  averageTransactionValue: number;
}

interface RecentTransaction {
  _id: string;
  orderId: string;
  status: string;
  amount: number;
  currency: string;
  recipient: {
    phoneNumber: string;
    email?: string;
  };
  createdAt: string;
  metadata?: {
    productName?: string;
  };
}

interface ProviderBalance {
  provider: string | null;
  balance: number | null;
  currency: string | null;
  environment?: string;
  lastSync?: string;
  error?: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [metrics, setMetrics] = useState<Metrics>({
    revenue: { total: 0, trend: 0 },
    transactions: { total: 0, completed: 0, trend: 0 },
    customers: { total: 0, newCustomers: 0, trend: 0 },
    successRate: { rate: 0, trend: 0 },
    averageTransactionValue: 0,
  });
  const [recentTransactions, setRecentTransactions] = useState<
    RecentTransaction[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [orgSlug, setOrgSlug] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [showStorefrontModal, setShowStorefrontModal] = useState(false);
  const [subscriptionTier, setSubscriptionTier] = useState<string>("starter");
  const [transactionCount, setTransactionCount] = useState<number>(0);
  const [transactionLimit, setTransactionLimit] = useState<number>(200);
  const [daysRemaining, setDaysRemaining] = useState<number | null>(null);
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);
  const [providerBalance, setProviderBalance] =
    useState<ProviderBalance | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionData | null>(
    null,
  );
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [selectedMonths, setSelectedMonths] = useState(1);
  const [upgrading, setUpgrading] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const response = await fetch("/api/v1/auth/me");

      if (!response.ok) {
        if (response.status === 401) {
          router.push("/login");
          return;
        }
      }

      // Fetch organization slug
      const orgResponse = await fetch("/api/v1/organization");
      if (orgResponse.ok) {
        const orgData = await orgResponse.json();
        setOrgSlug(orgData.slug);
      }

      // Fetch dashboard metrics (all-time data)
      await fetchMetrics();
      await fetchRecentTransactions();
      await fetchBalance();
      await fetchSubscriptionInfo();
    } catch (err) {
      console.error("Auth check error:", err);
      router.push("/login");
    } finally {
      setLoading(false);
    }
  };

  const fetchSubscriptionInfo = async () => {
    try {
      // Add timestamp to force fresh data and prevent caching
      const timestamp = Date.now();
      const response = await fetch(`/api/v1/subscriptions/current?t=${timestamp}`, {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
        },
      });
      if (response.ok) {
        const data = await response.json();
        setSubscription(data);
        setSubscriptionTier(
          data.tier || data.organization?.subscriptionTier || "starter",
        );
        if (data.currentPeriodEnd) {
          setPeriodEnd(data.currentPeriodEnd);
        }
      }

      // Fetch usage
      const usageResponse = await fetch(`/api/v1/subscriptions/usage?t=${timestamp}`, {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
        },
      });
      if (usageResponse.ok) {
        const usageData = await usageResponse.json();
        setTransactionCount(usageData.transactions?.current || 0);
        setTransactionLimit(usageData.transactions?.limit || 200);
        if (usageData.period?.daysRemaining != null) {
          setDaysRemaining(usageData.period.daysRemaining);
        }
      }
    } catch (error) {
      console.error("Failed to fetch subscription info:", error);
    }
  };

  const fetchMetrics = async () => {
    try {
      // Fetch all-time metrics
      const response = await fetch("/api/v1/dashboard/metrics?period=all");
      if (response.ok) {
        const data = await response.json();
        setMetrics(data);
      }
    } catch (error) {
      console.error("Failed to fetch metrics:", error);
    }
  };

  const fetchRecentTransactions = async () => {
    try {
      // Fetch latest 5 transactions
      const response = await fetch("/api/v1/transactions?page=1&limit=5");
      if (response.ok) {
        const data = await response.json();
        setRecentTransactions(data.transactions || []);
      }
    } catch (error) {
      console.error("Failed to fetch recent transactions:", error);
    }
  };

  const fetchBalance = async () => {
    setLoadingBalance(true);
    try {
      const response = await fetch("/api/v1/dashboard/balance");
      if (response.ok) {
        const data = await response.json();
        setProviderBalance(data);
      } else {
        const errorData = await response.json();
        console.error("Balance API error:", errorData);
        setProviderBalance({
          provider: null,
          balance: null,
          currency: null,
        });
      }
    } catch (error) {
      console.error("Failed to fetch provider balance:", error);
      setProviderBalance({
        provider: null,
        balance: null,
        currency: null,
      });
    } finally {
      setLoadingBalance(false);
    }
  };

  const storefrontUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/store/${orgSlug}`
      : "";

  const copyToClipboard = () => {
    navigator.clipboard.writeText(storefrontUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading dashboard...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  const handleUpgrade = async (tier: any) => {
    if (!tier) return;
    try {
      setUpgrading(true);
      const response = await fetch("/api/v1/subscriptions/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, months: selectedMonths }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Failed to create upgrade payment");
      }

      const data = await response.json();
      window.location.href = data.redirectUrl;
    } catch (err) {
      console.error("Upgrade error:", err);
      toast({
        title: "Upgrade Failed",
        description:
          err instanceof Error
            ? err.message
            : "Failed to upgrade. Please try again.",
        variant: "error",
      });
      setUpgrading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground mt-1">
              Welcome back! Manage your storefront and track your business.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => router.push("/dashboard/storefront")}>
              <Store className="h-4 w-4 mr-2" />
              Storefront Settings
            </Button>
          </div>
        </div>

        {/* Storefront URL Card */}
        <Card className="border-border shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Store className="h-5 w-5" />
              Your Storefront
            </CardTitle>
            <CardDescription>
              Share this link with customers to let them purchase top-ups
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex-1 p-3 bg-muted rounded-lg font-mono text-sm break-all">
                {storefrontUrl || "Loading..."}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={copyToClipboard}
                disabled={!storefrontUrl}
              >
                {copied ? (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(storefrontUrl, "_blank")}
                disabled={!storefrontUrl}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Visit
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Subscription Plan Card */}
        {(() => {
          const tiers: Record<
            string,
            {
              icon: React.ReactNode;
              price: string;
              badge: string;
              benefits: string[];
            }
          > = {
            starter: {
              icon: <Zap className="h-4 w-4 text-blue-600" />,
              price: "Free",
              badge: "bg-blue-100 text-blue-700",
              benefits: ["1 Org", "4% Fee", "Basic Support", "Global Top-ups"],
            },
            growth: {
              icon: <TrendingUp className="h-4 w-4 text-green-600" />,
              price: "$149/mo",
              badge: "bg-green-100 text-green-700",
              benefits: ["3 Orgs", "2% Fee", "API Access", "Webhooks"],
            },
            scale: {
              icon: <Crown className="h-4 w-4 text-purple-600" />,
              price: "$499/mo",
              badge: "bg-purple-100 text-purple-700",
              benefits: [
                "Unlimited Orgs",
                "1% Fee",
                "White Label",
                "Priority Processing",
              ],
            },
            enterprise: {
              icon: <Crown className="h-4 w-4 text-amber-600" />,
              price: "Custom",
              badge: "bg-amber-100 text-amber-700",
              benefits: [
                "Unlimited Orgs",
                "0.5% Fee",
                "Dedicated Support",
                "Priority Processing",
              ],
            },
          };
          const tier = tiers[subscriptionTier] || tiers.starter;
          const usagePercent =
            transactionLimit === 999999
              ? 0
              : (transactionCount / transactionLimit) * 100;
          const showUpgrade = subscriptionTier !== "enterprise";

          return (
            <Card className="border-border shadow-md">
              <CardContent className="pt-5 pb-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  {/* Left: tier name + usage */}
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      {tier.icon}
                      <p className="text-lg font-bold capitalize">
                        {subscriptionTier}
                      </p>
                      <span
                        className={`px-2 py-0.5 text-xs rounded-full font-medium ${tier.badge}`}
                      >
                        {tier.price}
                      </span>
                    </div>
                  </div>

                  {/* Right: buttons */}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => router.push("/dashboard/billing")}
                    >
                      Billing
                    </Button>
                    {showUpgrade && (
                      <Button
                        size="sm"
                        onClick={() => setShowUpgradeModal(true)}
                        className={
                          subscriptionTier === "starter"
                            ? "bg-gradient-to-r from-blue-600 to-purple-600"
                            : ""
                        }
                        variant={
                          subscriptionTier === "starter"
                            ? "default"
                            : "secondary"
                        }
                      >
                        <Crown className="h-3.5 w-3.5 mr-1.5" />
                        Upgrade
                      </Button>
                    )}
                  </div>
                </div>

                {/* Usage bar + benefits row */}
                <div className="mt-4 space-y-3">
                  {/* Transaction usage */}
                  <div className="flex items-center gap-3">
                    <div className="flex-1 flex items-center gap-2">
                      <div className="flex-1 bg-muted rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full transition-all ${
                            usagePercent > 80
                              ? "bg-red-500"
                              : usagePercent > 60
                                ? "bg-amber-500"
                                : "bg-green-500"
                          }`}
                          style={{ width: `${Math.min(usagePercent, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {transactionCount} /{" "}
                        {transactionLimit === 999999 ? "∞" : transactionLimit}{" "}
                        txns
                      </span>
                    </div>
                    {usagePercent > 80 && transactionLimit !== 999999 && (
                      <span className="text-xs text-amber-600 font-medium whitespace-nowrap">
                        Approaching limit
                      </span>
                    )}
                  </div>

                  {/* Period info: days remaining + renewal date */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {daysRemaining != null && (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {daysRemaining} {daysRemaining === 1 ? "day" : "days"} remaining in cycle
                      </span>
                    )}
                    {periodEnd && (
                      <span className="inline-flex items-center gap-1">
                        Renews {new Date(periodEnd).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    )}
                  </div>

                  {/* Benefits as inline pills */}
                  <div className="flex flex-wrap gap-1.5">
                    {tier.benefits.map((b) => (
                      <span
                        key={b}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full"
                      >
                        <CheckCircle className="h-3 w-3 text-green-600" />
                        {b}
                      </span>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Revenue Card */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <div className="h-12 w-12 rounded-lg bg-green-100 flex items-center justify-center">
                  <DollarSign className="h-6 w-6 text-green-600" />
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground font-medium">
                  Total Revenue
                </p>
                <p className="text-3xl font-bold">
                  {formatCurrency(metrics.revenue.total)}
                </p>
                <p className="text-xs text-muted-foreground">All time</p>
              </div>
            </CardContent>
          </Card>

          {/* Transactions Card */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <div className="h-12 w-12 rounded-lg bg-blue-100 flex items-center justify-center">
                  <ShoppingCart className="h-6 w-6 text-blue-600" />
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground font-medium">
                  Transactions
                </p>
                <p className="text-3xl font-bold">
                  {metrics.transactions.total}
                </p>
                <p className="text-xs text-muted-foreground">All time</p>
              </div>
            </CardContent>
          </Card>

          {/* Customers Card */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <div className="h-12 w-12 rounded-lg bg-purple-100 flex items-center justify-center">
                  <Users className="h-6 w-6 text-purple-600" />
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground font-medium">
                  Customers
                </p>
                <p className="text-3xl font-bold">{metrics.customers.total}</p>
                <p className="text-xs text-muted-foreground">
                  Total registered
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Success Rate Card */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <div className="h-12 w-12 rounded-lg bg-emerald-100 flex items-center justify-center">
                  <CheckCircle className="h-6 w-6 text-emerald-600" />
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground font-medium">
                  Success Rate
                </p>
                <p className="text-3xl font-bold">
                  {metrics.successRate.rate}%
                </p>
                <p className="text-xs text-muted-foreground">
                  Transaction success
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Provider Balance Card */}
        {providerBalance && providerBalance.provider && (
          <Card className="border-border shadow-md">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wallet className="h-5 w-5" />
                  <CardTitle>Provider Balance</CardTitle>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={fetchBalance}
                  disabled={loadingBalance}
                >
                  <RefreshCw
                    className={`h-4 w-4 ${loadingBalance ? "animate-spin" : ""}`}
                  />
                </Button>
              </div>
              <CardDescription>
                {providerBalance.provider === "dingconnect"
                  ? "DingConnect"
                  : "Reloadly"}{" "}
                account balance
                {providerBalance.environment &&
                  ` (${providerBalance.environment})`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {providerBalance.balance !== null ? (
                  <div className="flex items-baseline gap-2">
                    <p className="text-4xl font-bold">
                      {new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency: providerBalance.currency || "USD",
                      }).format(providerBalance.balance)}
                    </p>
                    <span className="text-sm text-muted-foreground">
                      {providerBalance.currency || "USD"}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <XCircle className="h-4 w-4" />
                    <p className="text-sm">Balance unavailable</p>
                  </div>
                )}

                {providerBalance.lastSync && (
                  <p className="text-xs text-muted-foreground">
                    Last updated:{" "}
                    {new Date(providerBalance.lastSync).toLocaleString()}
                  </p>
                )}

                {providerBalance.error && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="flex items-start gap-2">
                      <XCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-amber-900">
                          {providerBalance.error}
                        </p>
                        {providerBalance.balance !== null && (
                          <p className="text-xs text-amber-700 mt-1">
                            Showing last cached balance from{" "}
                            {providerBalance.lastSync
                              ? new Date(
                                  providerBalance.lastSync,
                                ).toLocaleString()
                              : "previous sync"}
                          </p>
                        )}
                        {providerBalance.error.includes("credentials") && (
                          <button
                            onClick={() =>
                              router.push("/dashboard/integrations")
                            }
                            className="text-xs text-amber-700 underline mt-2 hover:text-amber-900"
                          >
                            Update integration settings →
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Getting Started Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>
                Get started with your storefront
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                variant="outline"
                className="w-full justify-start"
                size="lg"
                onClick={() => router.push("/dashboard/storefront")}
              >
                <Store className="h-5 w-5 mr-3" />
                <div className="text-left flex-1">
                  <div className="font-medium">Configure Storefront</div>
                  <div className="text-xs text-muted-foreground">
                    Set up branding and pricing
                  </div>
                </div>
                <ArrowUpRight className="h-4 w-4 ml-2" />
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start"
                size="lg"
                onClick={() => router.push("/dashboard/countries")}
              >
                <Globe className="h-5 w-5 mr-3" />
                <div className="text-left flex-1">
                  <div className="font-medium">Select Countries</div>
                  <div className="text-xs text-muted-foreground">
                    Choose countries to serve
                  </div>
                </div>
                <ArrowUpRight className="h-4 w-4 ml-2" />
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start"
                size="lg"
                onClick={() => router.push("/dashboard/discounts")}
              >
                <Tag className="h-5 w-5 mr-3" />
                <div className="text-left flex-1">
                  <div className="font-medium">Create Discounts</div>
                  <div className="text-xs text-muted-foreground">
                    Set up promotional offers
                  </div>
                </div>
                <ArrowUpRight className="h-4 w-4 ml-2" />
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start"
                size="lg"
                onClick={() => router.push("/dashboard/integrations")}
              >
                <TrendingUp className="h-5 w-5 mr-3" />
                <div className="text-left flex-1">
                  <div className="font-medium">Connect DingConnect</div>
                  <div className="text-xs text-muted-foreground">
                    Integrate with telecom API
                  </div>
                </div>
                <ArrowUpRight className="h-4 w-4 ml-2" />
              </Button>
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>
                Your latest transactions and updates
              </CardDescription>
            </CardHeader>
            <CardContent>
              {recentTransactions.length === 0 ? (
                <div className="text-center py-12">
                  <ShoppingCart className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                  <p className="text-muted-foreground font-medium">
                    No activity yet
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Your recent transactions will appear here
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {recentTransactions.map((transaction) => (
                    <div
                      key={transaction._id}
                      className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start gap-3 flex-1">
                        <div className="mt-0.5">
                          {transaction.status === "completed" ? (
                            <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center">
                              <CheckCircle className="h-4 w-4 text-green-600" />
                            </div>
                          ) : transaction.status === "processing" ||
                            transaction.status === "paid" ? (
                            <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                              <Clock className="h-4 w-4 text-blue-600" />
                            </div>
                          ) : (
                            <div className="h-8 w-8 rounded-full bg-red-100 flex items-center justify-center">
                              <XCircle className="h-4 w-4 text-red-600" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-medium text-sm truncate">
                              {transaction.metadata?.productName || "Top-up"}
                            </p>
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full capitalize ${
                                transaction.status === "completed"
                                  ? "bg-green-100 text-green-700"
                                  : transaction.status === "processing" ||
                                      transaction.status === "paid"
                                    ? "bg-blue-100 text-blue-700"
                                    : transaction.status === "failed"
                                      ? "bg-red-100 text-red-700"
                                      : "bg-gray-100 text-gray-700"
                              }`}
                            >
                              {transaction.status}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs text-muted-foreground">
                              {transaction.recipient.phoneNumber}
                            </p>
                            <WhatsAppButton phoneNumber={transaction.recipient.phoneNumber} size="sm" />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {new Date(transaction.createdAt).toLocaleString(
                              "en-US",
                              {
                                month: "short",
                                day: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                              },
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="text-right ml-4">
                        <p className="font-semibold text-sm">
                          {formatCurrency(transaction.amount)}
                        </p>
                      </div>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    className="w-full mt-2"
                    onClick={() => router.push("/dashboard/transactions")}
                  >
                    View All Transactions
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader>
              <Store className="h-10 w-10 text-primary mb-2" />
              <CardTitle>Storefront</CardTitle>
              <CardDescription>
                Customize your public storefront and pricing
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="link"
                className="p-0"
                onClick={() => router.push("/dashboard/storefront")}
              >
                Manage Storefront <ArrowUpRight className="h-4 w-4 ml-1" />
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Users className="h-10 w-10 text-primary mb-2" />
              <CardTitle>Customer Management</CardTitle>
              <CardDescription>
                Track and manage your customer relationships
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="link"
                className="p-0"
                onClick={() => router.push("/dashboard/customers")}
              >
                View Customers <ArrowUpRight className="h-4 w-4 ml-1" />
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <TrendingUp className="h-10 w-10 text-primary mb-2" />
              <CardTitle>Analytics & Reports</CardTitle>
              <CardDescription>
                Gain insights into your sales performance
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="link"
                className="p-0"
                onClick={() => router.push("/dashboard/analytics")}
              >
                View Analytics <ArrowUpRight className="h-4 w-4 ml-1" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Storefront Modal */}
      <Dialog open={showStorefrontModal} onOpenChange={setShowStorefrontModal}>
        <DialogContent className="max-w-[95vw] w-full h-[95vh] p-0 gap-0">
          <div className="flex items-center justify-between p-4 border-b bg-muted/30">
            <div>
              <h2 className="text-lg font-semibold">Storefront Preview</h2>
              <p className="text-sm text-muted-foreground">
                Test transactions as a team member
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowStorefrontModal(false)}
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-auto">
            {orgSlug && (
              <iframe
                src={`/store/${orgSlug}?teamMember=true`}
                className="w-full h-full border-0"
                title="Storefront Preview"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Upgrade Modal */}
      <Dialog open={showUpgradeModal} onOpenChange={setShowUpgradeModal}>
        <DialogContent className="w-full max-w-2xl sm:max-w-3xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Upgrade your plan</h2>
              <p className="text-sm text-muted-foreground">
                Choose a prepaid period and see what you unlock.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowUpgradeModal(false)}
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {subscription ? (
            (() => {
              const nextTier = getNextTier(subscription.tier);
              if (!nextTier) {
                return (
                  <p className="text-sm text-muted-foreground">
                    You are already on the highest available plan.
                  </p>
                );
              }

              return (
                <SubscriptionUpgradePreview
                  subscription={subscription}
                  nextTier={nextTier}
                  selectedMonths={selectedMonths}
                  onSelectedMonthsChange={setSelectedMonths}
                  upgrading={upgrading}
                  onUpgrade={handleUpgrade}
                />
              );
            })()
          ) : (
            <p className="text-sm text-muted-foreground">
              Loading subscription details...
            </p>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
