"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { Button } from "@topupsend/ui";
import { Input } from "@topupsend/ui";
import { Label } from "@topupsend/ui";
import { Alert, AlertDescription } from "@topupsend/ui";

interface CustomerData {
  _id?: string;
  id?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phoneNumber?: string;
  emailVerified?: boolean;
  twoFactorEnabled?: boolean;
  currentBalance?: number;
  balanceCurrency?: string;
  createdAt?: string;
}

export default function SettingsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const [orgSlug, setOrgSlug] = useState<string>("");
  const [customer, setCustomer] = useState<CustomerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [toggling2FA, setToggling2FA] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    phone: "",
  });
  const [passwordData, setPasswordData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const router = useRouter();
  const { t } = useTranslation();

  useEffect(() => {
    params.then((p) => setOrgSlug(p.orgSlug));
  }, [params]);

  useEffect(() => {
    if (orgSlug) {
      loadCustomerData();
    }
  }, [orgSlug]);

  const loadCustomerData = async () => {
    try {
      const res = await fetch("/api/v1/customer-auth/me", {
        credentials: "include",
      });

      if (!res.ok) {
        if (res.status === 401) {
          router.push(`/customer-portal/${orgSlug}/login`);
          return;
        }
        throw new Error("Failed to load customer data");
      }

      const data = await res.json();
      const customerData = data.customer;
      setCustomer(customerData);
      setFormData({
        firstName:
          customerData.firstName || customerData.name?.split(" ")[0] || "",
        lastName:
          customerData.lastName ||
          customerData.name?.split(" ").slice(1).join(" ") ||
          "",
        phone: customerData.phoneNumber || "",
      });
    } catch (err: any) {
      setError(err.message || t("portal.settings.loadError"));
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setError("");
    setSuccess("");

    try {
      const customerId = customer?.id || customer?._id;
      console.log("Updating customer:", customerId);
      console.log("Form data:", formData);

      const res = await fetch(`/api/v1/customers/${customerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          firstName: formData.firstName,
          lastName: formData.lastName,
          phone: formData.phone,
        }),
      });

      console.log("Response status:", res.status);
      const responseData = await res.json();
      console.log("Response data:", responseData);

      if (!res.ok) {
        throw new Error(
          responseData.error ||
            responseData.detail ||
            responseData.title ||
            "Update failed",
        );
      }

      setSuccess(t("portal.settings.updateSuccess"));
      // Reload customer data to show updated info
      await loadCustomerData();
    } catch (err: any) {
      console.error("Update error:", err);
      setError(err.message || t("portal.settings.updateError"));
    } finally {
      setSavingProfile(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setError(t("portal.settings.passwordMismatch"));
      return;
    }

    setSavingPassword(true);
    setError("");
    setSuccess("");

    try {
      const customerId = customer?.id || customer?._id;
      const res = await fetch(`/api/v1/customers/${customerId}/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          currentPassword: passwordData.currentPassword,
          newPassword: passwordData.newPassword,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(
          errorData.error ||
            errorData.detail ||
            errorData.title ||
            "Password update failed",
        );
      }

      setSuccess(t("portal.settings.passwordUpdateSuccess"));
      setPasswordData({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
    } catch (err: any) {
      setError(err.message || t("portal.settings.passwordUpdateError"));
    } finally {
      setSavingPassword(false);
    }
  };

  const handleToggle2FA = async () => {
    setToggling2FA(true);
    setError("");
    setSuccess("");

    try {
      const newState = !customer?.twoFactorEnabled;

      console.log("Toggling 2FA:", {
        currentState: customer?.twoFactorEnabled,
        newState,
      });

      const res = await fetch("/api/v1/customer-auth/2fa/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ enabled: newState }),
      });

      const data = await res.json();
      console.log("2FA Toggle Response:", { status: res.status, data });

      if (!res.ok) {
        throw new Error(
          data.error?.message || data.detail || "Failed to update 2FA settings",
        );
      }

      // Update customer state immediately with the new value
      setCustomer((prev) =>
        prev ? { ...prev, twoFactorEnabled: newState } : null,
      );

      setSuccess(
        newState
          ? "Two-factor authentication enabled successfully"
          : "Two-factor authentication disabled successfully",
      );

      console.log("2FA toggled successfully, new state:", newState);
    } catch (err: any) {
      console.error("2FA toggle error:", err);
      setError(err.message || "Failed to update 2FA settings");
    } finally {
      setToggling2FA(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!customer) {
    return null;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">
        {t("portal.settings.title")}
      </h1>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="mb-4 bg-green-50 border-green-200 text-green-700">
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      {/* Account Overview */}
      <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">
          Account Overview
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-sm text-gray-500">Full Name</p>
            <p className="text-base font-semibold text-gray-900">
              {customer.name || "Not provided"}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Email Address</p>
            <div className="flex items-center gap-2">
              <p className="text-base font-semibold text-gray-900">
                {customer.email}
              </p>
              {customer.emailVerified ? (
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                  Verified
                </span>
              ) : (
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">
                  Unverified
                </span>
              )}
            </div>
          </div>
          <div>
            <p className="text-sm text-gray-500">Phone Number</p>
            <p className="text-base font-semibold text-gray-900">
              {customer.phoneNumber || "Not provided"}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Account Balance</p>
            <p className="text-base font-semibold text-gray-900">
              {customer.balanceCurrency}{" "}
              {customer.currentBalance?.toFixed(2) || "0.00"}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Member Since</p>
            <p className="text-base font-semibold text-gray-900">
              {customer.createdAt
                ? new Date(customer.createdAt).toLocaleDateString()
                : "N/A"}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Account ID</p>
            <p className="text-sm font-mono text-gray-900">
              {customer.id || customer._id}
            </p>
          </div>
        </div>
      </div>

      {/* Profile Information */}
      <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">
          {t("portal.settings.profileInfo")}
        </h2>

        <form onSubmit={handleUpdateProfile} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">
                {t("portal.settings.firstName")}
              </Label>
              <Input
                id="firstName"
                type="text"
                required
                value={formData.firstName}
                onChange={(e) =>
                  setFormData({ ...formData, firstName: e.target.value })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="lastName">{t("portal.settings.lastName")}</Label>
              <Input
                id="lastName"
                type="text"
                required
                value={formData.lastName}
                onChange={(e) =>
                  setFormData({ ...formData, lastName: e.target.value })
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">{t("portal.settings.email")}</Label>
            <Input
              id="email"
              type="email"
              disabled
              value={customer?.email || ""}
              className="bg-muted cursor-not-allowed"
            />
            <p className="text-xs text-muted-foreground">
              {t("portal.settings.emailNote")}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">{t("portal.settings.phone")}</Label>
            <Input
              id="phone"
              type="tel"
              required
              value={formData.phone}
              onChange={(e) =>
                setFormData({ ...formData, phone: e.target.value })
              }
            />
          </div>

          <Button
            type="submit"
            disabled={savingProfile}
            className="w-full md:w-auto"
          >
            {savingProfile
              ? t("portal.settings.saving")
              : t("portal.settings.saveChanges")}
          </Button>
        </form>
      </div>

      {/* Two-Factor Authentication */}
      <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">
          Two-Factor Authentication
        </h2>
        <p className="text-sm text-muted-foreground mb-6">
          Add an extra layer of security to your account. When enabled, you'll
          need to enter a verification code sent to your email each time you log
          in.
        </p>

        <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
          <div className="flex-1">
            <p className="font-medium text-gray-900">Email Verification Code</p>
            <p className="text-sm text-muted-foreground">
              {customer?.twoFactorEnabled
                ? "2FA is currently enabled. You'll receive a verification code via email when you log in."
                : "Enable 2FA to receive a verification code via email when you log in."}
            </p>
          </div>
          <Button
            onClick={handleToggle2FA}
            disabled={toggling2FA}
            variant={customer?.twoFactorEnabled ? "destructive" : "default"}
            className="ml-4"
          >
            {toggling2FA
              ? "Updating..."
              : customer?.twoFactorEnabled
                ? "Disable 2FA"
                : "Enable 2FA"}
          </Button>
        </div>
      </div>

      {/* Change Password */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">
          {t("portal.settings.changePassword")}
        </h2>

        <form onSubmit={handleUpdatePassword} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">
              {t("portal.settings.currentPassword")}
            </Label>
            <Input
              id="currentPassword"
              type="password"
              required
              value={passwordData.currentPassword}
              onChange={(e) =>
                setPasswordData({
                  ...passwordData,
                  currentPassword: e.target.value,
                })
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="newPassword">
              {t("portal.settings.newPassword")}
            </Label>
            <Input
              id="newPassword"
              type="password"
              required
              minLength={8}
              value={passwordData.newPassword}
              onChange={(e) =>
                setPasswordData({
                  ...passwordData,
                  newPassword: e.target.value,
                })
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">
              {t("portal.settings.confirmPassword")}
            </Label>
            <Input
              id="confirmPassword"
              type="password"
              required
              minLength={8}
              value={passwordData.confirmPassword}
              onChange={(e) =>
                setPasswordData({
                  ...passwordData,
                  confirmPassword: e.target.value,
                })
              }
            />
          </div>

          <Button
            type="submit"
            disabled={savingPassword}
            className="w-full md:w-auto"
          >
            {savingPassword
              ? t("portal.settings.updating")
              : t("portal.settings.updatePassword")}
          </Button>
        </form>
      </div>
    </div>
  );
}
