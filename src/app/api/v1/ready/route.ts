import { dbConnection } from '@topupsend/db/connection';
import { createSuccessResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';

/**
 * Readiness probe - returns 200 if the server is ready to accept traffic
 * Checks database connectivity
 */
export async function GET() {
  try {
    const isConnected = dbConnection.getConnectionStatus();

    if (!isConnected) {
      logger.warn('Readiness check failed: database not connected');
      return createSuccessResponse(
        {
          status: 'not_ready',
          timestamp: new Date().toISOString(),
          reason: 'Database not connected',
        },
        503
      );
    }

    return createSuccessResponse({
      status: 'ready',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Readiness check error', { error });

    return createSuccessResponse(
      {
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        reason: 'Service unavailable',
      },
      503
    );
  }
}
