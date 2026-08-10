import { createSuccessResponse } from '@/lib/api-response';

export async function GET() {
  return createSuccessResponse({
    name: 'TopUpSend API',
    version: '1.0.0',
    apiVersion: 'v1',
    endpoints: {
      health: '/api/v1/health',
      live: '/api/v1/live',
      ready: '/api/v1/ready',
      auth: {
        signup: '/api/v1/auth/signup',
        login: '/api/v1/auth/login',
        logout: '/api/v1/auth/logout',
        me: '/api/v1/auth/me',
      },
    },
  });
}
