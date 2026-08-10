"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import {
  Button,
  Input,
  Label,
  Alert,
  AlertDescription,
  toast,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@topupsend/ui";

interface ApiKey {
  id: string;
  keyPrefix: string;
  name: string;
  scopes: string[];
  lastUsedAt?: string;
  createdAt: string;
  expiresAt?: string;
  isActive?: boolean;
}

export default function ApiKeysPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const [orgSlug, setOrgSlug] = useState<string>("");
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyData, setNewKeyData] = useState({
    name: "",
    scopes: [] as string[],
  });
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKey | null>(null);
  const router = useRouter();
  const { t } = useTranslation();

  const availableScopes = [
    { value: "balance:read", label: "Read Balance" },
    { value: "transactions:read", label: "Read Transactions" },
    { value: "transactions:create", label: "Create Transactions" },
    { value: "topup:send", label: "Send Top-ups" },
    { value: "customer:read", label: "Read Profile" },
    { value: "customer:update", label: "Update Profile" },
  ];

  useEffect(() => {
    params.then((p) => setOrgSlug(p.orgSlug));
  }, [params]);

  useEffect(() => {
    if (orgSlug) {
      loadApiKeys();
    }
  }, [orgSlug]);

  const loadApiKeys = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/api-keys?customer=true", {
        credentials: "include",
      });

      if (!res.ok) {
        if (res.status === 401) {
          router.push(`/customer-portal/${orgSlug}/login`);
          return;
        }
        throw new Error("Failed to load API keys");
      }

      const data = await res.json();
      setApiKeys(data.keys || data.data || []);
    } catch (err: any) {
      setError(err.message || t("api.keys.loadError"));
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setCreating(true);

    try {
      const res = await fetch("/api/v1/api-keys?customer=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(newKeyData),
      });

      const data = await res.json();
      console.log("API Response:", data);

      if (!res.ok) {
        throw new Error(
          data.error?.message || data.detail || "Failed to create API key",
        );
      }

      // The API returns the key directly in the response
      const fullKey = data.key;
      console.log("Full key:", fullKey);

      if (fullKey) {
        setCreatedKey(fullKey);
        setNewKeyData({ name: "", scopes: [] });
        await loadApiKeys();
      } else {
        console.error("No API key found in response:", data);
        throw new Error("API key was created but not returned in response");
      }
    } catch (err: any) {
      console.error("Create API key error:", err);
      setError(err.message || t("api.keys.createError"));
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async () => {
    if (!keyToRevoke) return;

    try {
      const res = await fetch(
        `/api/v1/api-keys/${keyToRevoke.id}?customer=true`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );

      if (!res.ok) {
        throw new Error("Failed to revoke API key");
      }

      await loadApiKeys();
      setKeyToRevoke(null);
      toast({
        title: "Success",
        description:
          t("api.keys.revokedSuccess") || "API key revoked successfully",
        variant: "success",
      });
    } catch (err: any) {
      setError(err.message || t("api.keys.revokeError"));
      setKeyToRevoke(null);
    }
  };

  const toggleScope = (scope: string) => {
    setNewKeyData((prev) => ({
      ...prev,
      scopes: prev.scopes.includes(scope)
        ? prev.scopes.filter((s) => s !== scope)
        : [...prev.scopes, scope],
    }));
  };

  const selectAllScopes = () => {
    setNewKeyData((prev) => ({
      ...prev,
      scopes: availableScopes.map((scope) => scope.value),
    }));
  };

  const deselectAllScopes = () => {
    setNewKeyData((prev) => ({
      ...prev,
      scopes: [],
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-gray-900">
            {t("api.keys.title")}
          </h1>
          <Button
            onClick={() => {
              setShowCreateModal(true);
              setCreatedKey(null);
            }}
          >
            {t("api.keys.createNew")}
          </Button>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {apiKeys.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg">{t("api.keys.noKeys")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t("api.keys.table.name")}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t("api.keys.table.key")}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t("api.keys.table.scopes")}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t("api.keys.table.lastUsed")}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t("api.keys.table.status")}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t("api.keys.table.actions")}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {apiKeys.map((key) => (
                  <tr key={key.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {key.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
                      {key.keyPrefix}...
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      <div className="flex flex-wrap gap-1">
                        {key.scopes.map((scope) => (
                          <span
                            key={scope}
                            className="px-2 py-1 text-xs font-semibold rounded-full bg-primary/10 text-primary"
                          >
                            {scope}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {key.lastUsedAt
                        ? new Date(key.lastUsedAt).toLocaleDateString()
                        : t("api.keys.table.neverUsed")}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          key.isActive !== false
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {key.isActive !== false
                          ? t("api.keys.table.active")
                          : t("api.keys.table.revoked")}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      {key.isActive !== false && (
                        <button
                          onClick={() => setKeyToRevoke(key)}
                          className="text-red-600 hover:text-red-900"
                        >
                          {t("api.keys.table.revoke")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create API Key Modal */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="max-w-md">
          {createdKey ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("api.keys.modal.keyCreated")}</DialogTitle>
              </DialogHeader>
              <div className="bg-yellow-50 border border-yellow-200 p-4 rounded my-4">
                <p className="text-sm text-yellow-800 mb-2">
                  {t("api.keys.modal.copyWarning")}
                </p>
                <div className="bg-white p-3 rounded border border-yellow-300 font-mono text-sm break-all">
                  {createdKey}
                </div>
              </div>
              <DialogFooter className="flex-col sm:flex-col gap-2">
                <Button
                  onClick={() => {
                    navigator.clipboard.writeText(createdKey);
                    toast({
                      title: "Copied!",
                      description: t("api.keys.modal.copied"),
                      variant: "success",
                    });
                  }}
                  className="w-full"
                >
                  {t("api.keys.modal.copyKey")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowCreateModal(false);
                    setCreatedKey(null);
                  }}
                  className="w-full"
                >
                  {t("api.keys.modal.close")}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t("api.keys.modal.createTitle")}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <Label className="mb-1">{t("api.keys.modal.keyName")}</Label>
                  <Input
                    type="text"
                    required
                    value={newKeyData.name}
                    onChange={(e) =>
                      setNewKeyData({ ...newKeyData, name: e.target.value })
                    }
                    placeholder={t("api.keys.modal.keyNamePlaceholder")}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>{t("api.keys.modal.selectScopes")}</Label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={selectAllScopes}
                        className="text-xs text-primary hover:underline font-medium"
                      >
                        Select All
                      </button>
                      <span className="text-xs text-gray-400">|</span>
                      <button
                        type="button"
                        onClick={deselectAllScopes}
                        className="text-xs text-primary hover:underline font-medium"
                      >
                        Deselect All
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto border rounded-md p-3">
                    {availableScopes.map((scope) => (
                      <label
                        key={scope.value}
                        className="flex items-center cursor-pointer hover:bg-gray-50 p-2 rounded transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={newKeyData.scopes.includes(scope.value)}
                          onChange={() => toggleScope(scope.value)}
                          className="mr-2 h-4 w-4 text-primary focus:ring-ring border-input rounded cursor-pointer"
                        />
                        <span className="text-sm text-gray-700">
                          {scope.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <DialogFooter className="flex gap-2">
                  <Button
                    type="submit"
                    disabled={newKeyData.scopes.length === 0 || creating}
                    className="flex-1"
                  >
                    {creating ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2"></div>
                        Creating...
                      </>
                    ) : (
                      t("api.keys.modal.create")
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowCreateModal(false)}
                    className="flex-1"
                    disabled={creating}
                  >
                    {t("api.keys.modal.cancel")}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Revoke Confirmation Dialog */}
      <AlertDialog
        open={!!keyToRevoke}
        onOpenChange={(open: boolean) => !open && setKeyToRevoke(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API Key?</AlertDialogTitle>
            <AlertDialogDescription>
              {t("api.keys.revokeConfirm") ||
                "Are you sure you want to revoke this API key? This action cannot be undone and the key will immediately stop working."}
              {keyToRevoke && (
                <div className="mt-2 p-2 bg-muted rounded text-sm font-mono">
                  {keyToRevoke.name}
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              className="bg-red-600 hover:bg-red-700"
            >
              Revoke Key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
