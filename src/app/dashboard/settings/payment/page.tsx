"use client";

import { useState, useEffect } from "react";
import {
  CreditCard,
  Check,
  Settings,
  Trash2,
  AlertCircle,
  Loader2,
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@topupsend/ui";
import { DashboardLayout } from "@/components/dashboard-layout";
import { toast } from "@topupsend/ui";

interface PaymentProvider {
  _id: string;
  provider: "stripe" | "paypal" | "pgpay";
  status: "active" | "inactive" | "error";
  environment: "sandbox" | "production";
  settings: {
    acceptedCurrencies: string[];
    minAmount?: number;
    maxAmount?: number;
    feePercentage?: number;
    fixedFee?: number;
    autoCapture?: boolean;
  };
  metadata: {
    lastTestSuccess?: string;
    lastTestError?: string;
  };
  hasCredentials?: boolean;
  credentials?: any;
}

const PAYMENT_GATEWAYS = [
  {
    id: "stripe",
    name: "Stripe",
    description: "Accept credit cards and digital wallets",
    logo: "💳",
    credentialFields: [
      {
        key: "secretKey",
        label: "Secret Key",
        type: "password",
        required: true,
        placeholder: "sk_test_...",
      },
      {
        key: "publishableKey",
        label: "Publishable Key",
        type: "text",
        required: true,
        placeholder: "pk_test_...",
      },
      {
        key: "webhookSecret",
        label: "Webhook Secret",
        type: "password",
        required: false,
        placeholder: "whsec_...",
      },
    ],
  },
  {
    id: "paypal",
    name: "PayPal",
    description: "Accept PayPal payments worldwide",
    logo: "🅿️",
    credentialFields: [
      {
        key: "clientId",
        label: "Client ID",
        type: "text",
        required: true,
        placeholder: "Your PayPal Client ID",
      },
      {
        key: "clientSecret",
        label: "Client Secret",
        type: "password",
        required: true,
        placeholder: "Your PayPal Client Secret",
      },
    ],
  },
  {
    id: "pgpay",
    name: "PGPay",
    description: "Haiti payment solution",
    logo: "🇭🇹",
    credentialFields: [
      {
        key: "userId",
        label: "User ID",
        type: "text",
        required: true,
        placeholder: "Your PGPay User ID (UUID)",
      },
    ],
  },
];

export default function PaymentSettingsPage() {
  const [providers, setProviders] = useState<PaymentProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [configDialog, setConfigDialog] = useState<{
    open: boolean;
    provider: string | null;
    existingProviderId?: string;
  }>({ open: false, provider: null });
  const [formData, setFormData] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    fetchProviders();
  }, []);

  const fetchProviders = async () => {
    try {
      const response = await fetch("/api/v1/payment-providers");
      if (response.ok) {
        const data = await response.json();
        setProviders(data.providers || []);
      }
    } catch (_error) {
      console.error("Failed to fetch providers:", _error);
      toast({
        title: "Error",
        description: "Failed to load payment providers",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  const openConfigDialog = async (
    providerId: string,
    existingProviderId?: string
  ) => {
    setConfigDialog({ open: true, provider: providerId, existingProviderId });

    // If editing existing provider, fetch full details including credentials
    if (existingProviderId) {
      try {
        const response = await fetch(
          `/api/v1/payment-providers/${existingProviderId}`
        );
        if (response.ok) {
          const data = await response.json();
          setFormData({
            environment: data.provider.environment,
            credentials: data.provider.credentials || {},
            settings: data.provider.settings || {},
          });
        }
      } catch (_error) {
        console.error("Failed to fetch provider details:", _error);
      }
    } else {
      setFormData({
        environment: "sandbox",
        credentials: {},
        settings: {
          acceptedCurrencies: ["USD"],
          autoCapture: true,
        },
      });
    }
  };

  const handleSaveProvider = async () => {
    if (!configDialog.provider) return;

    setSaving(true);
    try {
      const isEditing = !!configDialog.existingProviderId;
      const url = isEditing
        ? `/api/v1/payment-providers/${configDialog.existingProviderId}`
        : "/api/v1/payment-providers";
      const method = isEditing ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: configDialog.provider,
          environment: formData.environment,
          credentials: formData.credentials,
          settings: formData.settings,
        }),
      });

      if (response.ok) {
        toast({
          title: "Success",
          description: `Payment provider ${isEditing ? "updated" : "saved"} successfully`,
          variant: "success",
        });
        setConfigDialog({ open: false, provider: null });
        fetchProviders();
      } else {
        const error = await response.json();
        toast({
          title: "Error",
          description: error.error || "Failed to save provider",
          variant: "error",
        });
      }
    } catch (_error) {
      toast({
        title: "Error",
        description: "Failed to save payment provider",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestProvider = async (providerId: string) => {
    setTesting(providerId);
    try {
      const response = await fetch(
        `/api/v1/payment-providers/${providerId}/test`,
        {
          method: "POST",
        }
      );

      const data = await response.json();

      if (response.ok) {
        toast({
          title: "Test Successful",
          description: data.message || "Payment provider is working correctly",
          variant: "success",
        });
        fetchProviders();
      } else {
        toast({
          title: "Test Failed",
          description: data.error || "Failed to connect to payment provider",
          variant: "error",
        });
      }
    } catch (_error) {
      toast({
        title: "Error",
        description: "Failed to test payment provider",
        variant: "error",
      });
    } finally {
      setTesting(null);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    if (!confirm("Are you sure you want to delete this payment provider?")) {
      return;
    }

    try {
      const response = await fetch(`/api/v1/payment-providers/${providerId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        toast({
          title: "Success",
          description: "Payment provider deleted successfully",
          variant: "success",
        });
        fetchProviders();
      } else {
        toast({
          title: "Error",
          description: "Failed to delete provider",
          variant: "error",
        });
      }
    } catch (_error) {
      toast({
        title: "Error",
        description: "Failed to delete payment provider",
        variant: "error",
      });
    }
  };

  const getGatewayInfo = (providerId: string) => {
    return PAYMENT_GATEWAYS.find((g) => g.id === providerId);
  };

  const currentGateway = configDialog.provider
    ? getGatewayInfo(configDialog.provider)
    : null;

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">
              Loading payment providers...
            </p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-4xl">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Payment Settings
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure payment gateways to accept customer payments
          </p>
        </div>

        {/* Configured Payment Providers */}
        {providers.length > 0 ? (
          <div className="space-y-4">
            {providers.map((config) => {
              const gateway = getGatewayInfo(config.provider);
              if (!gateway) return null;

              const isActive = config.status === "active";
              const hasError = config.status === "error";

              return (
                <Card key={config._id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="text-4xl">{gateway.logo}</div>
                        <div>
                          <div className="flex items-center gap-2">
                            <CardTitle>{gateway.name}</CardTitle>
                            {isActive && (
                              <span className="flex items-center gap-1 text-sm text-green-600 font-normal">
                                <Check className="h-4 w-4" />
                                Active
                              </span>
                            )}
                            {config.status === "inactive" && (
                              <span className="flex items-center gap-1 text-sm text-amber-600 font-normal">
                                <AlertCircle className="h-4 w-4" />
                                Not Tested
                              </span>
                            )}
                            {hasError && (
                              <span className="flex items-center gap-1 text-sm text-red-600 font-normal">
                                <AlertCircle className="h-4 w-4" />
                                Error
                              </span>
                            )}
                          </div>
                          <CardDescription>
                            {gateway.description}
                          </CardDescription>
                          <p className="text-xs text-muted-foreground mt-1">
                            Environment: {config.environment}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleTestProvider(config._id)}
                          disabled={testing === config._id}
                        >
                          {testing === config._id ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Testing...
                            </>
                          ) : (
                            "Test Connection"
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            openConfigDialog(config.provider, config._id)
                          }
                        >
                          <Settings className="h-4 w-4 mr-2" />
                          Configure
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteProvider(config._id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {hasError && config.metadata?.lastTestError && (
                      <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                        <p className="text-sm text-red-800">
                          {config.metadata.lastTestError}
                        </p>
                      </div>
                    )}
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <CreditCard className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                No Payment Methods Configured
              </h3>
              <p className="text-muted-foreground mb-4">
                Add a payment provider to start accepting customer payments
              </p>
              <Dialog>
                <DialogTrigger asChild>
                  <Button>Add Payment Provider</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Select Payment Provider</DialogTitle>
                    <DialogDescription>
                      Choose a payment gateway to configure
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2 mt-4">
                    {PAYMENT_GATEWAYS.map((gateway) => (
                      <Button
                        key={gateway.id}
                        variant="outline"
                        className="w-full justify-start text-left h-auto py-4"
                        onClick={() => openConfigDialog(gateway.id)}
                      >
                        <div className="flex items-center gap-3">
                          <div className="text-2xl">{gateway.logo}</div>
                          <div>
                            <div className="font-semibold">{gateway.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {gateway.description}
                            </div>
                          </div>
                        </div>
                      </Button>
                    ))}
                  </div>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        )}

        {/* Add Another Provider Button */}
        {providers.length > 0 && (
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" className="w-full">
                <CreditCard className="h-4 w-4 mr-2" />
                Add Another Payment Provider
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Select Payment Provider</DialogTitle>
                <DialogDescription>
                  Choose a payment gateway to configure
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 mt-4">
                {PAYMENT_GATEWAYS.map((gateway) => {
                  const alreadyConfigured = providers.some(
                    (p) => p.provider === gateway.id
                  );
                  return (
                    <Button
                      key={gateway.id}
                      variant="outline"
                      className="w-full justify-start text-left h-auto py-4"
                      onClick={() => openConfigDialog(gateway.id)}
                      disabled={alreadyConfigured}
                    >
                      <div className="flex items-center gap-3">
                        <div className="text-2xl">{gateway.logo}</div>
                        <div className="flex-1">
                          <div className="font-semibold">{gateway.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {gateway.description}
                          </div>
                        </div>
                        {alreadyConfigured && (
                          <span className="text-xs text-muted-foreground">
                            Already configured
                          </span>
                        )}
                      </div>
                    </Button>
                  );
                })}
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* Info Card */}
        <Card>
          <CardHeader>
            <CardTitle>Need Help?</CardTitle>
            <CardDescription>
              Setting up payment gateways requires API credentials from each
              provider. Make sure to test your connection after configuration.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li>Use sandbox/test credentials during development</li>
              <li>
                Switch to production credentials when you&apos;re ready to go
                live
              </li>
              <li>Test your connection after any configuration change</li>
              <li>Keep your API keys secure and never share them</li>
            </ul>
          </CardContent>
        </Card>

        {/* Configuration Dialog */}
        <Dialog
          open={configDialog.open}
          onOpenChange={(open) =>
            setConfigDialog({
              open,
              provider: open ? configDialog.provider : null,
            })
          }
        >
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Configure {currentGateway?.name}</DialogTitle>
              <DialogDescription>
                Enter your {currentGateway?.name} API credentials to enable
                payments
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 mt-4">
              {/* Environment Selection */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  Environment
                </label>
                <select
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={formData.environment || "sandbox"}
                  onChange={(e) =>
                    setFormData({ ...formData, environment: e.target.value })
                  }
                >
                  <option value="sandbox">Sandbox / Test</option>
                  <option value="production">Production / Live</option>
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  Use sandbox for testing, production for live transactions
                </p>
              </div>

              {/* Credentials */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold">API Credentials</h3>
                {currentGateway?.credentialFields.map((field) => (
                  <div key={field.key}>
                    <label className="block text-sm font-medium mb-2">
                      {field.label}
                      {field.required && (
                        <span className="text-red-500 ml-1">*</span>
                      )}
                    </label>
                    <input
                      type={field.type}
                      className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder={field.placeholder}
                      value={formData.credentials?.[field.key] || ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          credentials: {
                            ...formData.credentials,
                            [field.key]: e.target.value,
                          },
                        })
                      }
                    />
                  </div>
                ))}
              </div>

              {/* Settings */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold">Payment Settings</h3>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    Accepted Currencies
                  </label>
                  <input
                    type="text"
                    className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder={
                      currentGateway?.id === "pgpay"
                        ? "USD, HTG (PGPay supports USD and HTG)"
                        : "USD, EUR, GBP (comma-separated)"
                    }
                    value={
                      formData.settings?.acceptedCurrencies?.join(", ") || ""
                    }
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        settings: {
                          ...formData.settings,
                          acceptedCurrencies: e.target.value
                            .split(",")
                            .map((c) => c.trim().toUpperCase()),
                        },
                      })
                    }
                  />
                  {currentGateway?.id === "pgpay" && (
                    <p className="text-xs text-muted-foreground mt-1">
                      PGPay only supports USD and HTG currencies
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Fee Percentage (%)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="0.00"
                      value={
                        formData.settings?.feePercentage
                          ? (formData.settings.feePercentage * 100).toFixed(2)
                          : ""
                      }
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          settings: {
                            ...formData.settings,
                            feePercentage: (parseFloat(e.target.value) || 0) / 100,
                          },
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Percentage fee per transaction (e.g., 3 for 3%)
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Fixed Fee ($)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="0.00"
                      value={formData.settings?.fixedFee ?? ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          settings: {
                            ...formData.settings,
                            fixedFee: parseFloat(e.target.value) || 0,
                          },
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Fixed fee per transaction (e.g., 0.50 for $0.50)
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={formData.settings?.autoCapture ?? true}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        settings: {
                          ...formData.settings,
                          autoCapture: e.target.checked,
                        },
                      })
                    }
                    className="h-4 w-4"
                  />
                  <label className="text-sm font-medium">
                    Auto-capture payments
                  </label>
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() =>
                    setConfigDialog({ open: false, provider: null })
                  }
                >
                  Cancel
                </Button>
                <Button onClick={handleSaveProvider} disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Configuration"
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
