"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Input,
  Label,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@topupsend/ui";

// Mirrors APP_KEY_SCOPES in src/lib/developer-apps.ts (kept local so
// the client bundle never imports the server-side lib).
const APP_KEY_SCOPES = [
  { value: "balance:read", label: "Read Balance" },
  { value: "transactions:read", label: "Read Transactions" },
  { value: "transactions:create", label: "Create Transactions" },
  { value: "topup:send", label: "Send Top-ups" },
  { value: "customer:read", label: "Read Customers" },
  { value: "customer:update", label: "Update Customers" },
];

interface DeveloperApp {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  activeKeyCount: number;
  createdAt: string;
}

interface AppKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  usageCount: number;
  isActive: boolean;
  createdAt: string;
}

export default function DeveloperAppDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const appId = params.id;

  const [app, setApp] = useState<DeveloperApp | null>(null);
  const [keys, setKeys] = useState<AppKey[]>([]);
  const [orgSlug, setOrgSlug] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreateKey, setShowCreateKey] = useState(false);
  const [keyForm, setKeyForm] = useState({ name: "", scopes: [] as string[] });
  const [saving, setSaving] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [appRes, keysRes, orgRes] = await Promise.all([
        fetch(`/api/v1/apps/${appId}`),
        fetch(`/api/v1/apps/${appId}/keys`),
        fetch("/api/v1/organization"),
      ]);
      if (appRes.status === 401) {
        router.push("/login");
        return;
      }
      if (!appRes.ok) throw new Error("App not found");
      const appData = await appRes.json();
      setApp(appData.app);
      if (keysRes.ok) {
        const keysData = await keysRes.json();
        setKeys(keysData.keys || []);
      }
      if (orgRes.ok) {
        const org = await orgRes.json();
        setOrgSlug(org.slug || "");
      }
    } catch (err: any) {
      setError(err.message || "Failed to load app");
    } finally {
      setLoading(false);
    }
  }, [appId, router]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleScope = (scope: string) => {
    setKeyForm((f) => ({
      ...f,
      scopes: f.scopes.includes(scope)
        ? f.scopes.filter((s) => s !== scope)
        : [...f.scopes, scope],
    }));
  };

  const handleCreateKey = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/apps/${appId}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: keyForm.name, scopes: keyForm.scopes }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || data.error || "Failed to create key");
      }
      const data = await res.json();
      setShowCreateKey(false);
      setKeyForm({ name: "", scopes: [] });
      // The plaintext secret comes back exactly once — show it in the
      // modal and never store it anywhere else.
      setCreatedSecret(data.key);
      await load();
    } catch (err: any) {
      setError(err.message || "Failed to create key");
      setTimeout(() => setError(""), 5000);
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async (keyId: string) => {
    if (!confirm("Revoke this API key? Integrations using it will stop working."))
      return;
    try {
      const res = await fetch(`/api/v1/api-keys/${keyId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to revoke key");
      await load();
    } catch (err: any) {
      setError(err.message || "Failed to revoke key");
      setTimeout(() => setError(""), 5000);
    }
  };

  const handleDeactivate = async () => {
    if (
      !confirm(
        "Deactivate this app? All of its API keys will be revoked immediately.",
      )
    )
      return;
    try {
      const res = await fetch(`/api/v1/apps/${appId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to deactivate app");
      router.push("/dashboard/developers");
    } catch (err: any) {
      setError(err.message || "Failed to deactivate app");
      setTimeout(() => setError(""), 5000);
    }
  };

  const copySecret = async () => {
    if (!createdSecret) return;
    try {
      await navigator.clipboard.writeText(createdSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable; the secret stays visible for manual copy.
    }
  };

  const baseUrl =
    typeof window !== "undefined" ? window.location.origin : "";

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading app...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!app) {
    return (
      <DashboardLayout>
        <div className="space-y-4">
          <h1 className="text-3xl font-bold">App not found</h1>
          <p className="text-muted-foreground">
            This app does not exist or belongs to another organization.
          </p>
          <Link href="/dashboard/developers">
            <Button variant="outline">Back to Developers</Button>
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <Link
              href="/dashboard/developers"
              className="text-sm text-muted-foreground hover:underline"
            >
              ← Developers
            </Link>
            <h1 className="text-3xl font-bold mt-1">{app.name}</h1>
            <p className="text-muted-foreground mt-2">
              {app.description || "No description"}
            </p>
          </div>
          {app.isActive && (
            <Button variant="destructive" onClick={handleDeactivate}>
              Deactivate App
            </Button>
          )}
        </div>

        {error && (
          <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded">
            {error}
          </div>
        )}

        {!app.isActive && (
          <div className="bg-yellow-50 border border-yellow-300 text-yellow-900 px-4 py-3 rounded">
            This app is deactivated and all of its keys have been revoked.
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              API Keys
              {app.isActive && (
                <Button size="sm" onClick={() => setShowCreateKey(true)}>
                  Create Key
                </Button>
              )}
            </CardTitle>
            <CardDescription>
              Keys authenticate as this app and act on your organization.
              Secrets are shown once, at creation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {keys.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No API keys yet. Create one to start integrating.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 font-semibold">Name</th>
                      <th className="text-left py-3 px-4 font-semibold">Key</th>
                      <th className="text-left py-3 px-4 font-semibold">Scopes</th>
                      <th className="text-left py-3 px-4 font-semibold">Last Used</th>
                      <th className="text-left py-3 px-4 font-semibold">Usage</th>
                      <th className="text-left py-3 px-4 font-semibold">Status</th>
                      <th className="text-left py-3 px-4 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((key) => (
                      <tr key={key.id} className="border-b hover:bg-muted/50">
                        <td className="py-3 px-4 font-medium">{key.name}</td>
                        <td className="py-3 px-4 font-mono text-sm">
                          {key.keyPrefix}...
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1">
                            {key.scopes.map((scope) => (
                              <Badge key={scope} variant="secondary">
                                {scope}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-sm text-muted-foreground">
                          {key.lastUsedAt
                            ? new Date(key.lastUsedAt).toLocaleDateString()
                            : "Never"}
                        </td>
                        <td className="py-3 px-4 text-sm">{key.usageCount}</td>
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
                          {key.isActive && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleRevoke(key.id)}
                            >
                              Revoke
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quickstart</CardTitle>
            <CardDescription>
              Authenticate with your API key on every request. The key
              determines the organization — never send an org id.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-1">Base URL</p>
              <code className="block bg-muted rounded px-3 py-2 text-sm overflow-x-auto">
                {baseUrl}/api/v1
              </code>
            </div>
            <div>
              <p className="text-sm font-medium mb-1">Look up a phone number</p>
              <pre className="bg-muted rounded px-3 py-2 text-sm overflow-x-auto">{`curl -X POST ${baseUrl}/api/v1/partner/lookup \\
  -H "X-API-Key: <redacted>" \\
  -H "Content-Type: application/json" \\
  -d '{"phoneNumber": "+50937000000"}'`}</pre>
            </div>
            <div>
              <p className="text-sm font-medium mb-1">Send a top-up</p>
              <pre className="bg-muted rounded px-3 py-2 text-sm overflow-x-auto">{`curl -X POST ${baseUrl}/api/v1/partner/topups \\
  -H "X-API-Key: <redacted>" \\
  -H "Idempotency-Key: order-123" \\
  -H "Content-Type: application/json" \\
  -d '{"phoneNumber": "+50937000000", "skuCode": "<product SKU>", "sendValue": 10}'`}</pre>
            </div>
            {orgSlug && (
              <p className="text-sm">
                Full reference:{" "}
                <Link
                  href={`/api-docs/${orgSlug}`}
                  className="text-primary hover:underline"
                >
                  API documentation
                </Link>
              </p>
            )}
          </CardContent>
        </Card>

        {/* Create Key dialog */}
        <Dialog open={showCreateKey} onOpenChange={setShowCreateKey}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create API Key</DialogTitle>
              <DialogDescription>
                Choose the scopes this key needs. The secret is shown
                once, right after creation.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="key-name">Name</Label>
                <Input
                  id="key-name"
                  value={keyForm.name}
                  onChange={(e) =>
                    setKeyForm({ ...keyForm, name: e.target.value })
                  }
                  placeholder="e.g. Production key"
                  maxLength={100}
                />
              </div>
              <div>
                <Label>Scopes</Label>
                <div className="space-y-2 mt-2">
                  {APP_KEY_SCOPES.map((scope) => (
                    <label
                      key={scope.value}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={keyForm.scopes.includes(scope.value)}
                        onChange={() => toggleScope(scope.value)}
                        className="h-4 w-4"
                      />
                      {scope.label}
                      <span className="text-muted-foreground">
                        ({scope.value})
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowCreateKey(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateKey}
                disabled={
                  saving || !keyForm.name.trim() || keyForm.scopes.length === 0
                }
              >
                {saving ? "Creating..." : "Create Key"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Show-once secret modal */}
        <Dialog
          open={createdSecret !== null}
          onOpenChange={(open) => {
            if (!open) setCreatedSecret(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Your new API key</DialogTitle>
              <DialogDescription>
                Store this key securely — you won&apos;t be able to see
                it again.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <code className="block bg-muted rounded px-3 py-2 text-sm break-all">
                {createdSecret}
              </code>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={copySecret}>
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button onClick={() => setCreatedSecret(null)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
