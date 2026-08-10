import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbConnection } from '@topupsend/db/connection';
import { Product } from '@topupsend/db';

// GET all products for the organization
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnection.connect();

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');
    const status = searchParams.get('status');
    const provider = searchParams.get('provider');

    const query: any = { orgId: session.orgId };

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { operatorName: { $regex: escaped, $options: 'i' } },
        { operatorCountry: { $regex: escaped, $options: 'i' } },
      ];
    }

    if (status) {
      query.status = status;
    }

    if (provider) {
      query.provider = provider;
    }

    const products = await Product.find(query).sort({ createdAt: -1 });

    return NextResponse.json(products);
  } catch (error) {
    console.error('Get products error:', error);
    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 });
  }
}

// POST - Create product (simplified - just name required)
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, description } = body;

    // Only name is required for initial creation
    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Product name is required' }, { status: 400 });
    }

    await dbConnection.connect();

    // Check for duplicate product name
    const existing = await Product.findOne({
      orgId: session.orgId,
      name: name.trim(),
    });

    if (existing) {
      return NextResponse.json(
        { error: 'A product with this name already exists' },
        { status: 409 }
      );
    }

    // Create minimal product - will be configured on detail page
    const product = await Product.create({
      orgId: session.orgId,
      name: name.trim(),
      description: description?.trim() || '',
      provider: 'dingconnect', // Default, can be changed later
      providerProductId: '', // Will be set when provider product is selected
      operatorId: '', // Will be set when provider product is selected
      operatorName: 'Not configured',
      operatorCountry: '',
      pricing: {
        costPrice: 0,
        sellPrice: 0,
        currency: 'USD',
        profitMargin: 0,
      },
      denomination: {
        type: 'fixed',
        fixedAmount: 0,
        unit: 'USD',
      },
      resaleSettings: {
        allowedCountries: [],
        blockedCountries: [],
        customPricing: {
          enabled: false,
        },
        discount: {
          enabled: false,
        },
        limits: {},
      },
      sync: {
        autoSync: false,
      },
      status: 'inactive', // Inactive until configured
      metadata: {
        category: 'Mobile Top-up',
        tags: [],
        popularity: 0,
        totalSales: 0,
        revenue: 0,
      },
    });

    return NextResponse.json(product, { status: 201 });
  } catch (error: any) {
    console.error('Create product error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create product' },
      { status: 500 }
    );
  }
}
