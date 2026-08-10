"use client";

import { useState, useEffect, useRef } from "react";
import {
  TrendingUp,
  TrendingDown,
  Download,
  DollarSign,
  Users,
  ShoppingCart,
  CheckCircle,
  ChevronDown,
  AlertTriangle,
  Globe,
  Phone,
  CreditCard,
  Package,
  Eye,
  ExternalLink,
  Smartphone,
  Monitor,
  Languages,
} from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@topupsend/ui";
import { DashboardLayout } from "@/components/dashboard-layout";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { format } from "date-fns";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
} from "recharts";

// --- Types ---

interface AnalyticsSummary {
  revenue: number;
  revenueTrend: number;
  transactions: number;
  transactionsTrend: number;
  completed: number;
  failed: number;
  refunded: number;
  pending: number;
  customers: number;
  newCustomers: number;
  customersTrend: number;
  successRate: number;
  successRateTrend: number;
  avgTransactionValue: number;
}

interface RevenuePoint {
  date: string;
  revenue: number;
  count: number;
}

interface StatusItem {
  status: string;
  count: number;
  amount: number;
}

interface TopCustomer {
  phoneNumber: string;
  email?: string;
  name?: string;
  country?: string;
  totalSpent: number;
  transactionCount: number;
  lastPurchase: string;
}

interface CountryItem {
  country: string;
  countryName: string;
  revenue: number;
  count: number;
}

interface OperatorItem {
  operator: string;
  revenue: number;
  count: number;
}

interface PaymentMethodItem {
  method: string;
  count: number;
  amount: number;
}

interface ProductItem {
  skuCode: string;
  productName: string;
  providerName: string;
  count: number;
  revenue: number;
}

interface FailureItem {
  orderId: string;
  phoneNumber: string;
  amount: number;
  currency: string;
  failureReason?: string;
  providerName?: string;
  createdAt: string;
}

interface DeviceItem {
  device: string;
  count: number;
}

interface BrowserItem {
  browser: string;
  count: number;
}

interface LanguageItem {
  language: string;
  count: number;
}

interface AnalyticsData {
  summary: AnalyticsSummary;
  revenueOverTime: RevenuePoint[];
  statusBreakdown: StatusItem[];
  topCustomers: TopCustomer[];
  topCountries: CountryItem[];
  topOperators: OperatorItem[];
  paymentMethods: PaymentMethodItem[];
  topProducts: ProductItem[];
  recentFailures: FailureItem[];
  deviceBreakdown: DeviceItem[];
  browserBreakdown: BrowserItem[];
  languageBreakdown: LanguageItem[];
}

// --- Constants ---

const STATUS_COLORS: Record<string, string> = {
  completed: "#22c55e",
  pending: "#eab308",
  paid: "#3b82f6",
  processing: "#a855f7",
  failed: "#ef4444",
  refunded: "#6b7280",
};

const PAYMENT_COLORS = ["#3b82f6", "#8b5cf6", "#f59e0b", "#10b981", "#6b7280"];

const DEVICE_COLORS: Record<string, string> = {
  iPhone: "#000000",
  iPad: "#6b7280",
  Android: "#3ddc84",
  Tablet: "#f59e0b",
  Desktop: "#3b82f6",
  Unknown: "#d1d5db",
};

const BROWSER_COLORS: Record<string, string> = {
  Chrome: "#4285f4",
  Safari: "#007aff",
  Firefox: "#ff7139",
  Edge: "#0078d7",
  Opera: "#ff1b2d",
  Samsung: "#1428a0",
  Unknown: "#d1d5db",
};

const LANGUAGE_NAMES: Record<string, string> = {
  EN: "English",
  FR: "French",
  ES: "Spanish",
  PT: "Portuguese",
  DE: "German",
  IT: "Italian",
  NL: "Dutch",
  ZH: "Chinese",
  JA: "Japanese",
  KO: "Korean",
  AR: "Arabic",
  HI: "Hindi",
  RU: "Russian",
  HT: "Haitian Creole",
  TR: "Turkish",
  PL: "Polish",
  VI: "Vietnamese",
  TH: "Thai",
  Unknown: "Unknown",
};

