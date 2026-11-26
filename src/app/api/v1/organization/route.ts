import { NextRequest, NextResponse } from 'next/server';
import { getRevalidatedSession } from '@/lib/auth';
import { dbConnection } from '@topupsend/db/connection';
// Import via the package index (not the model file directly) so
// the enriched Organization schema — the one that defines `logo` —
// is the registered Org model this route reads and writes.
import { Org } from '@topupsend/db';
import { hasPermission } from '@/lib/permissions';
import { Permission } from '@topupsend/types';
import { validateOrgLogo } from '@/lib/org-logo';

// GET organization details
export async function GET(_request: NextRequest) {
  try {
    const session = await getRevalidatedSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnection.connect();

    const org = await Org.findById(session.orgId);
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: org._id,
      name: org.name,
      slug: org.slug,
      logo: (org as any).logo ?? null,
      settings: org.settings,
      createdAt: org.createdAt,
    });
  } catch (error) {
    console.error('Get organization error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch organization' },
      { status: 500 }
    );
  }
}

// PUT - Update organization
export async function PUT(request: NextRequest) {
  try {
    const session = await getRevalidatedSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasPermission(session.roles, Permission.EDIT_ORG_SETTINGS)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { name, settings, logo } = body;

    // Business logo: an uploaded image (data URL) or an https
    // image URL; null clears it. Validated before anything is
    // loaded or written so a bad logo is a clear 400, never a
    // silently dropped save.
    let logoValue: string | null | undefined;
    if (logo !== undefined) {
      const validation = validateOrgLogo(logo);
      if (!validation.ok) {
        return NextResponse.json(
          { error: validation.error },
          { status: 400 }
        );
      }
      logoValue = validation.value;
    }

    await dbConnection.connect();

    const org = await Org.findById(session.orgId);
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    if (name) org.name = name;
    if (settings) org.settings = { ...org.settings, ...settings };
    if (logoValue !== undefined) {
      (org as any).logo = logoValue ?? undefined;
    }

    await org.save();

    return NextResponse.json({
      success: true,
      organization: {
        id: org._id,
        name: org.name,
        slug: org.slug,
        logo: (org as any).logo ?? null,
        settings: org.settings,
      },
    });
  } catch (error) {
    console.error('Update organization error:', error);
    return NextResponse.json(
      { error: 'Failed to update organization' },
      { status: 500 }
    );
  }
}
