import { NextRequest } from 'next/server';
import { dbConnection } from '@topupsend/db/connection';
import { Org, StorefrontSettings, Integration } from '@topupsend/db';
import { createSuccessResponse } from '@/lib/api-response';

/**
 * GET /api/v1/debug/org-check
 * Check organization setup status
 */
export async function GET(_request: NextRequest) {
  try {
    await dbConnection.connect();

    const orgs = await Org.find({}).select('name slug _id').limit(10);

    const orgDetails = await Promise.all(
      orgs.map(async (org) => {
        const storefront = await StorefrontSettings.findOne({ orgId: org._id });
        const integration = await Integration.findOne({
          orgId: org._id,
          provider: 'dingconnect'
        }).select('status provider');

        return {
          id: org._id.toString(),
          name: org.name,
          slug: org.slug || 'NO SLUG',
          hasStorefront: !!storefront,
          storefrontActive: storefront?.isActive || false,
          hasIntegration: !!integration,
          integrationStatus: integration?.status || 'none',
        };
      })
    );

    return createSuccessResponse({
      totalOrgs: orgs.length,
      organizations: orgDetails,
    });
  } catch (error: any) {
    return createSuccessResponse({
      error: error.message,
      stack: error.stack,
    }, 500);
  }
}
