import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbConnection } from "@topupsend/db/connection";
import { Customer, CustomerGroup } from "@topupsend/db";

// POST - Add customer to group
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { groupId } = body;

    if (!groupId) {
      return NextResponse.json(
        { error: "Group ID is required" },
        { status: 400 }
      );
    }

    await dbConnection.connect();

    // Verify group exists and belongs to org
    const group = await CustomerGroup.findOne({
      _id: groupId,
      orgId: session.orgId,
    });

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    // Find customer
    const customer = await Customer.findOne({
      _id: id,
      orgId: session.orgId,
    });

    if (!customer) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 }
      );
    }

    // Check if already in group
    if (customer.groups.includes(groupId)) {
      return NextResponse.json(
        { error: "Customer is already in this group" },
        { status: 400 }
      );
    }

    // Add to group
    customer.groups.push(groupId);
    await customer.save();

    // Update group customer count
    group.customerCount += 1;
    await group.save();

    return NextResponse.json({
      message: "Customer added to group",
      groups: customer.groups,
    });
  } catch (error) {
    console.error("Add to group error:", error);
    return NextResponse.json(
      { error: "Failed to add customer to group" },
      { status: 500 }
    );
  }
}

// DELETE - Remove customer from group
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const groupId = searchParams.get("groupId");

    if (!groupId) {
      return NextResponse.json(
        { error: "Group ID is required" },
        { status: 400 }
      );
    }

    await dbConnection.connect();

    // Find customer
    const customer = await Customer.findOne({
      _id: id,
      orgId: session.orgId,
    });

    if (!customer) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 }
      );
    }

    // Check if in group
    if (!customer.groups.includes(groupId)) {
      return NextResponse.json(
        { error: "Customer is not in this group" },
        { status: 400 }
      );
    }

    // Remove from group
    customer.groups = customer.groups.filter((g) => g !== groupId);
    await customer.save();

    // Update group customer count
    const group = await CustomerGroup.findOne({
      _id: groupId,
      orgId: session.orgId,
    });

    if (group) {
      group.customerCount = Math.max(0, group.customerCount - 1);
      await group.save();
    }

    return NextResponse.json({
      message: "Customer removed from group",
      groups: customer.groups,
    });
  } catch (error) {
    console.error("Remove from group error:", error);
    return NextResponse.json(
      { error: "Failed to remove customer from group" },
      { status: 500 }
    );
  }
}
