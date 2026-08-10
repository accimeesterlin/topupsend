import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbConnection } from '@topupsend/db/connection';
import { Integration } from '@topupsend/db';

/**
 * PATCH /api/v1/integrations/[id]/primary
 * Set or unset an email provider as primary
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    console.log('[SET PRIMARY] Request received');

    const session = await getSession();
    if (!session) {
      console.log('[SET PRIMARY] Unauthorized - no session');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { isPrimaryEmail } = await request.json();
    console.log('[SET PRIMARY] isPrimaryEmail:', isPrimaryEmail);

    await dbConnection.connect();

    // Await params in Next.js 15
    const params = await context.params;
    console.log('[SET PRIMARY] Integration ID:', params.id);

    // Find the integration
    const integration = await Integration.findById(params.id);
    console.log('[SET PRIMARY] Integration found:', !!integration);
    if (integration) {
      console.log('[SET PRIMARY] Integration details:', {
        id: integration._id,
        provider: integration.provider,
        orgId: integration.orgId,
        currentIsPrimary: integration.isPrimaryEmail,
      });
      console.log('[SET PRIMARY] Session orgId:', session.orgId);
      console.log('[SET PRIMARY] OrgId match:', integration.orgId === session.orgId);
      console.log('[SET PRIMARY] OrgId types:', typeof integration.orgId, typeof session.orgId);
    }

    if (!integration) {
      return NextResponse.json({ error: 'Integration not found' }, { status: 404 });
    }

    // Verify it belongs to the user's organization
    if (integration.orgId !== session.orgId) {
      console.log('[SET PRIMARY] Authorization failed - orgId mismatch');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Validate that only email providers can be set as primary
    const emailProviders = ['zeptomail', 'mailgun', 'sendgrid', 'mailchimp'];
    if (!emailProviders.includes(integration.provider)) {
      return NextResponse.json(
        { error: 'Only email providers can be set as primary' },
        { status: 400 }
      );
    }

    // If setting as primary, unset any existing primary email providers
    if (isPrimaryEmail) {
      console.log('[SET PRIMARY] Unsetting existing primary providers');
      const updateResult = await Integration.updateMany(
        {
          orgId: session.orgId,
          provider: { $in: emailProviders },
          isPrimaryEmail: true,
        },
        {
          $set: { isPrimaryEmail: false },
        }
      );
      console.log('[SET PRIMARY] Unset result:', updateResult);
    }

    // Update this integration
    console.log('[SET PRIMARY] Before update - isPrimaryEmail:', integration.isPrimaryEmail);
    integration.isPrimaryEmail = isPrimaryEmail;
    console.log('[SET PRIMARY] After assignment - isPrimaryEmail:', integration.isPrimaryEmail);

    const saveResult = await integration.save();
    console.log('[SET PRIMARY] Save result:', {
      id: saveResult._id,
      provider: saveResult.provider,
      isPrimaryEmail: saveResult.isPrimaryEmail,
    });

    // Verify the save by re-fetching
    const verification = await Integration.findById(params.id);
    console.log('[SET PRIMARY] Verification fetch - isPrimaryEmail:', verification?.isPrimaryEmail);

    console.log('[SET PRIMARY] Successfully updated, isPrimaryEmail:', integration.isPrimaryEmail);

    return NextResponse.json({
      success: true,
      integration: {
        id: integration._id,
        provider: integration.provider,
        isPrimaryEmail: integration.isPrimaryEmail,
      },
    });
  } catch (error) {
    console.error('Set primary error:', error);
    return NextResponse.json(
      { error: 'Failed to update primary email provider' },
      { status: 500 }
    );
  }
}
