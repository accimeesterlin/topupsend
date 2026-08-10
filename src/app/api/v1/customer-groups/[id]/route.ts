import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbConnection } from "@topupsend/db/connection";
import { CustomerGroup, Customer } from "@topupsend/db";

// PUT - Update customer group
export async function PUT(
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
    const { name, description, color } = body;

    await dbConnection.connect();

    const group = await CustomerGroup.findOne({
      _id: id,
      orgId: session.orgId,
    });

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    // Check if new name conflicts with existing group
    if (name && name.trim() !== group.name) {
      const existing = await CustomerGroup.findOne({
        orgId: session.orgId,
        name: name.trim(),
        _id: { $ne: id },
      });

      if (existing) {
        return NextResponse.json(
          { error: "A group with this name already exists" },
          { status: 409 }
        );
      }
    }

    if (name) group.name = name.trim();
    if (description !== undefined) group.description = description?.trim();
    if (color) group.color = color;

    await group.save();

    return NextResponse.json(group);
  } catch (error) {
    console.error("Update customer group error:", error);
    return NextResponse.json(
      { error: "Failed to update customer group" },
      { status: 500 }
    );
  }
}

// DELETE - Delete customer group
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

    await dbConnection.connect();

    const group = await CustomerGroup.findOne({
      _id: id,
      orgId: session.orgId,
    });

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    // Remove this group from all customers
    await Customer.updateMany(
      { orgId: session.orgId, groups: id },
      { $pull: { groups: id } }
    );

    await group.deleteOne();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete customer group error:", error);
    return NextResponse.json(
      { error: "Failed to delete customer group" },
      { status: 500 }
    );
  }
}
