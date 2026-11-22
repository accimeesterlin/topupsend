"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/LanguageContext";

interface ApiKey {
  id: string;
  keyPrefix: string;
  name: string;
  scopes: string[];
  lastUsedAt?: string;
  createdAt: string;
  isActive?: boolean;
}

export default function MyApiKeysPage() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyData, setNewKeyData] = useState({
    name: "",
    scopes: [] as string[],
  });
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const router = useRouter();
  const { } = useTranslation();

  const staffScopes = [
    { value: "balance:read", label: "Read Balance" },
    { value: "transactions:read", label: "Read Transactions" },
    { value: "transactions:create", label: "Create Transactions" },
    { value: "topup:send", label: "Send Top-ups" },
    { value: "customer:read", label: "Read Customers" },
    { value: "customer:update", label: "Update Customers" },
  ];

  useEffect(() => {
    loadApiKeys();
  }, []);

  const loadApiKeys = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/api-keys?userOnly=true");

      if (!res.ok) {
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        throw new Error("Failed to load API keys");
      }

      const data = await res.json();
      // The API returns the list flat at the top level: { keys: [...] }
      setApiKeys(data.keys || []);
    } catch (err: any) {
      setError(err.message || "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      const res = await fetch("/api/v1/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newKeyData),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data.error?.message || data.detail || "Failed to create API key",
        );
      }

      // The API returns the created key flat at the top level:
      // { message, key, apiKey: {...} } — the one-time secret is `key`.
      const fullKey = data.key;

      if (!fullKey) {
        throw new Error("API key was created but not returned in response");
      }

      setCreatedKey(fullKey);
      setNewKeyData({ name: "", scopes: [] });
      await loadApiKeys();
    } catch (err: any) {
      setError(err.message || "Failed to create API key");
    }
  };

  const handleRevoke = async (keyId: string) => {
    if (!confirm("Are you sure you want to revoke this API key?")) return;

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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-12rem)]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-gray-900">My API Keys</h1>
        <button
          onClick={() => {
            setShowCreateModal(true);
            setCreatedKey(null);
          }}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Create New Key
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-lg p-6">
        {apiKeys.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg">No API keys found</p>
            <p className="text-gray-400 text-sm mt-2">
              Create your first API key to get started
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Key
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Scopes
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Last Used
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
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
                            className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800"
                          >
                            {scope}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {key.lastUsedAt
                        ? new Date(key.lastUsedAt).toLocaleDateString()
                        : "Never used"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          key.isActive !== false
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {key.isActive !== false ? "Active" : "Revoked"}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      {key.isActive !== false && (
                        <button
                          onClick={() => handleRevoke(key.id)}
                          className="text-red-600 hover:text-red-900"
                        >
                          Revoke
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
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full">
            {createdKey ? (
              <>
                <h2 className="text-xl font-bold text-gray-900 mb-4">
                  API Key Created!
                </h2>
                <div className="bg-yellow-50 border border-yellow-200 p-4 rounded mb-4">
                  <p className="text-sm text-yellow-800 mb-2">
                    ⚠️ Copy this key now. You won't be able to see it again!
                  </p>
                  <div className="bg-white p-3 rounded border border-yellow-300 font-mono text-sm break-all">
                    {createdKey}
                  </div>
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(createdKey);
                    alert("API key copied to clipboard!");
                  }}
                  className="w-full mb-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Copy to Clipboard
                </button>
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    setCreatedKey(null);
                  }}
                  className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                >
                  Close
                </button>
              </>
            ) : (
              <>
                <h2 className="text-xl font-bold text-gray-900 mb-4">
                  Create API Key
                </h2>
                <form onSubmit={handleCreate} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Key Name
                    </label>
                    <input
                      type="text"
                      required
                      value={newKeyData.name}
                      onChange={(e) =>
                        setNewKeyData({ ...newKeyData, name: e.target.value })
                      }
                      placeholder="My API Key"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Select Scopes
                    </label>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {staffScopes.map((scope) => (
                        <label key={scope.value} className="flex items-center">
                          <input
                            type="checkbox"
                            checked={newKeyData.scopes.includes(scope.value)}
                            onChange={() => toggleScope(scope.value)}
                            className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                          />
                          <span className="text-sm text-gray-700">
                            {scope.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="flex space-x-2">
                    <button
                      type="submit"
                      disabled={newKeyData.scopes.length === 0}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Create
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCreateModal(false)}
                      className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
