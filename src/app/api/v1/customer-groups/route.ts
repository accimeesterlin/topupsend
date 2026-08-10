import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbConnection } from "@topupsend/db/connection";
import { CustomerGroup } from "@topupsend/db";

// GET all customer groups
export async function GET(_request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await dbConnection.connect();

    const groups = await CustomerGroup.find({ orgId: session.orgId }).sort({
      name: 1,
    });

    return NextResponse.json(groups);
  } catch (error) {
    console.error("Get customer groups error:", error);
    return NextResponse.json(
      { error: "Failed to fetch customer groups" },
      { status: 500 }
    );
  }
}

// POST - Create new customer group
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, description, color } = body;

    if (!name || name.trim() === "") {
      return NextResponse.json(
        { error: "Group name is required" },
        { status: 400 }
      );
    }

    await dbConnection.connect();

    // Check if group with same name already exists
    const existing = await CustomerGroup.findOne({
      orgId: session.orgId,
      name: name.trim(),
    });

    if (existing) {
      return NextResponse.json(
        { error: "A group with this name already exists" },
        { status: 409 }
      );
    }

    const group = await CustomerGroup.create({
      orgId: session.orgId,
      name: name.trim(),
      description: description?.trim(),
      color: color || "#3b82f6",
      customerCount: 0,
      createdBy: session.userId,
    });

    return NextResponse.json(group, { status: 201 });
  } catch (error) {
    console.error("Create customer group error:", error);
    return NextResponse.json(
      { error: "Failed to create customer group" },
      { status: 500 }
    );
  }
}
