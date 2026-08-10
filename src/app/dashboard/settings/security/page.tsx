"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
} from "@topupsend/ui";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Shield, Mail, Check, X } from "lucide-react";
import { toast } from "@topupsend/ui";

export default function SecuritySettingsPage() {
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    fetchSecuritySettings();
  }, []);

  const fetchSecuritySettings = async () => {
    try {
      const response = await fetch("/api/v1/auth/me");
      if (response.ok) {
        const data = await response.json();
        setTwoFactorEnabled(data.twoFactorEnabled || false);
      }
    } catch (_error) {
      console.error("Failed to fetch security settings:", _error);
      toast({
        title: "Error",
        description: "Failed to load security settings",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleToggle2FA = async () => {
    setToggling(true);

    try {
      const response = await fetch("/api/v1/auth/2fa/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !twoFactorEnabled }),
      });

      if (response.ok) {
        const data = await response.json();
        setTwoFactorEnabled(data.twoFactorEnabled);
        toast({
          title: "Success",
          description: data.message,
          variant: "success",
        });
      } else {
        const error = await response.json();
        toast({
          title: "Error",
          description: error.detail || "Failed to update 2FA settings",
          variant: "error",
        });
      }
    } catch (_error) {
      toast({
        title: "Error",
        description: "Failed to update 2FA settings",
        variant: "error",
      });
    } finally {
      setToggling(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading security settings...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Security Settings</h1>
          <p className="text-muted-foreground mt-1">
            Manage authentication and access control for your account
          </p>
        </div>

        {/* Two-Factor Authentication Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Shield className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle>Two-Factor Authentication</CardTitle>
                <CardDescription>
                  Add an extra layer of security to your account
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Status Display */}
            <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-3">
                <div
                  className={`h-10 w-10 rounded-full flex items-center justify-center ${
                    twoFactorEnabled
                      ? "bg-green-100 text-green-600"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {twoFactorEnabled ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    <X className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <p className="font-semibold">
                    {twoFactorEnabled ? "Enabled" : "Disabled"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {twoFactorEnabled
                      ? "Your account is protected with 2FA"
                      : "2FA is currently disabled"}
                  </p>
                </div>
              </div>
              <Button
                onClick={handleToggle2FA}
                disabled={toggling}
                variant={twoFactorEnabled ? "outline" : "default"}
              >
                {toggling
                  ? "Processing..."
                  : twoFactorEnabled
                    ? "Disable 2FA"
                    : "Enable 2FA"}
              </Button>
            </div>

            {/* Information */}
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 border rounded-lg">
                <Mail className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium mb-1">Email-Based Verification</p>
                  <p className="text-sm text-muted-foreground">
                    When you log in, we'll send a verification code to your email
                    address. You'll need to enter this code to complete the login
                    process.
                  </p>
                </div>
              </div>

              {twoFactorEnabled && (
                <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
                  <p className="text-sm text-blue-900 font-medium mb-2">
                    Important Security Tips
                  </p>
                  <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                    <li>Keep your email account secure with a strong password</li>
                    <li>Never share your verification codes with anyone</li>
                    <li>Verification codes expire after 10 minutes</li>
                    <li>
                      You can request a new code if you don't receive one
                    </li>
                  </ul>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Additional Security Features - Coming Soon */}
        <Card className="opacity-60">
          <CardHeader>
            <CardTitle>API Keys</CardTitle>
            <CardDescription>
              Manage API access keys for your applications
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              This feature is available in the{" "}
              <a
                href="/dashboard/settings/api-keys"
                className="text-primary hover:underline"
              >
                API Keys
              </a>{" "}
              section.
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
