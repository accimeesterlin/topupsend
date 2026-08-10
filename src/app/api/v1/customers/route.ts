import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbConnection } from '@topupsend/db/connection';
import { Customer } from '@topupsend/db';

// GET all customers for the organization
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnection.connect();

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');
    const favoritesOnly = searchParams.get('favorites') === 'true';
    const groupId = searchParams.get('groupId');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');

    const query: any = { orgId: session.orgId };

    // Filter by favorites
    if (favoritesOnly) {
      query.isFavorite = true;
    }

    // Filter by group
    if (groupId) {
      query.groups = groupId;
    }

    // Search filter
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { phoneNumber: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
        { name: { $regex: escaped, $options: 'i' } },
      ];
    }

    const total = await Customer.countDocuments(query);
    const customers = await Customer.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return NextResponse.json({
      customers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get customers error:', error);
    return NextResponse.json({ error: 'Failed to fetch customers' }, { status: 500 });
  }
}

// POST - Create customer
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { phoneNumber, email, name, country } = body;

    if (!phoneNumber) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
    }

    await dbConnection.connect();

    // Check if customer already exists with this phone or email
    const duplicate = await Customer.checkDuplicates(session.orgId, {
      phoneNumber,
      email,
    });

    if (duplicate) {
      const msg =
        duplicate.field === "email"
          ? "A customer with this email already exists"
          : "A customer with this phone number already exists";
      return NextResponse.json({ error: msg }, { status: 409 });
    }

    const customer = await Customer.create({
      orgId: session.orgId,
      phoneNumber,
      email,
      name,
      country,
    });

    return NextResponse.json(customer, { status: 201 });
  } catch (error) {
    console.error('Create customer error:', error);
    return NextResponse.json({ error: 'Failed to create customer' }, { status: 500 });
  }
}
