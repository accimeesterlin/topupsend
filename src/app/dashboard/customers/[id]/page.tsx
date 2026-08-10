"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  ArrowLeft,
  Phone,
  Mail,
  MapPin,
  User,
  Edit,
  Trash2,
  Save,
  X,
  Receipt,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Wallet,
  Plus,
  Minus,
  Key,
  ShoppingCart,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Shield,
  ShieldOff,
} from "lucide-react";

const COUNTRIES = [
  "Papua New Guinea",
  "Australia",
  "New Zealand",
  "Fiji",
  "Solomon Islands",
  "Vanuatu",
  "Samoa",
  "Tonga",
  "Kiribati",
  "Micronesia",
  "United States",
  "United Kingdom",
  "Canada",
  "Philippines",
  "Indonesia",
].sort();
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@topupsend/ui";
import { DashboardLayout } from "@/components/dashboard-layout";
import { WhatsAppButton } from "@/components/whatsapp-button";

interface Customer {
  _id: string;
  phoneNumber: string;
  additionalPhoneNumbers?: string[];
  email?: string;
  name?: string;
  country?: string;
  currentBalance?: number;
  balanceCurrency?: string;
  totalAssigned?: number;
  totalUsed?: number;
  twoFactorEnabled?: boolean;
  metadata: {
    totalPurchases: number;
    totalSpent: number;
    currency: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface Transaction {
  _id: string;
  orderId: string;
  amount: number;
  status: string;
  recipient: {
    phoneNumber: string;
    email?: string;
  };
  metadata?: {
    productName?: string;
    productSkuCode?: string;
    testMode?: boolean;
  };
  createdAt: string;
}

interface BalanceHistory {
  _id: string;
  type: string;
  previousBalance: number;
  newBalance: number;
  amount: number;
  description: string;
  createdAt: string;
  metadata?: {
    adminId?: string;
    notes?: string;
    phoneNumber?: string;
    productName?: string;
    orderId?: string;
    transactionId?: string;
    expiresAt?: string;
  };
}

export default function CustomerDetailPage() {
  const router = useRouter();
  const params = useParams();
  const customerId = params.id as string;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [balanceAction, setBalanceAction] = useState<
    "add" | "withdraw" | "reset"
  >("add");
  const [balanceAmount, setBalanceAmount] = useState("");
  const [balanceDescription, setBalanceDescription] = useState("");
  const [balanceHistory, setBalanceHistory] = useState<BalanceHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPerPage] = useState(10);
  const [formData, setFormData] = useState({
    phoneNumber: "",
    email: "",
    name: "",
    country: "",
    password: "",
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [countrySearch, setCountrySearch] = useState("");
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [orgSlug, setOrgSlug] = useState<string>("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [txnPage, setTxnPage] = useState(1);
  const [txnPagination, setTxnPagination] = useState({ total: 0, totalPages: 0 });
  const TXN_PER_PAGE = 10;

  const filteredCountries = COUNTRIES.filter((country) =>
    country.toLowerCase().includes(countrySearch.toLowerCase()),
  );

  useEffect(() => {
    fetchCustomer();
    fetchBalanceHistory();
    fetchOrgSlug();
  }, [customerId]);

  // Fetch transactions when customer data is loaded or page changes
  useEffect(() => {
    if (customer?.phoneNumber) {
      fetchTransactions();
    }
  }, [customer?.phoneNumber, txnPage]);

  const fetchOrgSlug = async () => {
    try {
      const response = await fetch("/api/v1/organizations");
      if (response.ok) {
        const data = await response.json();
        // Find the current organization
        const currentOrg = data.organizations?.find(
          (org: any) => org.isCurrent,
        );
        if (currentOrg) {
          setOrgSlug(currentOrg.slug);
        }
      }
    } catch (_error) {
      console.error("Failed to fetch organization slug:", _error);
    }
  };

  const fetchCustomer = async () => {
    try {
      const response = await fetch(`/api/v1/customers/${customerId}`);
      if (response.ok) {
        const data = await response.json();
        setCustomer(data);
        setFormData({
          phoneNumber: data.phoneNumber,
          email: data.email || "",
          name: data.name || "",
          country: data.country || "",
          password: "",
        });
      } else if (response.status === 404) {
        setMessage({ type: "error", text: "Customer not found" });
      }
    } catch (_error) {
      console.error("Failed to fetch customer:", _error);
      setMessage({ type: "error", text: "Failed to load customer details" });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/v1/customers/${customerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        const updatedCustomer = await response.json();
        setCustomer(updatedCustomer);
        setEditing(false);
        setMessage({ type: "success", text: "Customer updated successfully!" });
        setTimeout(() => setMessage(null), 3000);
      } else {
        const error = await response.json();
        setMessage({
          type: "error",
          text: error.error || "Failed to update customer",
        });
      }
    } catch (_error) {
      setMessage({ type: "error", text: "Failed to update customer" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);

    try {
      const response = await fetch(`/api/v1/customers/${customerId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        router.push("/dashboard/customers");
      } else {
        const error = await response.json();
        setMessage({
          type: "error",
          text: error.error || "Failed to delete customer",
        });
        setShowDeleteModal(false);
      }
    } catch (_error) {
      setMessage({ type: "error", text: "Failed to delete customer" });
      setShowDeleteModal(false);
    } finally {
      setDeleting(false);
    }
  };

  const handleCancelEdit = () => {
    if (customer) {
      setFormData({
        phoneNumber: customer.phoneNumber,
        email: customer.email || "",
        name: customer.name || "",
        country: customer.country || "",
        password: "",
      });
    }
    setEditing(false);
    setMessage(null);
  };

  const handleToggle2FA = async (enabled: boolean) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/v1/customers/${customerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ twoFactorEnabled: enabled }),
      });

      if (response.ok) {
        setCustomer((prev) =>
          prev ? { ...prev, twoFactorEnabled: enabled } : prev,
        );
        setMessage({
          type: "success",
          text: enabled
            ? "Two-factor authentication enabled"
            : "Two-factor authentication disabled",
        });
        setTimeout(() => setMessage(null), 3000);
      } else {
        const error = await response.json();
        setMessage({
          type: "error",
          text: error.error || "Failed to update 2FA setting",
        });
      }
    } catch (_error) {
      setMessage({ type: "error", text: "Failed to update 2FA setting" });
    } finally {
      setSaving(false);
    }
  };

  const handleSetPassword = async () => {
    setPasswordError("");

    if (!newPassword) {
      setPasswordError("Password is required");
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError("Password must be at least 6 characters");
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/v1/customers/${customerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });

      if (response.ok) {
        setMessage({ type: "success", text: "Password updated successfully!" });
        setShowPasswordModal(false);
        setNewPassword("");
        setConfirmPassword("");
        setTimeout(() => setMessage(null), 3000);
      } else {
        const error = await response.json();
        setPasswordError(error.error || "Failed to update password");
      }
    } catch (_error) {
      setPasswordError("Failed to update password");
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const fetchBalanceHistory = async () => {
    setLoadingHistory(true);
    try {
      const response = await fetch(
        `/api/v1/customers/${customerId}/balance/history`,
      );
      if (response.ok) {
        const data = await response.json();
        setBalanceHistory(data.history || []);
      }
    } catch (error) {
      console.error("Failed to fetch balance history:", error);
    } finally {
      setLoadingHistory(false);
    }
  };

  const fetchTransactions = async () => {
    if (!customer?.phoneNumber) return;
    setLoadingTransactions(true);
    try {
      const params = new URLSearchParams();
      params.append("search", customer.phoneNumber);
      params.append("page", txnPage.toString());
      params.append("limit", TXN_PER_PAGE.toString());

      const response = await fetch(`/api/v1/transactions?${params}`);
      if (response.ok) {
        const data = await response.json();
        setTransactions(data.transactions || []);
        setTxnPagination({
          total: data.pagination?.total || 0,
          totalPages: data.pagination?.totalPages || 0,
        });
      }
    } catch (error) {
      console.error("Failed to fetch transactions:", error);
    } finally {
      setLoadingTransactions(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "failed":
      case "refunded":
        return <XCircle className="h-4 w-4 text-red-600" />;
      case "processing":
      case "payment_pending":
        return <Clock className="h-4 w-4 text-amber-600" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-50 text-green-700 border-green-200";
      case "failed":
      case "refunded":
        return "bg-red-50 text-red-700 border-red-200";
      case "processing":
      case "payment_pending":
        return "bg-amber-50 text-amber-700 border-amber-200";
      default:
        return "bg-gray-50 text-gray-700 border-gray-200";
    }
  };

  const handleBalanceAction = async () => {
    if (!balanceAmount || parseFloat(balanceAmount) <= 0) {
      setMessage({ type: "error", text: "Please enter a valid amount" });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const endpoint = `/api/v1/customers/${customerId}/balance`;
      const method = balanceAction === "add" ? "POST" : "PUT";

      const body: any = {
        description: balanceDescription || `Balance ${balanceAction}`,
      };

      if (balanceAction === "add") {
        // Add balance (assign)
        body.amount = parseFloat(balanceAmount);
      } else if (balanceAction === "withdraw") {
        // Withdraw balance (adjustment with negative amount)
        body.type = "adjustment";
        body.amount = -Math.abs(parseFloat(balanceAmount));
      } else if (balanceAction === "reset") {
        // Reset to specific value
        body.type = "reset";
        body.newBalance = parseFloat(balanceAmount);
      }

      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        setMessage({
          type: "success",
          text: `Balance ${balanceAction}ed successfully!`,
        });
        setShowBalanceModal(false);
        setBalanceAmount("");
        setBalanceDescription("");
        await fetchCustomer();
        await fetchBalanceHistory();
        setTimeout(() => setMessage(null), 3000);
      } else {
        const error = await response.json();
        setMessage({
          type: "error",
          text: error.error?.message || `Failed to ${balanceAction} balance`,
        });
      }
    } catch (_error) {
      setMessage({ type: "error", text: `Failed to ${balanceAction} balance` });
    } finally {
      setSaving(false);
    }
  };

  const openBalanceModal = (action: "add" | "withdraw" | "reset") => {
    setBalanceAction(action);
    setBalanceAmount("");
    setBalanceDescription("");
    setShowBalanceModal(true);
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading customer details...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!customer) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-2">Customer Not Found</h2>
            <p className="text-muted-foreground mb-6">
              The customer you're looking for doesn't exist.
            </p>
            <Button onClick={() => router.push("/dashboard/customers")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Customers
            </Button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/dashboard/customers")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-3xl font-bold tracking-tight">
              Customer Details
            </h1>
            <p className="text-muted-foreground mt-1">
              View and manage customer information
            </p>
          </div>
          {!editing && (
            <div className="flex gap-2">
              {customer.email && orgSlug && (
                <Button variant="outline" asChild>
                  <a
                    href={`/customer-portal/${orgSlug}/login?email=${encodeURIComponent(customer.email)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Customer Portal
                  </a>
                </Button>
              )}
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
              <Button
                variant="destructive"
                onClick={() => setShowDeleteModal(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </div>
          )}
        </div>

        {/* Success/Error Message */}
        {message && (
          <div
            className={`p-4 rounded-lg text-sm ${
              message.type === "success"
                ? "bg-green-50 text-green-800 border border-green-200"
                : "bg-red-50 text-red-800 border border-red-200"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Customer Information */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="h-8 w-8 text-primary" />
              </div>
              <div>
                <CardTitle className="text-2xl">
                  {customer.name || "Unnamed Customer"}
                </CardTitle>
                <CardDescription>
                  Customer since {formatDate(customer.createdAt)}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Contact Information */}
            <div>
              <h3 className="font-semibold mb-4">Contact Information</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  {editing ? (
                    <input
                      type="tel"
                      className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                      value={formData.phoneNumber}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          phoneNumber: e.target.value,
                        })
                      }
                    />
                  ) : (
                    <>
                      <span>{customer.phoneNumber}</span>
                      <WhatsAppButton phoneNumber={customer.phoneNumber} />
                    </>
                  )}
                </div>
                {!editing &&
                  customer.additionalPhoneNumbers &&
                  customer.additionalPhoneNumbers.length > 0 && (
                    <div className="ml-7 space-y-1">
                      {customer.additionalPhoneNumbers.map((phone, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 text-sm text-muted-foreground"
                        >
                          <Phone className="h-3 w-3" />
                          <span>{phone}</span>
                          <WhatsAppButton phoneNumber={phone} size="sm" />
                          <span className="text-xs px-1.5 py-0.5 rounded border text-muted-foreground">
                            additional
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  {editing ? (
                    <input
                      type="email"
                      placeholder="Email address"
                      className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                      value={formData.email}
                      onChange={(e) =>
                        setFormData({ ...formData, email: e.target.value })
                      }
                    />
                  ) : (
                    <span>{customer.email || "Not provided"}</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <User className="h-4 w-4 text-muted-foreground" />
                  {editing ? (
                    <input
                      type="text"
                      placeholder="Full name"
                      className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                    />
                  ) : (
                    <span>{customer.name || "Not provided"}</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  {editing ? (
                    <div className="flex-1 relative">
                      <input
                        type="text"
                        placeholder="Search or select country"
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary pr-10"
                        value={formData.country}
                        onChange={(e) => {
                          setFormData({ ...formData, country: e.target.value });
                          setCountrySearch(e.target.value);
                          setShowCountryDropdown(true);
                        }}
                        onFocus={() => setShowCountryDropdown(true)}
                      />
                      <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                      {showCountryDropdown && filteredCountries.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                          {filteredCountries.map((country) => (
                            <div
                              key={country}
                              className="px-4 py-2 hover:bg-muted cursor-pointer text-sm"
                              onClick={() => {
                                setFormData({ ...formData, country });
                                setShowCountryDropdown(false);
                                setCountrySearch("");
                              }}
                            >
                              {country}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span>{customer.country || "Not provided"}</span>
                  )}
                </div>
                {editing && (
                  <div className="flex items-center gap-3">
                    <Key className="h-4 w-4 text-muted-foreground" />
                    <input
                      type="password"
                      placeholder="Set password (leave blank to keep current)"
                      className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                      value={formData.password}
                      onChange={(e) =>
                        setFormData({ ...formData, password: e.target.value })
                      }
                    />
                  </div>
                )}
              </div>

              {editing && (
                <div className="flex gap-3 mt-4">
                  <Button
                    onClick={handleUpdate}
                    disabled={saving || !formData.phoneNumber}
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {saving ? "Saving..." : "Save Changes"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleCancelEdit}
                    disabled={saving}
                  >
                    <X className="h-4 w-4 mr-2" />
                    Cancel
                  </Button>
                </div>
              )}
            </div>

            {/* Purchase Statistics */}
            <div className="pt-4 border-t">
              <h3 className="font-semibold mb-4">Purchase Statistics</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-muted rounded-lg">
                  <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                    <Receipt className="h-4 w-4" />
                    <span>Total Purchases</span>
                  </div>
                  <p className="text-2xl font-bold">
                    {customer.metadata.totalPurchases}
                  </p>
                </div>
                <div className="p-4 bg-muted rounded-lg">
                  <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                    <Calendar className="h-4 w-4" />
                    <span>Total Spent</span>
                  </div>
                  <p className="text-2xl font-bold">
                    {formatCurrency(
                      customer.metadata.totalSpent,
                      customer.metadata.currency,
                    )}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Balance Management and Account Access - Side by Side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Balance Management Card */}
          {customer.currentBalance !== undefined && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Balance Management</CardTitle>
                  <CardDescription>
                    Manage customer prepaid balance
                  </CardDescription>
                </div>
                {customer.email && orgSlug && (
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={`/customer-portal/${orgSlug}/login?email=${encodeURIComponent(customer.email)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Customer Login
                      <ExternalLink className="h-4 w-4 ml-2" />
                    </a>
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {/* Current Balance Display */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="p-2 border rounded-lg">
                    <div className="flex items-center gap-1 text-muted-foreground text-xs mb-0.5">
                      <Wallet className="h-3 w-3" />
                      <span>Current</span>
                    </div>
                    <p className="text-lg font-bold">
                      {customer.balanceCurrency}{" "}
                      {customer.currentBalance?.toFixed(2)}
                    </p>
                  </div>
                  <div className="p-2 border rounded-lg bg-muted/30">
                    <p className="text-xs text-muted-foreground mb-0.5">
                      Assigned
                    </p>
                    <p className="text-sm font-semibold text-muted-foreground">
                      {customer.balanceCurrency}{" "}
                      {customer.totalAssigned?.toFixed(2) || "0.00"}
                    </p>
                  </div>
                  <div className="p-2 border rounded-lg bg-muted/30">
                    <p className="text-xs text-muted-foreground mb-0.5">Used</p>
                    <p className="text-sm font-semibold text-muted-foreground">
                      {customer.balanceCurrency}{" "}
                      {customer.totalUsed?.toFixed(2) || "0.00"}
                    </p>
                  </div>
                </div>

                {/* Balance Actions */}
                <div className="flex gap-2 mb-4">
                  <Button onClick={() => openBalanceModal("add")} size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    Add Balance
                  </Button>
                  <Button
                    onClick={() => openBalanceModal("withdraw")}
                    variant="outline"
                    size="sm"
                  >
                    <Minus className="h-4 w-4 mr-1" />
                    Withdraw
                  </Button>
                  <Button
                    onClick={() => openBalanceModal("reset")}
                    variant="outline"
                    size="sm"
                  >
                    Set Balance
                  </Button>
                </div>

                {/* Balance History */}
                <div className="pt-4 border-t">
                  <h3 className="font-semibold mb-4">Balance History</h3>
                  {loadingHistory ? (
                    <div className="text-center py-4">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                    </div>
                  ) : balanceHistory.length === 0 ? (
                    <p className="text-muted-foreground text-center py-4">
                      No balance history
                    </p>
                  ) : (
                    <>
                      <div className="space-y-3">
                        {balanceHistory
                          .slice(
                            (historyPage - 1) * historyPerPage,
                            historyPage * historyPerPage,
                          )
                          .map((entry) => (
                            <div
                              key={entry._id}
                              className="flex items-center justify-between p-3 bg-muted rounded-lg"
                            >
                              <div className="flex-1">
                                <p className="font-medium capitalize">
                                  {entry.type.replace("_", " ")}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {entry.description}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {formatDate(entry.createdAt)}
                                  {entry.metadata?.adminId && ` by Admin`}
                                </p>
                              </div>
                              <div className="text-right">
                                <p
                                  className={`font-bold ${entry.amount >= 0 ? "text-green-600" : "text-red-600"}`}
                                >
                                  {entry.amount >= 0 ? "+" : ""}
                                  {customer.balanceCurrency}{" "}
                                  {Math.abs(entry.amount).toFixed(2)}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {customer.balanceCurrency}{" "}
                                  {entry.previousBalance.toFixed(2)} →{" "}
                                  {customer.balanceCurrency}{" "}
                                  {entry.newBalance.toFixed(2)}
                                </p>
                              </div>
                            </div>
                          ))}
                      </div>
                      {balanceHistory.length > historyPerPage && (
                        <div className="flex items-center justify-between mt-4 pt-4 border-t">
                          <p className="text-sm text-muted-foreground">
                            Showing {(historyPage - 1) * historyPerPage + 1}-
                            {Math.min(
                              historyPage * historyPerPage,
                              balanceHistory.length,
                            )}{" "}
                            of {balanceHistory.length}
                          </p>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setHistoryPage((p) => Math.max(1, p - 1))
                              }
                              disabled={historyPage === 1}
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setHistoryPage((p) =>
                                  Math.min(
                                    Math.ceil(
                                      balanceHistory.length / historyPerPage,
                                    ),
                                    p + 1,
                                  ),
                                )
                              }
                              disabled={
                                historyPage >=
                                Math.ceil(
                                  balanceHistory.length / historyPerPage,
                                )
                              }
                            >
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Account Access Card */}
          <Card>
            <CardHeader>
              <CardTitle>Account Access</CardTitle>
              <CardDescription>
                Manage customer login credentials
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <Key className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Password</p>
                      <p className="text-sm text-muted-foreground">
                        Set or update customer login password
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowPasswordModal(true)}
                  >
                    <Key className="h-4 w-4 mr-2" />
                    Set Password
                  </Button>
                </div>

                {/* Two-Factor Authentication Toggle */}
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-3">
                    {customer.twoFactorEnabled ? (
                      <Shield className="h-5 w-5 text-green-600" />
                    ) : (
                      <ShieldOff className="h-5 w-5 text-muted-foreground" />
                    )}
                    <div>
                      <p className="font-medium">Two-Factor Authentication</p>
                      <p className="text-sm text-muted-foreground">
                        {customer.twoFactorEnabled
                          ? "2FA is enabled — customer must verify via email code on login"
                          : "2FA is disabled — customer logs in with password only"}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant={customer.twoFactorEnabled ? "destructive" : "outline"}
                    size="sm"
                    disabled={saving}
                    onClick={() =>
                      handleToggle2FA(!customer.twoFactorEnabled)
                    }
                  >
                    {customer.twoFactorEnabled ? (
                      <>
                        <ShieldOff className="h-4 w-4 mr-2" />
                        Disable 2FA
                      </>
                    ) : (
                      <>
                        <Shield className="h-4 w-4 mr-2" />
                        Enable 2FA
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Transaction History */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" />
                Transaction History
              </CardTitle>
              <CardDescription>
                {txnPagination.total} transaction{txnPagination.total !== 1 ? "s" : ""} found
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/dashboard/transactions`)}
            >
              View All
              <ExternalLink className="h-4 w-4 ml-2" />
            </Button>
          </CardHeader>
          <CardContent>
            {loadingTransactions ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : transactions.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No transactions found for this customer
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-3 font-medium text-muted-foreground">Order ID</th>
                        <th className="pb-3 font-medium text-muted-foreground">Product</th>
                        <th className="pb-3 font-medium text-muted-foreground">Amount</th>
                        <th className="pb-3 font-medium text-muted-foreground">Status</th>
                        <th className="pb-3 font-medium text-muted-foreground">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((txn) => (
                        <tr
                          key={txn._id}
                          className="border-b last:border-0 hover:bg-muted/50 cursor-pointer"
                          onClick={() => router.push(`/dashboard/transactions`)}
                        >
                          <td className="py-3">
                            <span className="font-mono text-xs">{txn.orderId}</span>
                            {txn.metadata?.testMode && (
                              <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                                Test
                              </span>
                            )}
                          </td>
                          <td className="py-3 text-muted-foreground">
                            {txn.metadata?.productName || txn.metadata?.productSkuCode || "—"}
                          </td>
                          <td className="py-3 font-medium">
                            ${txn.amount.toFixed(2)}
                          </td>
                          <td className="py-3">
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full border ${getStatusColor(txn.status)}`}>
                              {getStatusIcon(txn.status)}
                              {txn.status}
                            </span>
                          </td>
                          <td className="py-3 text-muted-foreground">
                            {new Date(txn.createdAt).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {txnPagination.totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t">
                    <p className="text-sm text-muted-foreground">
                      Page {txnPage} of {txnPagination.totalPages} ({txnPagination.total} total)
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setTxnPage((p) => Math.max(1, p - 1))}
                        disabled={txnPage === 1}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setTxnPage((p) => Math.min(txnPagination.totalPages, p + 1))}
                        disabled={txnPage >= txnPagination.totalPages}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Balance Action Modal */}
        <Dialog open={showBalanceModal} onOpenChange={setShowBalanceModal}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {balanceAction === "add" && "Add Balance"}
                {balanceAction === "withdraw" && "Withdraw Balance"}
                {balanceAction === "reset" && "Set Balance"}
              </DialogTitle>
              <DialogDescription>
                {balanceAction === "add" &&
                  "Add funds to the customer's account. This increases their available balance."}
                {balanceAction === "withdraw" &&
                  "Deduct funds from the customer's account. This decreases their available balance."}
                {balanceAction === "reset" &&
                  "Set the customer's balance to a specific amount, regardless of current balance."}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  {balanceAction === "reset" ? "New Balance" : "Amount"}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={balanceAmount}
                  onChange={(e) => setBalanceAmount(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">
                  Description
                </label>
                <textarea
                  placeholder="Optional note about this balance change"
                  value={balanceDescription}
                  onChange={(e) => setBalanceDescription(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowBalanceModal(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                onClick={handleBalanceAction}
                disabled={saving || !balanceAmount}
              >
                {saving
                  ? "Processing..."
                  : balanceAction === "add"
                    ? "Add Balance"
                    : balanceAction === "withdraw"
                      ? "Withdraw Balance"
                      : "Reset Balance"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Password Modal */}
        <Dialog open={showPasswordModal} onOpenChange={setShowPasswordModal}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Set Customer Password</DialogTitle>
              <DialogDescription>
                Set a new password for the customer to login to their account
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  New Password
                </label>
                <input
                  type="password"
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">
                  Confirm Password
                </label>
                <input
                  type="password"
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              {passwordError && (
                <p className="text-sm text-red-600">{passwordError}</p>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setShowPasswordModal(false);
                  setNewPassword("");
                  setConfirmPassword("");
                  setPasswordError("");
                }}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button onClick={handleSetPassword} disabled={saving}>
                {saving ? "Saving..." : "Set Password"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Modal */}
        <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Customer</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this customer? This action
                cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <p className="text-sm text-muted-foreground">
                Customer:{" "}
                <span className="font-semibold">
                  {customer.name || customer.phoneNumber}
                </span>
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete Customer"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
