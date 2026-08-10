/**
 * Webhook Logging Service
 * Wraps webhook handlers to automatically log events and handle retries
 */

import {
  WebhookLog,
  type WebhookSource,
  type IWebhookLog,
} from "@topupsend/db";

export class WebhookLoggingService {
  /**
   * Log incoming webhook
   */
  async logIncoming(params: {
    orgId: string;
    event: string;
    source: WebhookSource;
    payload: any;
    headers?: Record<string, string>;
    signature?: string;
    ipAddress?: string;
    transactionId?: string;
    customerId?: string;
  }): Promise<IWebhookLog> {
    return await WebhookLog.create({
      orgId: params.orgId,
      event: params.event,
      source: params.source,
      payload: params.payload,
      headers: params.headers,
      signature: params.signature,
      ipAddress: params.ipAddress,
      transactionId: params.transactionId,
      customerId: params.customerId,
      status: "pending",
      attempts: 0,
      maxAttempts: 6,
      retrySchedule: [1, 5, 15, 60, 360], // 1min, 5min, 15min, 1hr, 6hr
    });
  }

  /**
   * Mark webhook as successfully processed
   */
  async markSuccess(
    webhookLogId: string,
    responseCode: number = 200,
    responseBody?: any,
    duration?: number,
  ): Promise<void> {
    const webhookLog = await WebhookLog.findById(webhookLogId);

    if (webhookLog) {
      await webhookLog.markSuccess(responseCode, responseBody, duration);
    }
  }

  /**
   * Mark webhook as failed and schedule retry
   */
  async markFailed(
    webhookLogId: string,
    errorMessage: string,
    responseCode?: number,
  ): Promise<void> {
    const webhookLog = await WebhookLog.findById(webhookLogId);

    if (webhookLog) {
      await webhookLog.markFailed(errorMessage, responseCode);
    }
  }

  /**
   * Get pending webhooks for retry
   */
  async getPendingRetries(): Promise<IWebhookLog[]> {
    return await WebhookLog.find({
      status: "retrying",
      nextRetryAt: { $lte: new Date() },
    }).limit(100);
  }

  /**
   * Get webhook logs for an organization
   */
  async getLogsByOrg(
    orgId: string,
    options?: {
      source?: WebhookSource;
      status?: string;
      limit?: number;
      skip?: number;
    },
  ): Promise<{ logs: IWebhookLog[]; total: number }> {
    const query: any = { orgId };

    if (options?.source) {
      query.source = options.source;
    }

    if (options?.status) {
      query.status = options.status;
    }

    const [logs, total] = await Promise.all([
      WebhookLog.find(query)
        .sort({ createdAt: -1 })
        .limit(options?.limit || 50)
        .skip(options?.skip || 0),
      WebhookLog.countDocuments(query),
    ]);

    return { logs, total };
  }

  /**
   * Get webhook log by ID
   */
  async getLogById(id: string): Promise<IWebhookLog | null> {
    return await WebhookLog.findById(id);
  }

  /**
   * Replay a webhook
   */
  async replay(id: string): Promise<{ success: boolean; error?: string }> {
    const webhookLog = await WebhookLog.findById(id);

    if (!webhookLog) {
      return { success: false, error: "Webhook log not found" };
    }

    // Reset status to pending
    webhookLog.status = "pending";
    webhookLog.attempts = 0;
    webhookLog.nextRetryAt = undefined;
    webhookLog.errorMessage = undefined;
    await webhookLog.save();

    // Here you would trigger the actual webhook processing again
    // This depends on your webhook handler architecture

    return { success: true };
  }

  /**
   * Clean up old webhook logs (older than 90 days)
   */
  async cleanup(daysToKeep: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await WebhookLog.deleteMany({
      createdAt: { $lt: cutoffDate },
      status: { $in: ["success", "failed"] },
    });

    return result.deletedCount || 0;
  }
}

// Singleton instance
export const webhookLoggingService = new WebhookLoggingService();
