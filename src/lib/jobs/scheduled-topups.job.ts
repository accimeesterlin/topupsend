/**
 * Scheduled Top-ups Cron Job
 * Runs every 5 minutes to process due scheduled top-ups
 */

import cron from 'node-cron';
import { processScheduledTopups } from '@/lib/services/scheduled-topups.service';
import { logger } from '@/lib/logger';

// Track if job is already running to prevent overlapping executions
let isJobRunning = false;

/**
 * Cron job to process scheduled top-ups
 * Runs every 5 minutes
 */
export function initScheduledTopupsJob() {
  // Only run in production or if explicitly enabled
  const isEnabled = process.env.SCHEDULED_TOPUPS_ENABLED !== 'false';

  if (!isEnabled) {
    logger.info('Scheduled top-ups job is disabled');
    return;
  }

  // Default: every 5 minutes
  const cronSchedule = process.env.SCHEDULED_TOPUPS_CRON || '*/5 * * * *';

  logger.info('Initializing scheduled top-ups cron job', { schedule: cronSchedule });

  const job = cron.schedule(
    cronSchedule,
    async () => {
      // Prevent overlapping executions
      if (isJobRunning) {
        logger.warn('Scheduled top-ups job is already running, skipping this execution');
        return;
      }

      isJobRunning = true;
      const startTime = Date.now();

      try {
        logger.info('Starting scheduled top-ups job execution');

        const results = await processScheduledTopups();

        const successCount = results.filter((r) => r.success).length;
        const failureCount = results.filter((r) => !r.success).length;
        const duration = Date.now() - startTime;

        logger.info('Scheduled top-ups job completed', {
          total: results.length,
          success: successCount,
          failed: failureCount,
          duration: `${duration}ms`,
        });

        // Log individual failures
        results
          .filter((r) => !r.success)
          .forEach((result) => {
            logger.error('Scheduled top-up execution failed', {
              scheduleId: result.scheduleId,
              error: result.error,
            });
          });
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Scheduled top-ups job failed', {
          error: errorMessage,
          duration: `${Date.now() - startTime}ms`,
        });
      } finally {
        isJobRunning = false;
      }
    },
    {
      timezone: 'UTC',
    }
  );

  logger.info('Scheduled top-ups cron job initialized successfully');

  return job;
}

/**
 * Gracefully stop the cron job
 */
export function stopScheduledTopupsJob(job: any) {
  if (job) {
    job.stop();
    logger.info('Scheduled top-ups cron job stopped');
  }
}
