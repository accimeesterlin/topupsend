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
} from "@topupsend/ui";
import {
  RefreshCw,
  Filter,
  AlertCircle,
  CheckCircle,
  Clock,
  XCircle,
} from "lucide-react";

interface WebhookLog {
  _id: string;
  source: string;
  event: string;
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  requestBody: any;
  responseStatus?: number;
  responseBody?: any;
  error?: string;
  status: "pending" | "success" | "failed";
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: string;
  createdAt: string;
  updatedAt: string;
}

export default function WebhookLogsPage() {
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedLog, setSelectedLog] = useState<WebhookLog | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  useEffect(() => {
    loadLogs();
    // Auto-refresh every 30 seconds
    const interval = setInterval(() => {
      if (!showDetailModal) {
        loadLogs(true);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [page, filterStatus, filterSource]);

  const loadLogs = async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: "20",
      });

      if (filterStatus !== "all") params.append("status", filterStatus);
      if (filterSource !== "all") params.append("source", filterSource);

      const res = await fetch(`/api/v1/webhooks/logs?${params.toString()}`);

      if (!res.ok) {
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        throw new Error("Failed to load webhook logs");
      }

      const data = await res.json();
      setLogs(data.data || []);
      setHasMore(data.pagination?.hasNextPage || false);
    } catch (err: any) {
      setError(err.message || "Failed to load webhook logs");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleReplay = async (logId: string) => {
    if (!confirm("Are you sure you want to replay this webhook?")) return;

    try {
      const res = await fetch(`/api/v1/webhooks/logs/${logId}/replay`, {
        method: "POST",
      });

      if (!res.ok) {
        throw new Error("Failed to replay webhook");
      }

      await loadLogs();
      alert("Webhook replayed successfully");
    } catch (err: any) {
      setError(err.message || "Failed to replay webhook");
      setTimeout(() => setError(""), 5000);
    }
  };

  const viewDetails = (log: WebhookLog) => {
    setSelectedLog(log);
    setShowDetailModal(true);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case "failed":
        return <XCircle className="h-5 w-5 text-red-500" />;
      case "pending":
        return <Clock className="h-5 w-5 text-yellow-500" />;
      default:
        return <AlertCircle className="h-5 w-5 text-gray-500" />;
    }
  };

  const uniqueSources = Array.from(new Set(logs.map((log) => log.source)));

  if (loading && page === 1) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading webhook logs...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Webhook Logs</h1>
            <p className="text-muted-foreground mt-2">
              Monitor and manage webhook events
            </p>
          </div>
          <Button onClick={() => loadLogs(true)} disabled={refreshing}>
            <RefreshCw
              className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>

        {error && (
          <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded">
            {error}
          </div>
        )}

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <Filter className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Status
                  </label>
                  <select
                    value={filterStatus}
                    onChange={(e) => {
                      setFilterStatus(e.target.value);
                      setPage(1);
                    }}
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="all">All Statuses</option>
                    <option value="success">Success</option>
                    <option value="failed">Failed</option>
                    <option value="pending">Pending</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Source
                  </label>
                  <select
                    value={filterSource}
                    onChange={(e) => {
                      setFilterSource(e.target.value);
                      setPage(1);
                    }}
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="all">All Sources</option>
                    {uniqueSources.map((source) => (
                      <option key={source} value={source}>
                        {source}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Logs Table */}
        <Card>
          <CardHeader>
            <CardTitle>Webhook Events</CardTitle>
            <CardDescription>
              {logs.length} event{logs.length !== 1 ? "s" : ""} found
            </CardDescription>
          </CardHeader>
          <CardContent>
            {logs.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground text-lg">
                  No webhook logs found
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {logs.map((log) => (
                  <div
                    key={log._id}
                    className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3 flex-1">
                        {getStatusIcon(log.status)}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold">{log.event}</h3>
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                              {log.source}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground mb-2">
                            {log.method} {log.url}
                          </p>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span>
                              {new Date(log.createdAt).toLocaleString()}
                            </span>
                            <span>
                              Attempt {log.attempts}/{log.maxAttempts}
                            </span>
                            {log.responseStatus && (
                              <span
                                className={`font-semibold ${
                                  log.responseStatus >= 200 &&
                                  log.responseStatus < 300
                                    ? "text-green-600"
                                    : "text-red-600"
                                }`}
                              >
                                HTTP {log.responseStatus}
                              </span>
                            )}
                          </div>
                          {log.error && (
                            <p className="text-sm text-red-600 mt-2">
                              {log.error}
                            </p>
                          )}
                          {log.status === "pending" && log.nextRetryAt && (
                            <p className="text-sm text-yellow-600 mt-2">
                              Next retry:{" "}
                              {new Date(log.nextRetryAt).toLocaleString()}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => viewDetails(log)}
                        >
                          Details
                        </Button>
                        {log.status === "failed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleReplay(log._id)}
                          >
                            Replay
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Pagination */}
            {logs.length > 0 && (
              <div className="flex items-center justify-between mt-6 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1 || loading}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page}
                </span>
                <Button
                  variant="outline"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!hasMore || loading}
                >
                  Next
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Detail Modal */}
        <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Webhook Log Details</DialogTitle>
              <DialogDescription>
                Detailed information about this webhook event
              </DialogDescription>
            </DialogHeader>
            {selectedLog && (
              <div className="space-y-4">
                {/* Overview */}
                <div>
                  <h3 className="font-semibold mb-2">Overview</h3>
                  <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
                    <div>
                      <p className="text-sm text-muted-foreground">Event</p>
                      <p className="font-medium">{selectedLog.event}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Source</p>
                      <p className="font-medium">{selectedLog.source}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Status</p>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(selectedLog.status)}
                        <span className="font-medium capitalize">
                          {selectedLog.status}
                        </span>
                      </div>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Attempts</p>
                      <p className="font-medium">
                        {selectedLog.attempts} / {selectedLog.maxAttempts}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Request */}
                <div>
                  <h3 className="font-semibold mb-2">Request</h3>
                  <div className="p-4 bg-muted rounded-lg space-y-3">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">URL</p>
                      <p className="font-mono text-sm">
                        {selectedLog.method} {selectedLog.url}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">
                        Headers
                      </p>
                      <pre className="font-mono text-xs bg-background p-3 rounded border overflow-x-auto">
                        {JSON.stringify(selectedLog.requestHeaders, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Body</p>
                      <pre className="font-mono text-xs bg-background p-3 rounded border overflow-x-auto">
                        {JSON.stringify(selectedLog.requestBody, null, 2)}
                      </pre>
                    </div>
                  </div>
                </div>

                {/* Response */}
                {selectedLog.responseStatus && (
                  <div>
                    <h3 className="font-semibold mb-2">Response</h3>
                    <div className="p-4 bg-muted rounded-lg space-y-3">
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">
                          Status Code
                        </p>
                        <p
                          className={`font-semibold ${
                            selectedLog.responseStatus >= 200 &&
                            selectedLog.responseStatus < 300
                              ? "text-green-600"
                              : "text-red-600"
                          }`}
                        >
                          {selectedLog.responseStatus}
                        </p>
                      </div>
                      {selectedLog.responseBody && (
                        <div>
                          <p className="text-sm text-muted-foreground mb-1">
                            Body
                          </p>
                          <pre className="font-mono text-xs bg-background p-3 rounded border overflow-x-auto">
                            {JSON.stringify(selectedLog.responseBody, null, 2)}
                          </pre>
                        </div>
                      )}
                      {selectedLog.error && (
                        <div>
                          <p className="text-sm text-muted-foreground mb-1">
                            Error
                          </p>
                          <p className="text-sm text-red-600">
                            {selectedLog.error}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
