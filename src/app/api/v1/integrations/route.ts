import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbConnection } from '@topupsend/db/connection';
import { Integration } from '@topupsend/db';

// GET all integrations for the organization
export async function GET(_request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnection.connect();

    const integrations = await Integration.find({ orgId: session.orgId });

    console.log('[GET INTEGRATIONS] Found integrations:', integrations.map(i => ({
      id: i._id,
      provider: i.provider,
      isPrimaryEmail: i.isPrimaryEmail,
    })));

    // Don't return credentials for security (but baseUrl is okay as it's not sensitive)
    const safeIntegrations = integrations.map((integration) => ({
      id: integration._id,
      provider: integration.provider,
      status: integration.status,
      environment: integration.environment,
      isPrimaryEmail: integration.isPrimaryEmail || false,
      baseUrl: integration.credentials?.baseUrl,
      fromEmail: integration.credentials?.fromEmail,
      fromName: integration.credentials?.fromName,
      metadata: integration.metadata,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
    }));

    console.log('[GET INTEGRATIONS] Returning safe integrations:', safeIntegrations.map(i => ({
      id: i.id,
      provider: i.provider,
      isPrimaryEmail: i.isPrimaryEmail,
    })));

    return NextResponse.json(safeIntegrations);
  } catch (error) {
    console.error('Get integrations error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch integrations' },
      { status: 500 }
    );
  }
}

// POST - Create or update integration
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { provider, environment, credentials, isPrimaryEmail } = body;

    // Validate required fields
    if (!provider || !credentials) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Environment is required for Reloadly, optional for DingConnect
    if (provider === 'reloadly' && !environment) {
      return NextResponse.json(
        { error: 'Environment is required for Reloadly' },
        { status: 400 }
      );
    }

    // Validate isPrimaryEmail is only for email providers
    const emailProviders = ['zeptomail', 'mailgun', 'sendgrid', 'mailchimp'];
    if (isPrimaryEmail && !emailProviders.includes(provider)) {
      return NextResponse.json(
        { error: 'Only email providers can be set as primary' },
        { status: 400 }
      );
    }

    // Validate API key doesn't contain invalid characters
    const apiKey = credentials.apiKey || credentials.apiSecret;
    if (apiKey) {
      // Check for non-ASCII characters
      for (let i = 0; i < apiKey.length; i++) {
        const code = apiKey.charCodeAt(i);
        if (code > 127) {
          return NextResponse.json(
            {
              error: 'Invalid API key format',
              detail: `API key contains invalid character at position ${i}. Please ensure you're copying the actual API key, not console output or formatted text.`,
            },
            { status: 400 }
          );
        }
      }

      // Check for suspicious patterns that indicate console output
      if (apiKey.includes('{') || apiKey.includes('[') || apiKey.includes('page.tsx') || apiKey.includes('console')) {
        return NextResponse.json(
          {
            error: 'Invalid API key format',
            detail: 'The API key appears to be console output or formatted text. Please copy only the actual API key from your provider dashboard.',
          },
          { status: 400 }
        );
      }

      // Check minimum length for email providers
      if (emailProviders.includes(provider) && apiKey.length < 30) {
        return NextResponse.json(
          {
            error: 'Invalid API key format',
            detail: `API key is too short (${apiKey.length} characters). Email provider API keys are typically longer. Please verify you copied the complete key.`,
          },
          { status: 400 }
        );
      }
    }

    await dbConnection.connect();

    // If setting as primary email, unset any existing primary email providers
    if (isPrimaryEmail) {
      await Integration.updateMany(
        {
          orgId: session.orgId,
          provider: { $in: emailProviders },
          isPrimaryEmail: true,
        },
        {
          $set: { isPrimaryEmail: false },
        }
      );
    }

    // Check if integration already exists
    let integration = await Integration.findOne({
      orgId: session.orgId,
      provider,
    }).select('+credentials.apiKey +credentials.apiSecret +credentials.clientId +credentials.clientSecret +credentials.baseUrl');

    if (integration) {
      // Update existing
      if (environment) {
        integration.environment = environment;
      }
      integration.credentials = credentials;
      integration.status = 'active'; // Mark as active when saved
      if (isPrimaryEmail !== undefined) {
        integration.isPrimaryEmail = isPrimaryEmail;
      }
      await integration.save();
    } else {
      // Create new
      const integrationData: any = {
        orgId: session.orgId,
        provider,
        credentials,
        status: 'active', // Mark as active when saved
      };

      if (environment) {
        integrationData.environment = environment;
      }

      if (isPrimaryEmail !== undefined) {
        integrationData.isPrimaryEmail = isPrimaryEmail;
      }

      integration = await Integration.create(integrationData);
    }

    return NextResponse.json({
      success: true,
      integration: {
        id: integration._id,
        provider: integration.provider,
        status: integration.status,
        environment: integration.environment,
        isPrimaryEmail: integration.isPrimaryEmail || false,
      },
    });
  } catch (error) {
    console.error('Save integration error:', error);
    return NextResponse.json(
      { error: 'Failed to save integration' },
      { status: 500 }
    );
  }
}
