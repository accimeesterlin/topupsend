import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getSession } from "@/lib/auth";
import { dbConnection } from "@topupsend/db/connection";
import {
  Customer,
  Transaction,
  CustomerBalanceHistory,
  CustomerGroup,
  WebhookLog,
  ApiKey,
} from "@topupsend/db";
import { z } from "zod";
import { logger } from "@/lib/logger";

const mergeCustomersSchema = z.object({
  primaryCustomerId: z.string().min(1, "Primary customer ID is required"),
  duplicateCustomerIds: z
    .array(z.string().min(1))
    .min(1, "At least one duplicate customer ID is required"),
});

/**
 * POST /api/v1/customers/merge
 * Merge duplicate customers into a primary customer.
 * Transfers all transactions, balance history, webhook logs, and API keys.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = mergeCustomersSchema.safeParse(body);
    if (!parsed.success) {
      const errors = parsed.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join(", ");
      return NextResponse.json(
        { error: `Validation failed: ${errors}` },
        { status: 400 },
      );
    }

    const { primaryCustomerId, duplicateCustomerIds } = parsed.data;

    // Prevent primary from appearing in duplicates
    if (duplicateCustomerIds.includes(primaryCustomerId)) {
      return NextResponse.json(
        { error: "Primary customer cannot also be a duplicate" },
        { status: 400 },
      );
    }

    // Check for duplicate IDs in the array
    const uniqueDuplicates = [...new Set(duplicateCustomerIds)];

    await dbConnection.connect();

    // Fetch all customers in one query
    const allIds = [primaryCustomerId, ...uniqueDuplicates];
    const allCustomers = await Customer.find({
      _id: { $in: allIds },
      orgId: session.orgId,
    });

    const primary = allCustomers.find(
      (c) => String(c._id) === primaryCustomerId,
    );
    if (!primary) {
      return NextResponse.json(
        { error: "Primary customer not found" },
        { status: 404 },
      );
    }

    const duplicates = uniqueDuplicates.map((id) =>
      allCustomers.find((c) => String(c._id) === id),
    );
    const missingIds = uniqueDuplicates.filter(
      (id, i) => !duplicates[i],
    );
    if (missingIds.length > 0) {
      return NextResponse.json(
        { error: `Duplicate customer(s) not found: ${missingIds.join(", ")}` },
        { status: 404 },
      );
    }

    // All duplicates are guaranteed to exist
    const validDuplicates = duplicates.filter(Boolean) as typeof allCustomers;

    // --- Merge fields into primary ---

    // Collect all phone numbers from duplicates (their primary + additional)
    const allDuplicatePhones = validDuplicates.flatMap((dup) => [
      dup.phoneNumber,
      ...(dup.additionalPhoneNumbers || []),
    ]);
    const existingAdditional = primary.additionalPhoneNumbers || [];
    const mergedPhones = [
      ...new Set([...existingAdditional, ...allDuplicatePhones]),
    ].filter((phone) => phone !== primary.phoneNumber);
    primary.additionalPhoneNumbers = mergedPhones;

    // Fill missing scalar fields from first duplicate that has them
    if (!primary.email) {
      const withEmail = validDuplicates.find((d) => d.email);
      if (withEmail) primary.email = withEmail.email;
    }
    if (!primary.name) {
      const withName = validDuplicates.find((d) => d.name);
      if (withName) primary.name = withName.name;
    }
    if (!primary.country) {
      const withCountry = validDuplicates.find((d) => d.country);
      if (withCountry) primary.country = withCountry.country;
    }

    // Boolean OR
    if (!primary.isFavorite && validDuplicates.some((d) => d.isFavorite)) {
      primary.isFavorite = true;
    }

    // Merge groups (union, deduplicate)
    const allGroups = validDuplicates.flatMap((d) => d.groups || []);
    primary.groups = [...new Set([...(primary.groups || []), ...allGroups])];

    // Sum numeric fields
    for (const dup of validDuplicates) {
      primary.currentBalance += dup.currentBalance || 0;
      primary.totalAssigned += dup.totalAssigned || 0;
      primary.totalUsed += dup.totalUsed || 0;
      primary.metadata.totalPurchases +=
        dup.metadata?.totalPurchases || 0;
      primary.metadata.totalSpent += dup.metadata?.totalSpent || 0;
    }

    // Latest date
    for (const dup of validDuplicates) {
      if (
        dup.metadata?.lastPurchaseAt &&
        (!primary.metadata.lastPurchaseAt ||
          new Date(dup.metadata.lastPurchaseAt) >
            new Date(primary.metadata.lastPurchaseAt))
      ) {
        primary.metadata.lastPurchaseAt = dup.metadata.lastPurchaseAt;
      }
    }

    // Merge array fields (union, deduplicate)
    const allTags = validDuplicates.flatMap(
      (d) => d.metadata?.tags || [],
    );
    primary.metadata.tags = [
      ...new Set([...(primary.metadata?.tags || []), ...allTags]),
    ];

    if (!primary.preferences) {
      primary.preferences = {};
    }
    const allFavOperators = validDuplicates.flatMap(
      (d) => d.preferences?.favoriteOperators || [],
    );
    primary.preferences.favoriteOperators = [
      ...new Set([
        ...(primary.preferences?.favoriteOperators || []),
        ...allFavOperators,
      ]),
    ];

    const allFavProducts = validDuplicates.flatMap(
      (d) => d.preferences?.favoriteProducts || [],
    );
    primary.preferences.favoriteProducts = [
      ...new Set([
        ...(primary.preferences?.favoriteProducts || []),
        ...allFavProducts,
      ]),
    ];

    // --- Migrate references ---
    const duplicateStringIds = uniqueDuplicates;
    const duplicateObjectIds = uniqueDuplicates.map(
      (id) => new mongoose.Types.ObjectId(id),
    );
    const primaryStringId = primaryCustomerId;
    const primaryObjectId = new mongoose.Types.ObjectId(primaryCustomerId);

    const [
      transactionResult,
      balanceHistoryResult,
      webhookLogResult,
      apiKeyResult,
    ] = await Promise.all([
      Transaction.updateMany(
        { customerId: { $in: duplicateStringIds }, orgId: session.orgId },
        { $set: { customerId: primaryStringId } },
      ),
      CustomerBalanceHistory.updateMany(
        { customerId: { $in: duplicateObjectIds } },
        { $set: { customerId: primaryObjectId } },
      ),
      WebhookLog.updateMany(
        { customerId: { $in: duplicateStringIds } },
        { $set: { customerId: primaryStringId } },
      ),
      ApiKey.updateMany(
        { ownerId: { $in: duplicateStringIds }, ownerType: "customer" },
        { $set: { ownerId: primaryStringId } },
      ),
    ]);

    // --- Fix group counts ---
    // Recalculate counts for all affected groups
    const affectedGroupIds = [
      ...new Set([
        ...(primary.groups || []),
        ...validDuplicates.flatMap((d) => d.groups || []),
      ]),
    ];

    // Save primary and delete duplicates
    await primary.save();
    await Customer.deleteMany({
      _id: { $in: duplicateStringIds },
      orgId: session.orgId,
    });

    // Recalculate group counts from actual data after deletion
    if (affectedGroupIds.length > 0) {
      await Promise.all(
        affectedGroupIds.map(async (groupId) => {
          const count = await Customer.countDocuments({
            orgId: session.orgId,
            groups: groupId,
          });
          await CustomerGroup.updateOne(
            { _id: groupId, orgId: session.orgId },
            { $set: { customerCount: count } },
          );
        }),
      );
    }

    const migratedRecords = {
      transactions: transactionResult.modifiedCount,
      balanceHistory: balanceHistoryResult.modifiedCount,
      webhookLogs: webhookLogResult.modifiedCount,
      apiKeys: apiKeyResult.modifiedCount,
    };

    logger.info("Customers merged successfully", {
      primaryCustomerId,
      deletedCustomerIds: duplicateStringIds,
      mergedCount: validDuplicates.length,
      migratedRecords,
      userId: session.userId,
      orgId: session.orgId,
    });

    return NextResponse.json({
      message: `Successfully merged ${validDuplicates.length} customer(s)`,
      primaryCustomerId,
      mergedCount: validDuplicates.length,
      deletedCustomerIds: duplicateStringIds,
      migratedRecords,
    });
  } catch (error) {
    logger.error("Error merging customers", { error });
    return NextResponse.json(
      { error: "Failed to merge customers" },
      { status: 500 },
    );
  }
}
