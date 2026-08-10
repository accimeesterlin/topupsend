import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbConnection } from '@topupsend/db/connection';
import { Product } from '@topupsend/db';

// GET single product
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnection.connect();

    const product = await Product.findOne({
      _id: id,
      orgId: session.orgId,
    });

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    return NextResponse.json(product);
  } catch (error) {
    console.error('Get product error:', error);
    return NextResponse.json({ error: 'Failed to fetch product' }, { status: 500 });
  }
}

// PUT - Update product
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      name,
      description,
      operatorName,
      operatorCountry,
      operatorLogo,
      costPrice,
      sellPrice,
      currency,
      denominationType,
      fixedAmount,
      minAmount,
      maxAmount,
      unit,
      status,
      category,
    } = body;

    await dbConnection.connect();

    const product = await Product.findOne({
      _id: id,
      orgId: session.orgId,
    });

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    // Validate sell price >= cost price if being updated
    const newCostPrice = costPrice !== undefined ? parseFloat(costPrice) : product.pricing.costPrice;
    const newSellPrice = sellPrice !== undefined ? parseFloat(sellPrice) : product.pricing.sellPrice;

    if (newSellPrice < newCostPrice) {
      return NextResponse.json(
        { error: 'Sell price must be greater than or equal to cost price' },
        { status: 400 }
      );
    }

    // Update fields
    if (name !== undefined) product.name = name;
    if (description !== undefined) product.description = description;
    if (operatorName !== undefined) product.operatorName = operatorName;
    if (operatorCountry !== undefined) product.operatorCountry = operatorCountry;
    if (operatorLogo !== undefined) product.operatorLogo = operatorLogo;
    if (status !== undefined) product.status = status;

    // Update pricing
    if (costPrice !== undefined) product.pricing.costPrice = parseFloat(costPrice);
    if (sellPrice !== undefined) product.pricing.sellPrice = parseFloat(sellPrice);
    if (currency !== undefined) product.pricing.currency = currency;

    // Update denomination
    if (denominationType !== undefined) {
      product.denomination.type = denominationType;
      if (denominationType === 'fixed') {
        product.denomination.fixedAmount = fixedAmount ? parseFloat(fixedAmount) : undefined;
        product.denomination.minAmount = undefined;
        product.denomination.maxAmount = undefined;
      } else {
        product.denomination.fixedAmount = undefined;
        product.denomination.minAmount = minAmount ? parseFloat(minAmount) : undefined;
        product.denomination.maxAmount = maxAmount ? parseFloat(maxAmount) : undefined;
      }
    }
    if (unit !== undefined) product.denomination.unit = unit;

    // Update metadata
    if (category !== undefined) product.metadata.category = category;

    await product.save();

    return NextResponse.json(product);
  } catch (error: any) {
    console.error('Update product error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update product' },
      { status: 500 }
    );
  }
}

// DELETE product
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnection.connect();

    const product = await Product.findOneAndDelete({
      _id: id,
      orgId: session.orgId,
    });

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete product error:', error);
    return NextResponse.json({ error: 'Failed to delete product' }, { status: 500 });
  }
}
