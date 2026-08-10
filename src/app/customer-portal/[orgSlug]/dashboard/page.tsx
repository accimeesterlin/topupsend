"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Alert,
  AlertDescription,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Badge,
} from "@topupsend/ui";
import { Loader2, Wallet, Send, History, AlertCircle } from "lucide-react";

interface CustomerData {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  currentBalance: number;
  balanceCurrency: string;
  emailVerified: boolean;
}

interface Transaction {
  _id: string;
  amount: number;
  recipientPhone: string;
  status: string;
  createdAt: string;
  product?: {
    name: string;
  };
}

export default function CustomerDashboardPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const [orgSlug, setOrgSlug] = useState<string>("");
  const [customer, setCustomer] = useState<CustomerData | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const router = useRouter();
  const { t } = useTranslation();

  useEffect(() => {
    params.then((p) => setOrgSlug(p.orgSlug));
  }, [params]);

  useEffect(() => {
    if (orgSlug) {
      loadDashboardData();
    }
  }, [orgSlug]);

  const loadDashboardData = async () => {
    try {
      // Get customer data
      const customerRes = await fetch("/api/v1/customer-auth/me", {
        credentials: "include",
      });

      if (!customerRes.ok) {
        if (customerRes.status === 401) {
          router.push(`/customer-portal/${orgSlug}/login`);
          return;
        }
        throw new Error("Failed to load customer data");
      }

      const customerData = await customerRes.json();
      setCustomer(customerData.customer);

      // Get recent transactions
      const txRes = await fetch(
        `/api/v1/customers/${customerData.customer._id}/transactions?limit=5`,
        {
          credentials: "include",
        },
      );

      if (txRes.ok) {
        const txData = await txRes.json();
        setTransactions(txData.data || []);
      }
    } catch (err: any) {
      setError(err.message || t("portal.dashboard.loadError"));
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {error || t("customer.portal.dashboard.loadError")}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
      {/* Welcome Section */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          {t("customer.portal.dashboard.welcome")}, {customer.firstName}!
        </h1>
        {!customer.emailVerified && (
          <Alert className="mt-4" variant="default">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {t("customer.portal.dashboard.verifyPrompt")}{" "}
              <Link
                href={`/customer-portal/${orgSlug}/verify-email`}
                className="font-medium underline underline-offset-4 hover:text-primary"
              >
                {t("customer.portal.dashboard.verifyLink")}
              </Link>
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* Balance and Action Cards */}
      <div className="grid gap-6 md:grid-cols-3 mb-8">
        {/* Balance Card */}
        <Card className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground border-0">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-semibold">
                {t("customer.portal.dashboard.currentBalance")}
              </CardTitle>
              <Wallet className="h-5 w-5" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {customer.balanceCurrency} {customer.currentBalance.toFixed(2)}
            </div>
            <p className="text-sm opacity-90 mt-2">
              {t("customer.portal.dashboard.availableToSpend")}
            </p>
          </CardContent>
        </Card>

        {/* Send Minutes Card */}
        <Link href={`/customer-portal/${orgSlug}/send-minutes`}>
          <Card className="h-full hover:shadow-lg transition-all hover:border-primary cursor-pointer">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">
                  {t("customer.portal.dashboard.sendMinutes")}
                </CardTitle>
                <Send className="h-5 w-5 text-primary" />
              </div>
            </CardHeader>
            <CardContent>
              <CardDescription>
                {t("customer.portal.dashboard.sendMinutesDesc")}
              </CardDescription>
            </CardContent>
          </Card>
        </Link>

        {/* View History Card */}
        <Link href={`/customer-portal/${orgSlug}/transactions`}>
          <Card className="h-full hover:shadow-lg transition-all hover:border-primary cursor-pointer">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">
                  {t("customer.portal.dashboard.viewHistory")}
                </CardTitle>
                <History className="h-5 w-5 text-primary" />
              </div>
            </CardHeader>
            <CardContent>
              <CardDescription>
                {t("customer.portal.dashboard.viewHistoryDesc")}
              </CardDescription>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Recent Transactions */}
      <Card>
        <CardHeader>
          <CardTitle>
            {t("customer.portal.dashboard.recentTransactions")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t("customer.portal.dashboard.noTransactions")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {t("customer.portal.dashboard.table.date")}
                  </TableHead>
                  <TableHead>
                    {t("customer.portal.dashboard.table.recipient")}
                  </TableHead>
                  <TableHead>
                    {t("customer.portal.dashboard.table.product")}
                  </TableHead>
                  <TableHead>
                    {t("customer.portal.dashboard.table.amount")}
                  </TableHead>
                  <TableHead>
                    {t("customer.portal.dashboard.table.status")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx._id}>
                    <TableCell>
                      {new Date(tx.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>{tx.recipientPhone}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {tx.product?.name || "-"}
                    </TableCell>
                    <TableCell>
                      {customer.balanceCurrency} {tx.amount.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          tx.status === "completed"
                            ? "success"
                            : tx.status === "pending"
                              ? "warning"
                              : "destructive"
                        }
                      >
                        {tx.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
