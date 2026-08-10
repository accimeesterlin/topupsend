"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CreditCard,
  TrendingUp,
  Clock,
  AlertCircle,
  CheckCircle2,
  Receipt,
} from "lucide-react";
import Link from "next/link";
import { getTierInfo, getNextTier, SubscriptionTier } from "@/lib/pricing";
import { DashboardLayout } from "@/components/dashboard-layout";
import { toast } from "@topupsend/ui";
import type { SubscriptionData } from "@/types/subscription";
import { SubscriptionUpgradePreview } from "@/components/SubscriptionUpgradePreview";

interface BillingHistoryEntry {
  orderId: string;
  tier: string;
  tierName: string;
  amount: number;
  months: number;
  status: "completed" | "failed" | "pending";
  paidAt: string;
  description: string;
}

export default function BillingPage() {
  const [subscription, setSubscription] = useState<SubscriptionData | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [selectedMonths, setSelectedMonths] = useState(1);
  const [billingHistory, setBillingHistory] = useState<BillingHistoryEntry[]>(
    [],
  );
  const [historyLoading, setHistoryLoading] = useState(true);

  useEffect(() => {
    fetchSubscription();
    fetchBillingHistory();
  }, []);

  const fetchSubscription = async () => {
    try {
      const response = await fetch(`/api/v1/subscriptions/current?t=${Date.now()}`, {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
        },
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("API Error:", errorData);
        throw new Error(
          errorData.error ||
            `HTTP ${response.status}: Failed to fetch subscription`,
        );
      }
      const data = await response.json();
      console.log("Subscription data:", data);

      // The API returns data directly, not wrapped in { data: ... }
      setSubscription(data);
    } catch (err) {
      console.error("Fetch error:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load subscription",
      );
    } finally {
      setLoading(false);
    }
  };

  const fetchBillingHistory = async () => {
    try {
      const response = await fetch(`/api/v1/subscriptions/billing-history?t=${Date.now()}`, {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
        },
      });
      if (response.ok) {
        const data = await response.json();
        setBillingHistory(data.history || []);
      }
    } catch (err) {
      console.error("Failed to fetch billing history:", err);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleUpgrade = async (tier: SubscriptionTier) => {
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

      // Redirect to PGPay checkout
      window.location.href = data.redirectUrl;
      // Don't reset upgrading state here — the page is navigating away.
      // The button stays in loading state until the redirect completes.
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

  if (loading) {
    return (
      <DashboardLayout>
        <LoadingSkeleton />
      </DashboardLayout>
    );
  }

  if (error || !subscription) {
    return (
      <DashboardLayout>
        <div className="p-8">
          <Card className="border-destructive">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-5 w-5" />
                <p>{error || "Failed to load billing information"}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const tierInfo = getTierInfo(subscription.tier);
  const nextTier = getNextTier(subscription.tier);
  const daysUntilRenewal = Math.ceil(
    (new Date(subscription.currentPeriodEnd).getTime() - Date.now()) /
      (1000 * 60 * 60 * 24),
  );
  const isExpired = daysUntilRenewal <= 0;

  return (
    <DashboardLayout>
      <div className="space-y-8 p-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold mb-2">Billing & Subscription</h1>
          <p className="text-muted-foreground">
            Manage your subscription and view your usage
          </p>
        </div>

        {/* Current Plan Card */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {tierInfo.name} Plan
                  <Badge
                    variant={
                      isExpired
                        ? "destructive"
                        : subscription.status === "active"
                          ? "default"
                          : "secondary"
                    }
                  >
                    {isExpired ? "expired" : subscription.status}
                  </Badge>
                </CardTitle>
                <CardDescription>{tierInfo.description}</CardDescription>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold">
                  ${subscription.monthlyFee}
                </div>
                <div className="text-sm text-muted-foreground">per month</div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  {isExpired ? (
                    <>
                      <AlertCircle className="h-4 w-4 text-destructive" />
                      <span className="text-destructive font-medium">
                        Expired {Math.abs(daysUntilRenewal)} days ago
                      </span>
                    </>
                  ) : (
                    <>
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span>
                        {daysUntilRenewal > 0
                          ? `Renews in ${daysUntilRenewal} days`
                          : "Renews today"}
                      </span>
                    </>
                  )}
                </div>
                <div className="text-sm text-muted-foreground">
                  Transaction Fee: {subscription.transactionFeePercentage}%
                </div>
              </div>

              {isExpired && (
                <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <h4 className="font-semibold text-destructive mb-1">
                        Subscription Expired
                      </h4>
                      <p className="text-sm text-destructive/90 mb-3">
                        Your subscription expired on{" "}
                        {new Date(subscription.currentPeriodEnd).toLocaleDateString(
                          "en-US",
                          {
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                          },
                        )}
                        . Please renew to continue using premium features.
                      </p>
                      <Button
                        onClick={() => handleUpgrade(subscription.tier)}
                        disabled={upgrading}
                        className="bg-destructive hover:bg-destructive/90"
                      >
                        {upgrading ? "Processing..." : "Renew Subscription"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {nextTier && !isExpired && (
                <SubscriptionUpgradePreview
                  subscription={subscription}
                  nextTier={nextTier}
                  selectedMonths={selectedMonths}
                  onSelectedMonthsChange={setSelectedMonths}
                  upgrading={upgrading}
                  onUpgrade={handleUpgrade}
                />
              )}

              <div className="flex gap-2 pt-2">
                <Button variant="outline" asChild>
                  <Link href="/pricing">View All Plans</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Usage Statistics */}
        <div className="grid md:grid-cols-3 gap-6">
          <UsageCard
            title="Transactions"
            current={subscription.usage.transactions}
            limit={subscription.usage.transactionLimit}
            icon={TrendingUp}
          />
          <UsageCard
            title="Team Members"
            current={subscription.usage.teamMembers}
            limit={subscription.usage.teamMemberLimit}
            icon={CheckCircle2}
          />
          <UsageCard
            title="Organizations"
            current={subscription.usage.organizations}
            limit={subscription.usage.organizationLimit}
            icon={CreditCard}
          />
        </div>

        {/* Features Included */}
        <Card>
          <CardHeader>
            <CardTitle>Features Included</CardTitle>
            <CardDescription>
              What you get with your current plan
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-4">
              {tierInfo.highlights.map((feature, index) => (
                <div key={index} className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                  <span>{feature}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Payment Method */}
        <Card>
          <CardHeader>
            <CardTitle>Payment Method</CardTitle>
            <CardDescription>
              Powered by PGPay - Secure payment processing
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <CreditCard className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">PGPay</p>
                  <p className="text-sm text-muted-foreground">
                    Pay with your PGeCom account
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="bg-green-50 text-green-700 border-green-200"
                >
                  Active
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                All payments are processed securely through PGPay using your
                PGeCom account balance. No card or bank transfer required.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Billing History */}
        <Card>
          <CardHeader>
            <CardTitle>Billing History</CardTitle>
            <CardDescription>Your past invoices and payments</CardDescription>
          </CardHeader>
          <CardContent>
            {historyLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : billingHistory.length === 0 ? (
              <div className="text-center py-10">
                <Receipt className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
                <p className="text-muted-foreground font-medium">
                  No billing history yet
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Your payment records will appear here after your first
                  upgrade.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {billingHistory.map((entry) => (
                  <BillingHistoryRow
                    key={entry.orderId}
                    date={new Date(entry.paidAt).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                    description={entry.description}
                    amount={entry.amount}
                    status={
                      entry.status === "completed"
                        ? "paid"
                        : entry.status === "pending"
                          ? "pending"
                          : "failed"
                    }
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function UsageCard({
  title,
  current,
  limit,
  icon: Icon,
}: {
  title: string;
  current: number;
  limit: number | "unlimited";
  icon: React.ElementType;
}) {
  const isUnlimited = limit === "unlimited";
  const percentage = isUnlimited ? 0 : Math.min((current / limit) * 100, 100);
  const isApproachingLimit = percentage >= 80;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex items-baseline gap-2">
            <div className="text-2xl font-bold">{current}</div>
            <div className="text-sm text-muted-foreground">
              / {isUnlimited ? "∞" : limit}
            </div>
          </div>
          {!isUnlimited && (
            <>
              <Progress value={percentage} className="h-2" />
              {isApproachingLimit && (
                <p className="text-xs text-orange-500 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Approaching limit
                </p>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function BillingHistoryRow({
  date,
  description,
  amount,
  status,
}: {
  date: string;
  description: string;
  amount: number;
  status: "paid" | "pending" | "failed";
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <div>
        <p className="font-medium">{date}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-4">
        <span className="font-semibold">${amount}</span>
        <Badge
          variant={
            status === "paid"
              ? "default"
              : status === "pending"
                ? "secondary"
                : "destructive"
          }
        >
          {status}
        </Badge>
        <Button variant="ghost" size="sm">
          Download
        </Button>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-8 p-8">
      <div>
        <Skeleton className="h-10 w-64 mb-2" />
        <Skeleton className="h-4 w-96" />
      </div>
      <Skeleton className="h-48 w-full" />
      <div className="grid md:grid-cols-3 gap-6">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