const LANGUAGE_COLORS: Record<string, string> = {
  EN: "#3b82f6",
  FR: "#2563eb",
  ES: "#f59e0b",
  PT: "#10b981",
  DE: "#6b7280",
  IT: "#22c55e",
  NL: "#f97316",
  ZH: "#ef4444",
  JA: "#ec4899",
  KO: "#8b5cf6",
  AR: "#14b8a6",
  HI: "#f43f5e",
  RU: "#0ea5e9",
  HT: "#a855f7",
  Unknown: "#d1d5db",
};

const PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "90d", label: "Last 90 Days" },
  { value: "1y", label: "Last Year" },
  { value: "all", label: "All Time" },
];

// --- Helpers ---

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatPaymentMethod(method: string): string {
  const labels: Record<string, string> = {
    pgpay: "PGPay",
    balance: "Customer Balance",
    stripe: "Stripe",
    paypal: "PayPal",
    unknown: "Unknown",
  };
  return labels[method] || method;
}

function TrendBadge({ value }: { value: number }) {
  const isPositive = value >= 0;
  const Icon = isPositive ? TrendingUp : TrendingDown;
  const color = isPositive ? "text-green-600" : "text-red-600";

  return (
    <div className="flex items-center gap-1 text-xs">
      <Icon className={`h-3 w-3 ${color}`} />
      <span className={color}>
        {isPositive ? "+" : ""}
        {value.toFixed(1)}%
      </span>
      <span className="text-muted-foreground">vs previous period</span>
    </div>
  );
}

// --- Custom Tooltip ---

function RevenueTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium mb-1">{label}</p>
      <p className="text-green-600">
        Revenue: {formatCurrency(payload[0]?.value || 0)}
      </p>
      <p className="text-muted-foreground">
        Transactions: {payload[0]?.payload?.count || 0}
      </p>
    </div>
  );
}

function PieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const data = payload[0];
  return (
    <div className="bg-white border rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium">{data.name}</p>
      <p>Count: {data.value}</p>
      {data.payload?.amount != null && (
        <p>Amount: {formatCurrency(data.payload.amount)}</p>
      )}
    </div>
  );
}

