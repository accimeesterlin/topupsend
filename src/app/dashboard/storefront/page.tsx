"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Store,
  Copy,
  CheckCircle,
  ExternalLink,
  Save,
  Settings,
} from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  toast,
} from "@topupsend/ui";
import { DashboardLayout } from "@/components/dashboard-layout";

export default function StorefrontPage() {
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [orgSlug, setOrgSlug] = useState<string>("");

  useEffect(() => {
    fetchSettings();
    fetchOrgSlug();
  }, []);

  const fetchOrgSlug = async () => {
    try {
      const response = await fetch("/api/v1/organization");
      if (response.ok) {
        const data = await response.json();
        setOrgSlug(data.slug);
      }
    } catch (_error) {
      console.error("Failed to fetch organization:", _error);
    }
  };

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
    try {
      const response = await fetch("/api/v1/storefront/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      if (response.ok) {
        toast({
          title: "Success",
          description: "Storefront settings saved successfully!",
          variant: "success",
        });
      } else {
        toast({
          title: "Error",
          description: "Failed to save storefront settings. Please try again.",
          variant: "error",
        });
      }
    } catch (_error) {
      console.error("Failed to save settings:", _error);
      toast({
        title: "Error",
        description: "An unexpected error occurred. Please try again.",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleStorefront = async () => {
    const newIsActive = !settings?.isActive;
    // Optimistically update UI
    setSettings({ ...settings, isActive: newIsActive });

    try {
      const response = await fetch("/api/v1/storefront/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: newIsActive }),
      });

      if (response.ok) {
        toast({
          title: "Success",
          description: `Storefront ${newIsActive ? "enabled" : "disabled"} successfully!`,
          variant: "success",
        });
      } else {
        // Revert on error
        setSettings({ ...settings, isActive: !newIsActive });
        toast({
          title: "Error",
          description: "Failed to update storefront status. Please try again.",
          variant: "error",
        });
      }
    } catch (_error) {
      // Revert on error
      setSettings({ ...settings, isActive: !newIsActive });
      toast({
        title: "Error",
        description: "An unexpected error occurred. Please try again.",
        variant: "error",
      });
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
            <p className="text-muted-foreground">
              Loading storefront settings...
            </p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Storefront Settings
            </h1>
            <p className="text-muted-foreground mt-1">
              Configure your public-facing storefront for selling top-ups
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard/settings/storefront">
              <Button variant="outline">
                <Settings className="h-4 w-4 mr-2" />
                Advanced Settings
              </Button>
            </Link>
            <Button onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>

        {/* Storefront URL Card */}
        <Card className="border-primary/50 shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Store className="h-5 w-5" />
              Your Storefront URL
            </CardTitle>
            <CardDescription>
              Share this link with your customers to let them purchase top-ups
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
                    Copied!
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

            {/* Storefront Status Toggle */}
            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
              <div>
                <p className="font-medium">Storefront Status</p>
                <p className="text-sm text-muted-foreground">
                  {settings?.isActive
                    ? "Your storefront is live and accepting customers"
                    : "Your storefront is currently disabled"}
                </p>
              </div>
              <Button
                variant={settings?.isActive ? "destructive" : "default"}
                onClick={toggleStorefront}
              >
                {settings?.isActive ? "Disable" : "Enable"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Branding Card */}
        <Card>
          <CardHeader>
            <CardTitle>Branding</CardTitle>
            <CardDescription>
              Customize your storefront appearance
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">
                Business Name
              </label>
              <input
                type="text"
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="Your Business Name"
                value={settings?.branding?.businessName || ""}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    branding: {
                      ...settings?.branding,
                      businessName: e.target.value,
                    },
                  })
                }
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">
                Description
              </label>
              <textarea
                className="w-full px-3 py-2 border rounded-lg"
                rows={3}
                placeholder="A brief description of your service"
                value={settings?.branding?.description || ""}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    branding: {
                      ...settings?.branding,
                      description: e.target.value,
                    },
                  })
                }
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Primary Color
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    className="h-10 w-20 rounded border cursor-pointer"
                    value={settings?.branding?.primaryColor || "#3b82f6"}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        branding: {
                          ...settings?.branding,
                          primaryColor: e.target.value,
                        },
                      })
                    }
                  />
                  <input
                    type="text"
                    className="flex-1 px-3 py-2 border rounded-lg font-mono text-sm"
                    value={settings?.branding?.primaryColor || "#3b82f6"}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        branding: {
                          ...settings?.branding,
                          primaryColor: e.target.value,
                        },
                      })
                    }
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">
                  Logo URL (optional)
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="https://example.com/logo.png"
                  value={settings?.branding?.logo || ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      branding: { ...settings?.branding, logo: e.target.value },
                    })
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Support Email
                </label>
                <input
                  type="email"
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="support@example.com"
                  value={settings?.branding?.supportEmail || ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      branding: {
                        ...settings?.branding,
                        supportEmail: e.target.value,
                      },
                    })
                  }
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">
                  Support Phone
                </label>
                <input
                  type="tel"
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="+1 234 567 8900"
                  value={settings?.branding?.supportPhone || ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      branding: {
                        ...settings?.branding,
                        supportPhone: e.target.value,
                      },
                    })
                  }
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Save Button at Bottom */}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving} size="lg">
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Saving..." : "Save All Changes"}
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
