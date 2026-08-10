"use client";

import { useState, useEffect } from "react";
import {
  Save,
  Store,
  Globe,
  DollarSign,
  Tag,
  Palette,
  CreditCard,
  ShoppingCart,
  AlertTriangle,
} from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@topupsend/ui";
import { DashboardLayout } from "@/components/dashboard-layout";

const POPULAR_COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "PG", name: "Papua New Guinea" },
  { code: "HT", name: "Haiti" },
  { code: "JM", name: "Jamaica" },
  { code: "AF", name: "Afghanistan" },
  { code: "MX", name: "Mexico" },
  { code: "IN", name: "India" },
  { code: "PH", name: "Philippines" },
  { code: "NG", name: "Nigeria" },
];

export default function StorefrontSettingsPage() {
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await fetch("/api/v1/storefront/settings");
      if (response.ok) {
        const data = await response.json();
        setSettings(data.settings);
      }
    } catch (_error) {
      console.error("Failed to fetch settings:", _error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/v1/storefront/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      if (response.ok) {
        setMessage({ type: "success", text: "Settings saved successfully!" });
        setTimeout(() => setMessage(null), 3000);
      } else {
        const error = await response.json();
        setMessage({
          type: "error",
          text: error.error || "Failed to save settings",
        });
      }
    } catch (_error) {
      setMessage({ type: "error", text: "Failed to save settings" });
    } finally {
      setSaving(false);
    }
  };

  const toggleStorefront = async () => {
    const newIsActive = !settings.isActive;
    // Optimistically update UI
    setSettings({ ...settings, isActive: newIsActive });

    try {
      const response = await fetch("/api/v1/storefront/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: newIsActive }),
      });

      if (!response.ok) {
        // Revert on error
        setSettings({ ...settings, isActive: !newIsActive });
        const error = await response.json();
        setMessage({
          type: "error",
          text: error.error || "Failed to update storefront status",
        });
        setTimeout(() => setMessage(null), 3000);
      }
    } catch (_error) {
      // Revert on error
      setSettings({ ...settings, isActive: !newIsActive });
      setMessage({ type: "error", text: "Failed to update storefront status" });
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const toggleCountry = (countryCode: string) => {
    const enabled = [...settings.countries.enabled];
    const index = enabled.indexOf(countryCode);

    if (index > -1) {
      enabled.splice(index, 1);
    } else {
      enabled.push(countryCode);
    }

    setSettings({
      ...settings,
      countries: { ...settings.countries, enabled },
    });
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading settings...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!settings) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            Failed to load storefront settings
          </p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Storefront Settings
            </h1>
            <p className="text-muted-foreground mt-1">
              Configure your public storefront for selling top-ups
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Storefront</span>
              <button
                onClick={toggleStorefront}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.isActive ? "bg-primary" : "bg-gray-300"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.isActive ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
              <span className="text-sm font-medium">
                {settings.isActive ? "Active" : "Inactive"}
              </span>
            </div>
            <Button onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
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

        {/* Branding */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Palette className="h-5 w-5 text-primary" />
              <CardTitle>Branding</CardTitle>
            </div>
            <CardDescription>
              Customize how your storefront appears to customers
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Business Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                value={settings.branding.businessName}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    branding: {
                      ...settings.branding,
                      businessName: e.target.value,
                    },
                  })
                }
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Description
              </label>
              <textarea
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                rows={3}
                placeholder="Brief description of your service..."
                value={settings.branding.description || ""}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    branding: {
                      ...settings.branding,
                      description: e.target.value,
                    },
                  })
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Support Email
                </label>
                <input
                  type="email"
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="support@example.com"
                  value={settings.branding.supportEmail || ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      branding: {
                        ...settings.branding,
                        supportEmail: e.target.value,
                      },
                    })
                  }
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">
                  Support Phone
                </label>
                <input
                  type="tel"
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="+1 (555) 123-4567"
                  value={settings.branding.supportPhone || ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      branding: {
                        ...settings.branding,
                        supportPhone: e.target.value,
                      },
                    })
                  }
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Primary Color
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  className="h-10 w-20 rounded cursor-pointer"
                  value={settings.branding.primaryColor}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      branding: {
                        ...settings.branding,
                        primaryColor: e.target.value,
                      },
                    })
                  }
                />
                <input
                  type="text"
                  className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={settings.branding.primaryColor}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      branding: {
                        ...settings.branding,
                        primaryColor: e.target.value,
                      },
                    })
                  }
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Countries */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-primary" />
              <CardTitle>Available Countries</CardTitle>
            </div>
            <CardDescription>
              Select which countries you want to offer top-ups for
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <input
                type="checkbox"
                checked={settings.countries.allEnabled}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    countries: {
                      ...settings.countries,
                      allEnabled: e.target.checked,
                    },
                  })
                }
                className="h-4 w-4"
              />
              <label className="text-sm font-medium text-blue-900">
                Enable all countries (recommended)
              </label>
            </div>

            {!settings.countries.allEnabled && (
              <div>
                <p className="text-sm text-muted-foreground mb-3">
                  Popular countries (click to toggle):
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {POPULAR_COUNTRIES.map((country) => (
                    <button
                      key={country.code}
                      onClick={() => toggleCountry(country.code)}
                      className={`px-4 py-2 text-sm rounded-lg border transition-colors text-left ${
                        settings.countries.enabled.includes(country.code)
                          ? "bg-primary text-white border-primary"
                          : "bg-white hover:bg-gray-50 border-gray-300"
                      }`}
                    >
                      {country.name}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  Selected: {settings.countries.enabled.length} countries
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pricing & Discounts - Managed via dedicated pages */}
        <Card className="border-blue-200 bg-blue-50/50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-blue-600" />
              <CardTitle>Pricing & Discounts</CardTitle>
            </div>
            <CardDescription>
              Configure flexible pricing rules and discount codes
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-1">
                <div className="h-8 w-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <DollarSign className="h-4 w-4 text-blue-600" />
                </div>
              </div>
              <div className="flex-1">
                <h4 className="font-medium text-sm mb-1">Pricing Rules</h4>
                <p className="text-xs text-muted-foreground mb-2">
                  Create flexible pricing rules with percentage and fixed
                  markups, target specific countries or regions, and set
                  priority-based pricing.
                </p>
                <a
                  href="/dashboard/pricing"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  Manage Pricing Rules →
                </a>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-1">
                <div className="h-8 w-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Tag className="h-4 w-4 text-blue-600" />
                </div>
              </div>
              <div className="flex-1">
                <h4 className="font-medium text-sm mb-1">Discount Codes</h4>
                <p className="text-xs text-muted-foreground mb-2">
                  Create promotional discount codes with usage limits,
                  expiration dates, and country restrictions.
                </p>
                <a
                  href="/dashboard/discounts"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  Manage Discounts →
                </a>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Payment Methods */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-primary" />
              <CardTitle>Payment Methods</CardTitle>
            </div>
            <CardDescription>
              Enable payment methods (must be configured in Integrations first)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={settings.paymentMethods.stripe}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      paymentMethods: {
                        ...settings.paymentMethods,
                        stripe: e.target.checked,
                      },
                    })
                  }
                  className="h-4 w-4"
                />
                <label className="text-sm font-medium">Stripe</label>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={settings.paymentMethods.paypal}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      paymentMethods: {
                        ...settings.paymentMethods,
                        paypal: e.target.checked,
                      },
                    })
                  }
                  className="h-4 w-4"
                />
                <label className="text-sm font-medium">PayPal</label>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={settings.paymentMethods.pgpay}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      paymentMethods: {
                        ...settings.paymentMethods,
                        pgpay: e.target.checked,
                      },
                    })
                  }
                  className="h-4 w-4"
                />
                <label className="text-sm font-medium">PGPay</label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Product Types */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-primary" />
              <CardTitle>Product Types</CardTitle>
            </div>
            <CardDescription>
              Choose which product types to offer on your storefront
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <input
                  type="checkbox"
                  checked={settings.productTypes?.plansEnabled ?? true}
                  onChange={(e) => {
                    const newSettings = {
                      ...settings,
                      productTypes: {
                        ...settings.productTypes,
                        plansEnabled: e.target.checked,
                      },
                    };
                    // Ensure at least one is enabled
                    if (
                      !e.target.checked &&
                      !newSettings.productTypes.topupsEnabled
                    ) {
                      setMessage({
                        type: "error",
                        text: "At least one product type must be enabled",
                      });
                      return;
                    }
                    setSettings(newSettings);
                    setMessage(null);
                  }}
                  className="h-4 w-4"
                />
                <div className="flex-1">
                  <label className="text-sm font-medium text-blue-900">
                    Enable Fixed Plans
                  </label>
                  <p className="text-xs text-blue-700 mt-0.5">
                    Fixed-value plans with specific data, voice, and SMS
                    benefits
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <input
                  type="checkbox"
                  checked={settings.productTypes?.topupsEnabled ?? true}
                  onChange={(e) => {
                    const newSettings = {
                      ...settings,
                      productTypes: {
                        ...settings.productTypes,
                        topupsEnabled: e.target.checked,
                      },
                    };
                    // Ensure at least one is enabled
                    if (
                      !e.target.checked &&
                      !newSettings.productTypes.plansEnabled
                    ) {
                      setMessage({
                        type: "error",
                        text: "At least one product type must be enabled",
                      });
                      return;
                    }
                    setSettings(newSettings);
                    setMessage(null);
                  }}
                  className="h-4 w-4"
                />
                <div className="flex-1">
                  <label className="text-sm font-medium text-blue-900">
                    Enable Variable Top-ups
                  </label>
                  <p className="text-xs text-blue-700 mt-0.5">
                    Flexible top-ups where customers can enter custom amounts
                  </p>
                </div>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-xs text-amber-800">
                  <strong>Note:</strong> At least one product type must be
                  enabled for your storefront to function.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Balance Threshold */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-primary" />
              <CardTitle>Balance Threshold Protection</CardTitle>
            </div>
            <CardDescription>
              Prevent purchases when your DingConnect balance is too low
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.balanceThreshold?.enabled ?? false}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    balanceThreshold: {
                      ...settings.balanceThreshold,
                      enabled: e.target.checked,
                    },
                  })
                }
                className="h-4 w-4"
              />
              <label className="text-sm font-medium">
                Enable balance threshold protection
              </label>
            </div>

            {settings.balanceThreshold?.enabled && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Minimum Balance Required
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="e.g., 100"
                      value={settings.balanceThreshold?.minimumBalance ?? 100}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          balanceThreshold: {
                            ...settings.balanceThreshold,
                            minimumBalance: parseFloat(e.target.value) || 0,
                          },
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Currency
                    </label>
                    <select
                      className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                      value={settings.balanceThreshold?.currency ?? "USD"}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          balanceThreshold: {
                            ...settings.balanceThreshold,
                            currency: e.target.value,
                          },
                        })
                      }
                    >
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                      <option value="GBP">GBP</option>
                      <option value="PGK">PGK</option>
                    </select>
                  </div>
                </div>

                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-xs text-red-800">
                    <strong>Protection Enabled:</strong> Customers will not be
                    able to complete purchases if your DingConnect balance falls
                    below {settings.balanceThreshold?.currency ?? "USD"}{" "}
                    {settings.balanceThreshold?.minimumBalance ?? 100}. They
                    will see a friendly message asking them to try again later.
                  </p>
                </div>
              </>
            )}

            {!settings.balanceThreshold?.enabled && (
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-muted-foreground">
                  Balance threshold protection is disabled. Purchases will be
                  allowed regardless of your DingConnect balance.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top-up Settings */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Store className="h-5 w-5 text-primary" />
              <CardTitle>Top-up Processing Settings</CardTitle>
            </div>
            <CardDescription>
              Configure how top-ups are processed with DingConnect
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <input
                type="checkbox"
                checked={settings.topupSettings?.validateOnly ?? false}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    topupSettings: {
                      ...settings.topupSettings,
                      validateOnly: e.target.checked,
                    },
                  })
                }
                className="h-4 w-4"
              />
              <div className="flex-1">
                <label className="text-sm font-medium text-amber-900">
                  Test Mode (Validate Only)
                </label>
                <p className="text-xs text-amber-700 mt-0.5">
                  When enabled, transactions will only be validated without
                  actually sending top-ups. Use this for testing.
                </p>
              </div>
            </div>

            {settings.topupSettings?.validateOnly ? (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-xs text-amber-800">
                  <strong>⚠️ Test Mode Active:</strong> All transactions will
                  only be validated. No actual top-ups will be sent to
                  customers. This is useful for testing your storefront before
                  going live.
                </p>
              </div>
            ) : (
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-xs text-green-800">
                  <strong>✓ Live Mode Active:</strong> Transactions will send
                  actual top-ups to customers via DingConnect.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving} size="lg">
            <Save className="h-5 w-5 mr-2" />
            {saving ? "Saving..." : "Save All Changes"}
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