// --- Main Component ---

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("30d");
  const [showPeriodDropdown, setShowPeriodDropdown] = useState(false);
  const [selectedFailure, setSelectedFailure] = useState<FailureItem | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedPeriodLabel =
    PERIOD_OPTIONS.find((opt) => opt.value === period)?.label || "Last 30 Days";

  useEffect(() => {
    fetchAnalytics();
  }, [period]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowPeriodDropdown(false);
      }
    };
    if (showPeriodDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showPeriodDropdown]);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `/api/v1/dashboard/analytics?period=${period}`,
      );
      if (response.ok) {
        const json = await response.json();
        setData(json.data || json);
      }
    } catch (error) {
      console.error("Failed to fetch analytics:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
            <p className="text-muted-foreground">Loading analytics...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const s = data?.summary;
  const hasData =
    s && (s.revenue > 0 || s.transactions > 0 || s.customers > 0);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
            <p className="text-muted-foreground mt-1">
              Comprehensive insights into your business performance
            </p>
          </div>
          <div className="flex gap-2">
            <div className="relative" ref={dropdownRef}>
              <Button
                variant="outline"
                onClick={() => setShowPeriodDropdown(!showPeriodDropdown)}
                className="min-w-[160px] justify-between"
              >
                {selectedPeriodLabel}
                <ChevronDown
                  className={`h-4 w-4 ml-2 transition-transform ${showPeriodDropdown ? "rotate-180" : ""}`}
                />
              </Button>
              {showPeriodDropdown && (
                <div className="absolute top-full mt-1 left-0 w-full bg-white border rounded-lg shadow-lg z-10 overflow-hidden animate-in slide-in-from-top-2">
                  {PERIOD_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setPeriod(option.value);
                        setShowPeriodDropdown(false);
                      }}
                      className={`w-full px-4 py-2 text-left text-sm transition-colors ${
                        period === option.value
                          ? "bg-primary text-white font-medium"
                          : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Button variant="outline" disabled>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </div>

        {!hasData ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <TrendingUp className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">
                No analytics data yet
              </h3>
              <p className="text-muted-foreground text-center max-w-md">
                Start processing transactions to see detailed analytics and
                insights about your business.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Row 1: KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Revenue
                  </CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {formatCurrency(s!.revenue)}
                  </div>
                  <TrendBadge value={s!.revenueTrend} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Transactions
                  </CardTitle>
                  <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{s!.transactions}</div>
                  <TrendBadge value={s!.transactionsTrend} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Customers
                  </CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{s!.customers}</div>
                  <div className="flex items-center gap-1 text-xs">
                    <TrendingUp className="h-3 w-3 text-green-600" />
                    <span className="text-green-600">
                      {s!.newCustomers} new
                    </span>
                    <span className="text-muted-foreground">this period</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Success Rate
                  </CardTitle>
                  <CheckCircle className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{s!.successRate}%</div>
                  <TrendBadge value={s!.successRateTrend} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Avg. Transaction
                  </CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {formatCurrency(s!.avgTransactionValue)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {s!.completed} completed
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Row 2: Revenue Over Time */}
            {data!.revenueOverTime.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Revenue Over Time
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={data!.revenueOverTime}>
                      <defs>
                        <linearGradient
                          id="revenueGradient"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#3b82f6"
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="95%"
                            stopColor="#3b82f6"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        className="stroke-muted"
                      />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 12 }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 12 }}
                        tickLine={false}
                        tickFormatter={(v) => `$${v}`}
                      />
                      <Tooltip content={<RevenueTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="revenue"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        fill="url(#revenueGradient)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Row 3: Status Breakdown + Payment Methods */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Status Breakdown */}
              {data!.statusBreakdown.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <CheckCircle className="h-5 w-5" />
                      Transaction Status
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie
                          data={data!.statusBreakdown}
                          dataKey="count"
                          nameKey="status"
                          cx="50%"
                          cy="50%"
                          outerRadius={90}
                          innerRadius={50}
                          paddingAngle={2}
                          label={({ status, count }) =>
                            `${status} (${count})`
                          }
                        >
                          {data!.statusBreakdown.map((entry, index) => (
                            <Cell
                              key={index}
                              fill={
                                STATUS_COLORS[entry.status] || "#6b7280"
                              }
                            />
                          ))}
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap justify-center gap-3 mt-2">
                      {data!.statusBreakdown.map((item) => (
                        <div
                          key={item.status}
                          className="flex items-center gap-1.5 text-xs"
                        >
                          <div
                            className="w-2.5 h-2.5 rounded-full"
                            style={{
                              backgroundColor:
                                STATUS_COLORS[item.status] || "#6b7280",
                            }}
                          />
                          <span className="capitalize">{item.status}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Payment Methods */}
              {data!.paymentMethods.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <CreditCard className="h-5 w-5" />
                      Payment Methods
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie
                          data={data!.paymentMethods.map((p) => ({
                            ...p,
                            name: formatPaymentMethod(p.method),
                          }))}
                          dataKey="count"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={90}
                          innerRadius={50}
                          paddingAngle={2}
                          label={({ name, count }) => `${name} (${count})`}
                        >
                          {data!.paymentMethods.map((_, index) => (
                            <Cell
                              key={index}
                              fill={
                                PAYMENT_COLORS[index % PAYMENT_COLORS.length]
                              }
                            />
                          ))}
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap justify-center gap-3 mt-2">
                      {data!.paymentMethods.map((item, i) => (
                        <div
                          key={item.method}
                          className="flex items-center gap-1.5 text-xs"
                        >
                          <div
                            className="w-2.5 h-2.5 rounded-full"
                            style={{
                              backgroundColor:
                                PAYMENT_COLORS[i % PAYMENT_COLORS.length],
                            }}
                          />
                          <span>{formatPaymentMethod(item.method)}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Row 4: Device, Browser & Language Breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Device Breakdown */}
              {data!.deviceBreakdown && data!.deviceBreakdown.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Smartphone className="h-5 w-5" />
                      Devices
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie
                          data={data!.deviceBreakdown}
                          dataKey="count"
                          nameKey="device"
                          cx="50%"
                          cy="50%"
                          outerRadius={90}
                          innerRadius={55}
                          paddingAngle={2}
                        >
                          {data!.deviceBreakdown.map((item) => (
                            <Cell
                              key={item.device}
                              fill={
                                DEVICE_COLORS[item.device] ||
                                PAYMENT_COLORS[
                                  data!.deviceBreakdown.indexOf(item) %
                                    PAYMENT_COLORS.length
                                ]
                              }
                            />
                          ))}
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap justify-center gap-3 mt-2 text-xs">
                      {data!.deviceBreakdown.map((item, i) => (
                        <div key={item.device} className="flex items-center gap-1.5">
                          <div
                            className="w-2.5 h-2.5 rounded-full"
                            style={{
                              backgroundColor:
                                DEVICE_COLORS[item.device] ||
                                PAYMENT_COLORS[i % PAYMENT_COLORS.length],
                            }}
                          />
                          <span>
                            {item.device} ({item.count})
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Browser Breakdown */}
              {data!.browserBreakdown && data!.browserBreakdown.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Monitor className="h-5 w-5" />
                      Browsers
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie
                          data={data!.browserBreakdown}
                          dataKey="count"
                          nameKey="browser"
                          cx="50%"
                          cy="50%"
                          outerRadius={90}
                          innerRadius={55}
                          paddingAngle={2}
                        >
                          {data!.browserBreakdown.map((item) => (
                            <Cell
                              key={item.browser}
                              fill={
                                BROWSER_COLORS[item.browser] ||
                                PAYMENT_COLORS[
                                  data!.browserBreakdown.indexOf(item) %
                                    PAYMENT_COLORS.length
                                ]
                              }
                            />
                          ))}
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap justify-center gap-3 mt-2 text-xs">
                      {data!.browserBreakdown.map((item, i) => (
                        <div key={item.browser} className="flex items-center gap-1.5">
                          <div
                            className="w-2.5 h-2.5 rounded-full"
                            style={{
                              backgroundColor:
                                BROWSER_COLORS[item.browser] ||
                                PAYMENT_COLORS[i % PAYMENT_COLORS.length],
                            }}
                          />
                          <span>
                            {item.browser} ({item.count})
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Language Breakdown */}
              {data!.languageBreakdown && data!.languageBreakdown.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Languages className="h-5 w-5" />
                      Languages
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie
                          data={data!.languageBreakdown}
                          dataKey="count"
                          nameKey="language"
                          cx="50%"
                          cy="50%"
                          outerRadius={90}
                          innerRadius={55}
                          paddingAngle={2}
                        >
                          {data!.languageBreakdown.map((item) => (
                            <Cell
                              key={item.language}
                              fill={
                                LANGUAGE_COLORS[item.language] ||
                                PAYMENT_COLORS[
                                  data!.languageBreakdown.indexOf(item) %
                                    PAYMENT_COLORS.length
                                ]
                              }
                            />
                          ))}
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap justify-center gap-3 mt-2 text-xs">
                      {data!.languageBreakdown.map((item, i) => (
                        <div key={item.language} className="flex items-center gap-1.5">
                          <div
                            className="w-2.5 h-2.5 rounded-full"
                            style={{
                              backgroundColor:
                                LANGUAGE_COLORS[item.language] ||
                                PAYMENT_COLORS[i % PAYMENT_COLORS.length],
                            }}
                          />
                          <span>
                            {LANGUAGE_NAMES[item.language] || item.language} ({item.count})
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Row 5: Top Countries + Top Operators */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Top Countries */}
              {data!.topCountries.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Globe className="h-5 w-5" />
                      Top Countries by Revenue
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart
                        data={data!.topCountries}
                        layout="vertical"
                        margin={{ left: 20 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          className="stroke-muted"
                        />
                        <XAxis
                          type="number"
                          tick={{ fontSize: 12 }}
                          tickFormatter={(v) => `$${v}`}
                        />
                        <YAxis
                          type="category"
                          dataKey="countryName"
                          tick={{ fontSize: 12 }}
                          width={120}
                        />
                        <Tooltip
                          formatter={(value: number) => [
                            formatCurrency(value),
                            "Revenue",
                          ]}
                        />
                        <Bar
                          dataKey="revenue"
                          fill="#3b82f6"
                          radius={[0, 4, 4, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* Top Operators */}
              {data!.topOperators.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Phone className="h-5 w-5" />
                      Top Operators by Revenue
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart
                        data={data!.topOperators}
                        layout="vertical"
                        margin={{ left: 20 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          className="stroke-muted"
                        />
                        <XAxis
                          type="number"
                          tick={{ fontSize: 12 }}
                          tickFormatter={(v) => `$${v}`}
                        />
                        <YAxis
                          type="category"
                          dataKey="operator"
                          tick={{ fontSize: 12 }}
                          width={120}
                        />
                        <Tooltip
                          formatter={(value: number) => [
                            formatCurrency(value),
                            "Revenue",
                          ]}
                        />
                        <Bar
                          dataKey="revenue"
                          fill="#8b5cf6"
                          radius={[0, 4, 4, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Row 5: Top Customers + Top Products */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Top Customers */}
              {data!.topCustomers.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="h-5 w-5" />
                      Top Customers
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left">
                            <th className="pb-2 font-medium text-muted-foreground">
                              #
                            </th>
                            <th className="pb-2 font-medium text-muted-foreground">
                              Customer
                            </th>
                            <th className="pb-2 font-medium text-muted-foreground text-right">
                              Spent
                            </th>
                            <th className="pb-2 font-medium text-muted-foreground text-right">
                              Txns
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {data!.topCustomers.map((customer, i) => (
                            <tr key={customer.phoneNumber} className="border-b last:border-0">
                              <td className="py-2.5 text-muted-foreground">
                                {i + 1}
                              </td>
                              <td className="py-2.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-medium">
                                    {customer.name || customer.phoneNumber}
                                  </span>
                                  <WhatsAppButton phoneNumber={customer.phoneNumber} size="sm" />
                                </div>
                                {customer.name && (
                                  <div className="text-xs text-muted-foreground">
                                    {customer.phoneNumber}
                                  </div>
                                )}
                                {customer.country && (
                                  <div className="text-xs text-muted-foreground">
                                    {customer.country}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 text-right font-medium">
                                {formatCurrency(customer.totalSpent)}
                              </td>
                              <td className="py-2.5 text-right text-muted-foreground">
                                {customer.transactionCount}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Top Products */}
              {data!.topProducts.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Package className="h-5 w-5" />
                      Top Products
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left">
                            <th className="pb-2 font-medium text-muted-foreground">
                              #
                            </th>
                            <th className="pb-2 font-medium text-muted-foreground">
                              Product
                            </th>
                            <th className="pb-2 font-medium text-muted-foreground text-right">
                              Revenue
                            </th>
                            <th className="pb-2 font-medium text-muted-foreground text-right">
                              Sales
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {data!.topProducts.map((product, i) => (
                            <tr key={product.skuCode} className="border-b last:border-0">
                              <td className="py-2.5 text-muted-foreground">
                                {i + 1}
                              </td>
                              <td className="py-2.5">
                                <div className="font-medium">
                                  {product.productName}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {product.providerName}
                                </div>
                                <div className="text-xs text-muted-foreground font-mono">
                                  {product.skuCode}
                                </div>
                              </td>
                              <td className="py-2.5 text-right font-medium">
                                {formatCurrency(product.revenue)}
                              </td>
                              <td className="py-2.5 text-right text-muted-foreground">
                                {product.count}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Row 6: Recent Failures */}
            {data!.recentFailures.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-red-500" />
                    Recent Failed Transactions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="pb-2 pr-4 font-medium text-muted-foreground">
                            Order ID
                          </th>
                          <th className="pb-2 pr-4 font-medium text-muted-foreground">
                            Phone
                          </th>
                          <th className="pb-2 pr-4 font-medium text-muted-foreground">
                            Provider
                          </th>
                          <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">
                            Amount
                          </th>
                          <th className="pb-2 pr-4 font-medium text-muted-foreground">
                            Reason
                          </th>
                          <th className="pb-2 pr-4 font-medium text-muted-foreground">
                            Date
                          </th>
                          <th className="pb-2 font-medium text-muted-foreground w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {data!.recentFailures.map((failure) => (
                          <tr
                            key={failure.orderId}
                            className="border-b last:border-0 cursor-pointer hover:bg-muted/50 transition-colors"
                            onClick={() => setSelectedFailure(failure)}
                          >
                            <td className="py-2.5 pr-4 font-mono text-xs">
                              {failure.orderId}
                            </td>
                            <td className="py-2.5 pr-4">
                              <div className="flex items-center gap-1.5">
                                <span>{failure.phoneNumber}</span>
                                <WhatsAppButton phoneNumber={failure.phoneNumber} size="sm" />
                              </div>
                            </td>
                            <td className="py-2.5 pr-4 text-muted-foreground">
                              {failure.providerName || "—"}
                            </td>
                            <td className="py-2.5 pr-4 text-right font-medium">
                              {formatCurrency(failure.amount)}
                            </td>
                            <td className="py-2.5 pr-4 text-red-600 max-w-[250px] truncate">
                              {failure.failureReason || "Unknown"}
                            </td>
                            <td className="py-2.5 pr-4 text-muted-foreground">
                              {format(
                                new Date(failure.createdAt),
                                "MMM dd, HH:mm",
                              )}
                            </td>
                            <td className="py-2.5">
                              <Eye className="h-4 w-4 text-muted-foreground" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Failure Detail Dialog */}
            <Dialog
              open={!!selectedFailure}
              onOpenChange={(open) => {
                if (!open) setSelectedFailure(null);
              }}
            >
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-red-500" />
                    Failed Transaction
                  </DialogTitle>
                  <DialogDescription>
                    Order {selectedFailure?.orderId}
                  </DialogDescription>
                </DialogHeader>
                {selectedFailure && (
                  <div className="space-y-4">
                    {/* Failure Reason */}
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                      <p className="text-xs font-medium text-red-800 mb-1">
                        Failure Reason
                      </p>
                      <p className="text-sm text-red-700 break-words whitespace-pre-wrap">
                        {selectedFailure.failureReason || "No failure reason recorded"}
                      </p>
                    </div>

                    {/* Transaction Details */}
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs">Phone Number</p>
                        <div className="flex items-center gap-1.5">
                          <p className="font-medium">{selectedFailure.phoneNumber}</p>
                          <WhatsAppButton phoneNumber={selectedFailure.phoneNumber} size="sm" />
                        </div>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Provider</p>
                        <p className="font-medium">
                          {selectedFailure.providerName || "Unknown"}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Amount</p>
                        <p className="font-medium">
                          {formatCurrency(selectedFailure.amount)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Date</p>
                        <p className="font-medium">
                          {format(
                            new Date(selectedFailure.createdAt),
                            "MMM dd, yyyy 'at' HH:mm:ss",
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Order ID</p>
                        <p className="font-mono text-xs font-medium">
                          {selectedFailure.orderId}
                        </p>
                      </div>
                    </div>

                    {/* Link to transactions page */}
                    <a
                      href={`/dashboard/transactions`}
                      className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 hover:underline"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      View in Transactions
                    </a>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
