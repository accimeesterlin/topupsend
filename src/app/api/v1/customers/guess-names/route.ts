import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbConnection } from "@topupsend/db/connection";
import { Customer } from "@topupsend/db";
import { guessNameFromEmail } from "@/lib/guess-name-from-email";
import { logger } from "@/lib/logger";

export interface NameGuess {
  customerId: string;
  email: string;
  phoneNumber: string;
  currentName: string | null;
  guessedName: string | null;
  confidence: number;
  decision: "autofill" | "suggest" | "blank";
  reason: string;
}

/**
 * POST /api/v1/customers/guess-names
 * Find unnamed customers with emails and guess their names.
 * Returns guesses for review — does NOT auto-update.
 */
export async function POST() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await dbConnection.connect();

    // Find customers without names but with emails
    const unnamedCustomers = await Customer.find({
      orgId: session.orgId,
      email: { $exists: true, $nin: [null, ""] },
      $or: [{ name: { $exists: false } }, { name: null }, { name: "" }],
    })
      .select("_id phoneNumber email name")
      .limit(100)
      .lean();

    if (unnamedCustomers.length === 0) {
      return NextResponse.json({
        guesses: [],
        message: "No unnamed customers with emails found",
      });
    }

    const guesses: NameGuess[] = [];

    for (const customer of unnamedCustomers) {
      const result = await guessNameFromEmail(customer.email as string);

      // Return all guesses that produced a name — let the user decide
      if (result.guessedName) {
        guesses.push({
          customerId: String(customer._id),
          email: customer.email as string,
          phoneNumber: customer.phoneNumber,
          currentName: (customer.name as string) || null,
          guessedName: result.guessedName,
          confidence: result.confidence,
          decision: result.decision,
          reason: result.reason,
        });
      }
    }

    // Sort by confidence descending
    guesses.sort((a, b) => b.confidence - a.confidence);

    logger.info("Name guessing completed", {
      orgId: session.orgId,
      totalUnnamed: unnamedCustomers.length,
      guessesReturned: guesses.length,
    });

    return NextResponse.json({
      guesses,
      totalUnnamed: unnamedCustomers.length,
    });
  } catch (error) {
    logger.error("Error guessing customer names", { error });
    return NextResponse.json(
      { error: "Failed to guess customer names" },
      { status: 500 },
    );
  }
}
