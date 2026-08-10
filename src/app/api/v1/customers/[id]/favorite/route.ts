import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbConnection } from "@topupsend/db/connection";
import { Customer } from "@topupsend/db";

// POST - Toggle customer favorite status
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

    await dbConnection.connect();

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

    // Toggle favorite status
    customer.isFavorite = !customer.isFavorite;
    await customer.save();

    return NextResponse.json({
      isFavorite: customer.isFavorite,
      message: customer.isFavorite
        ? "Added to favorites"
        : "Removed from favorites",
    });
  } catch (error) {
    console.error("Toggle favorite error:", error);
    return NextResponse.json(
      { error: "Failed to toggle favorite" },
      { status: 500 }
    );
  }
}
