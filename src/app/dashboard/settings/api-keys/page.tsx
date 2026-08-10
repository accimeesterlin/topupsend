"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@topupsend/ui";

interface ApiKey {
  _id: string;
  keyPrefix: string;
  name: string;
  scopes: string[];
  lastUsedAt?: string;
  createdAt: string;
  isActive: boolean;
  userId: {
    _id: string;
    name: string;
    email: string;
    role: string;
  };
  customerId?: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  rateLimit: {
    requestsPerHour: number;
    orgRequestsPerHour: number;
  };
}

export default function AdminApiKeysPage() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedKey, setSelectedKey] = useState<ApiKey | null>(null);
  const [showRateLimitModal, setShowRateLimitModal] = useState(false);
  const [newRateLimits, setNewRateLimits] = useState({
    requestsPerHour: 1000,
    orgRequestsPerHour: 10000,
  });
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  useEffect(() => {
    loadApiKeys();
  }, []);

  const loadApiKeys = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/api-keys?includeAll=true");

      if (!res.ok) {
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        throw new Error("Failed to load API keys");
      }

      const data = await res.json();
      setApiKeys(data.data || []);
    } catch (err: any) {
      setError(err.message || "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (keyId: string) => {
    if (
      !confirm(
        "Are you sure you want to revoke this API key? This action cannot be undone.",
      )
    )
      return;

    try {
      const res = await fetch(`/api/v1/api-keys/${keyId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error("Failed to revoke API key");
      }

      await loadApiKeys();
    } catch (err: any) {
      setError(err.message || "Failed to revoke API key");
      setTimeout(() => setError(""), 5000);
    }
  };

  const openRateLimitModal = (key: ApiKey) => {
    setSelectedKey(key);
    setNewRateLimits({
      requestsPerHour: key.rateLimit.requestsPerHour,
      orgRequestsPerHour: key.rateLimit.orgRequestsPerHour,
    });
    setShowRateLimitModal(true);
  };

  const handleUpdateRateLimit = async () => {
    if (!selectedKey) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/v1/api-keys/${selectedKey._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rateLimit: newRateLimits,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to update rate limit");
      }

      setShowRateLimitModal(false);
      await loadApiKeys();
    } catch (err: any) {
      setError(err.message || "Failed to update rate limit");
      setTimeout(() => setError(""), 5000);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading API keys...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">API Key Management</h1>
          <p className="text-muted-foreground mt-2">
            Manage all API keys in your organization
          </p>
        </div>

        {error && (
          <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded">
            {error}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Organization API Keys</CardTitle>
            <CardDescription>
              View and manage API keys for all users and customers
            </CardDescription>
          </CardHeader>
          <CardContent>
            {apiKeys.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground text-lg">
                  No API keys found
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 font-semibold">
                        Name
                      </th>
                      <th className="text-left py-3 px-4 font-semibold">Key</th>
                      <th className="text-left py-3 px-4 font-semibold">
                        Owner
                      </th>
                      <th className="text-left py-3 px-4 font-semibold">
                        Type
                      </th>
                      <th className="text-left py-3 px-4 font-semibold">
                        Scopes
                      </th>
                      <th className="text-left py-3 px-4 font-semibold">
                        Rate Limits
                      </th>
                      <th className="text-left py-3 px-4 font-semibold">
                        Last Used
                      </th>
                      <th className="text-left py-3 px-4 font-semibold">
                        Status
                      </th>
                      <th className="text-left py-3 px-4 font-semibold">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {apiKeys.map((key) => (
                      <tr key={key._id} className="border-b hover:bg-muted/50">
                        <td className="py-3 px-4 font-medium">{key.name}</td>
                        <td className="py-3 px-4 font-mono text-sm">
                          {key.keyPrefix}...
                        </td>
                        <td className="py-3 px-4">
                          {key.userId ? (
                            <div>
                              <p className="font-medium">{key.userId.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {key.userId.email}
                              </p>
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 mt-1">
                                {key.userId.role}
                              </span>
                            </div>
                          ) : key.customerId ? (
                            <div>
                              <p className="font-medium">
                                {key.customerId.firstName}{" "}
                                {key.customerId.lastName}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {key.customerId.email}
                              </p>
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 mt-1">
                                Customer
                              </span>
                            </div>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {key.userId && (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
                              Staff
                            </span>
                          )}
                          {key.customerId && (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">
                              Customer
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1">
                            {key.scopes.slice(0, 3).map((scope) => (
                              <span
                                key={scope}
                                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800"
                              >
                                {scope}
                              </span>
                            ))}
                            {key.scopes.length > 3 && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                                +{key.scopes.length - 3}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-sm">
                          <div>
                            <p>Key: {key.rateLimit.requestsPerHour}/hr</p>
                            <p className="text-xs text-muted-foreground">
                              Org: {key.rateLimit.orgRequestsPerHour}/hr
                            </p>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-sm text-muted-foreground">
                          {key.lastUsedAt
                            ? new Date(key.lastUsedAt).toLocaleDateString()
                            : "Never"}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${
                              key.isActive
                                ? "bg-green-100 text-green-800"
                                : "bg-red-100 text-red-800"
                            }`}
                          >
                            {key.isActive ? "Active" : "Revoked"}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex gap-2">
                            {key.isActive && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openRateLimitModal(key)}
                                >
                                  Edit Limits
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => handleRevoke(key._id)}
                                >
                                  Revoke
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Rate Limit Modal */}
        <Dialog open={showRateLimitModal} onOpenChange={setShowRateLimitModal}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Update Rate Limits</DialogTitle>
              <DialogDescription>
                Adjust the rate limits for this API key
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Key Rate Limit (requests per hour)
                </label>
                <input
                  type="number"
                  min="100"
                  max="50000"
                  step="100"
                  value={newRateLimits.requestsPerHour}
                  onChange={(e) =>
                    setNewRateLimits({
                      ...newRateLimits,
                      requestsPerHour: parseInt(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Maximum requests per hour for this specific key
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">
                  Organization Rate Limit (requests per hour)
                </label>
                <input
                  type="number"
                  min="100"
                  max="50000"
                  step="100"
                  value={newRateLimits.orgRequestsPerHour}
                  onChange={(e) =>
                    setNewRateLimits({
                      ...newRateLimits,
                      orgRequestsPerHour: parseInt(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Maximum requests per hour across all keys in the organization
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowRateLimitModal(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button onClick={handleUpdateRateLimit} disabled={saving}>
                {saving ? "Updating..." : "Update Rate Limits"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
