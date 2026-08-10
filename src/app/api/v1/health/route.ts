import { dbConnection } from '@topupsend/db/connection';
import { createSuccessResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';

interface HealthCheck {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  services: {
    api: {
      status: 'ok' | 'down';
      responseTime: number;
    };
    database: {
      status: 'ok' | 'down';
      responseTime?: number;
    };
  };
}

export async function GET() {
  const startTime = Date.now();

  try {
    // Check database connection
    const dbStart = Date.now();
    const isConnected = dbConnection.getConnectionStatus();
    const dbResponseTime = Date.now() - dbStart;

    const dbStatus = isConnected ? 'ok' : 'down';

    const health: HealthCheck = {
      status: dbStatus === 'down' ? 'degraded' : 'ok',
      timestamp: new Date().toISOString(),
      services: {
        api: {
          status: 'ok',
          responseTime: Date.now() - startTime,
        },
        database: {
          status: dbStatus,
          responseTime: dbResponseTime,
        },
      },
    };

    logger.info('Health check', { health });

    return createSuccessResponse(health);
  } catch (error) {
    logger.error('Health check failed', { error });

    const health: HealthCheck = {
      status: 'down',
      timestamp: new Date().toISOString(),
      services: {
        api: {
          status: 'ok',
          responseTime: Date.now() - startTime,
        },
        database: {
          status: 'down',
        },
      },
    };

    return createSuccessResponse(health, 503);
  }
}
