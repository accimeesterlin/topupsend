"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { SubscriptionTier } from "@/lib/pricing";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Input,
  Label,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@topupsend/ui";

interface DeveloperApp {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  activeKeyCount: number;
  createdAt: string;
}

export default function DevelopersPage() {
  const [apps, setApps] = useState<DeveloperApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiAccess, setApiAccess] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Feature gate: API access is a Growth+ plan feature. The
      // subscription endpoint returns the effective tier features
      // directly (no envelope wrapper).
      const subRes = await fetch("/api/v1/subscriptions/current", {
        cache: "no-store",
      });
      if (subRes.ok) {
        const sub = await subRes.json();
        setApiAccess(Boolean(sub?.features?.apiAccess));
      } else {
        setApiAccess(false);
      }

      const res = await fetch("/api/v1/apps");
      if (!res.ok) {
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        throw new Error("Failed to load apps");
      }
      const data = await res.json();
      setApps(data.apps || []);
    } catch (err: any) {
      setError(err.message || "Failed to load apps");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/v1/apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || data.error || "Failed to create app");
      }
      setShowCreate(false);
      setForm({ name: "", description: "" });
      await load();
    } catch (err: any) {
      setError(err.message || "Failed to create app");
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
            <p className="text-muted-foreground">Loading developer apps...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold">Developers</h1>
            <p className="text-muted-foreground mt-2">
              Create apps and API keys to integrate TopUpSend with your
              own systems.
            </p>
          </div>
          {apiAccess && (
            <Button onClick={() => setShowCreate(true)}>Create App</Button>
          )}
        </div>

        {error && (
          <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded">
            {error}
          </div>
        )}

        {apiAccess === false ? (
          <UpgradePrompt
            targetTier={SubscriptionTier.GROWTH}
            reason="API access is not included in your current plan. Upgrade to create developer apps and API keys."
            featureBlocked="Developer apps & API keys"
            dismissible={false}
          />
        ) : apps.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground text-lg">No apps yet</p>
              <p className="text-muted-foreground mt-2">
                Create your first app to get an API key and start
                integrating.
              </p>
              <Button className="mt-6" onClick={() => setShowCreate(true)}>
                Create App
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {apps.map((app) => (
              <Link key={app.id} href={`/dashboard/developers/${app.id}`}>
                <Card className="hover:bg-muted/50 transition-colors h-full">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      {app.name}
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${
                          app.isActive
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {app.isActive ? "Active" : "Deactivated"}
                      </span>
                    </CardTitle>
                    <CardDescription>
                      {app.description || "No description"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {app.activeKeyCount} active API key
                      {app.activeKeyCount === 1 ? "" : "s"} · Created{" "}
                      {new Date(app.createdAt).toLocaleDateString()}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}

        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create App</DialogTitle>
              <DialogDescription>
                Apps group your API keys. You can create keys for the
                app on the next screen.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="app-name">Name</Label>
                <Input
                  id="app-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. PGecom integration"
                  maxLength={100}
                />
              </div>
              <div>
                <Label htmlFor="app-description">Description (optional)</Label>
                <textarea
                  id="app-description"
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  placeholder="What will this app do?"
                  maxLength={500}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowCreate(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={saving || !form.name.trim()}
              >
                {saving ? "Creating..." : "Create App"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
