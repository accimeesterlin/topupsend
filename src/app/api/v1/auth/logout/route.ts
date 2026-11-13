import { NextRequest } from 'next/server';
import { dbConnection } from '@topupsend/db/connection';
import { User } from '@topupsend/db';
import { clearSessionCookie, getSession } from '@/lib/auth';
import { createNoContentResponse } from '@/lib/api-response';
import { handleApiError } from '@/lib/api-error';
import { logger } from '@/lib/logger';
import { clearSentryUser } from '@/lib/sentry-utils';

export async function POST(_request: NextRequest) {
  try {
    logger.info('User logged out');

    // Revoke the session server-side (F-M1): bump the user's token
    // version so the token being logged out — and every other token
    // minted at the same version, i.e. the user's other sessions —
    // fails requireAuth revalidation, instead of staying valid for
    // its full 7-day life after the cookie is gone. Best-effort:
    // logout itself never fails because of it.
    try {
      const session = await getSession();
      if (session) {
        await dbConnection.connect();
        await User.updateOne(
          { _id: session.userId },
          { $inc: { tokenVersion: 1 } }
        );
      }
    } catch (revokeError) {
      logger.warn('Failed to revoke sessions on logout', {
        error: revokeError,
      });
    }

    // Clear Sentry user context
    clearSentryUser();

    const response = createNoContentResponse();
    response.headers.set('Set-Cookie', clearSessionCookie());

    return response;
  } catch (error) {
    logger.error('Logout error', { error });
    return handleApiError(error);
  }
}
