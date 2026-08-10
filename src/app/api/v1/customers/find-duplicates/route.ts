import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbConnection } from "@topupsend/db/connection";
import { Customer } from "@topupsend/db";
import { logger } from "@/lib/logger";
import type {
  DuplicateGroup,
  FindDuplicatesResponse,
} from "@/types/find-duplicates";

const customerProjection = {
  _id: "$_id",
  phoneNumber: "$phoneNumber",
  additionalPhoneNumbers: "$additionalPhoneNumbers",
  email: "$email",
  name: "$name",
  country: "$country",
  isFavorite: "$isFavorite",
  groups: "$groups",
  metadata: "$metadata",
  createdAt: "$createdAt",
};

/**
 * POST /api/v1/customers/find-duplicates
 * Find customers that share the same phone number or email address.
 * Returns grouped results for review and merging.
 */
export async function POST() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await dbConnection.connect();

    // Phone duplicates: group by every phone number (primary + additional)
    const phonePipeline = [
      { $match: { orgId: session.orgId } },
      {
        $addFields: {
          allPhones: {
            $setUnion: [
              [{ $ifNull: ["$phoneNumber", ""] }],
              { $ifNull: ["$additionalPhoneNumbers", []] },
            ],
          },
        },
      },
      { $unwind: "$allPhones" },
      { $match: { allPhones: { $ne: "" } } },
      {
        $group: {
          _id: "$allPhones",
          customers: { $push: customerProjection },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gte: 2 } } },
      {
        $project: {
          _id: 0,
          matchType: { $literal: "phone" },
          matchValue: "$_id",
          customers: 1,
        },
      },
    ];

    // Email duplicates: group by normalized email
    const emailPipeline = [
      {
        $match: {
          orgId: session.orgId,
          email: { $exists: true, $nin: [null, ""] },
        },
      },
      {
        $addFields: {
          normalizedEmail: { $toLower: "$email" },
        },
      },
      {
        $group: {
          _id: "$normalizedEmail",
          customers: { $push: customerProjection },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gte: 2 } } },
      {
        $project: {
          _id: 0,
          matchType: { $literal: "email" },
          matchValue: "$_id",
          customers: 1,
        },
      },
    ];

    const [phoneGroups, emailGroups] = await Promise.all([
      Customer.aggregate(phonePipeline),
      Customer.aggregate(emailPipeline),
    ]);

    const groups: DuplicateGroup[] = [...phoneGroups, ...emailGroups];

    // Sort by group size descending (biggest issues first)
    groups.sort((a, b) => b.customers.length - a.customers.length);

    // Count total unique duplicate customers
    const uniqueCustomerIds = new Set<string>();
    for (const group of groups) {
      for (const customer of group.customers) {
        uniqueCustomerIds.add(String(customer._id));
      }
    }

    logger.info("Find duplicates completed", {
      orgId: session.orgId,
      phoneGroups: phoneGroups.length,
      emailGroups: emailGroups.length,
      totalGroups: groups.length,
      totalDuplicateCustomers: uniqueCustomerIds.size,
    });

    const response: FindDuplicatesResponse = {
      groups,
      totalGroups: groups.length,
      totalDuplicateCustomers: uniqueCustomerIds.size,
    };

    return NextResponse.json(response);
  } catch (error) {
    logger.error("Error finding duplicate customers", { error });
    return NextResponse.json(
      { error: "Failed to find duplicate customers" },
      { status: 500 },
    );
  }
}
