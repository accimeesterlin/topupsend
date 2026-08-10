/**
 * Customer Balance Management - Admin Endpoints
 * GET /api/v1/customers/[id]/balance - View customer balance
 * POST /api/v1/customers/[id]/balance - Assign balance to customer
 * PUT /api/v1/customers/[id]/balance - Adjust customer balance
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { Customer, CustomerBalanceHistory } from "@topupsend/db";
import { ApiErrors } from "@/lib/api-error";
import {
  createSuccessResponse,
  createCreatedResponse,
} from "@/lib/api-response";
import { requireAuth } from "@/lib/auth-middleware";
import { Permission } from "@topupsend/types";
import { hasPermission } from "@/lib/permissions";
import { emailVerificationService } from "@/lib/services/email-verification.service";

/**
 * GET - View customer balance and history
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(request);
  const { id } = await params;

  // Check permission
  if (!hasPermission(session.roles, Permission.VIEW_CUSTOMER_BALANCE)) {
    throw ApiErrors.Forbidden("Insufficient permissions");
  }

  // Get customer
  const customer = await Customer.findById(id);

  if (!customer) {
    throw ApiErrors.NotFound("Customer not found");
  }

  // Verify customer belongs to user's org
  if (customer.orgId !== session.orgId) {
    throw ApiErrors.Forbidden("Access denied");
  }

  // Get balance history
  const history = await CustomerBalanceHistory.find({
    customerId: customer._id,
  })
    .sort({ createdAt: -1 })
    .limit(50);

  return createSuccessResponse({
    balance: {
      current: customer.currentBalance,
      totalAssigned: customer.totalAssigned,
      totalUsed: customer.totalUsed,
      currency: customer.balanceCurrency,
      emailVerified: customer.emailVerified,
      canUseBalance: customer.canUseBalance(),
    },
    history: history.map((h) => ({
      id: String(h._id),
      amount: h.amount,
      type: h.type,
      previousBalance: h.previousBalance,
      newBalance: h.newBalance,
      description: h.description,
      metadata: h.metadata,
      createdAt: h.createdAt,
    })),
  });
}

const assignBalanceSchema = z.object({
  amount: z.number().positive("Amount must be positive"),
  description: z.string().min(1, "Description is required"),
  expiresAt: z.string().datetime().optional(),
  notes: z.string().optional(),
  sendVerification: z.boolean().optional(),
});

/**
 * POST - Assign balance to customer
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(request);
  const { id } = await params;

  // Check permission
  if (!hasPermission(session.roles, Permission.ASSIGN_CUSTOMER_BALANCE)) {
    throw ApiErrors.Forbidden("Insufficient permissions");
  }

  const body = await request.json();
  const data = assignBalanceSchema.parse(body);

  // Get customer
  const customer = await Customer.findById(id);

  if (!customer) {
    throw ApiErrors.NotFound("Customer not found");
  }

  // Verify customer belongs to user's org
  if (customer.orgId !== session.orgId) {
    throw ApiErrors.Forbidden("Access denied");
  }

  // Add balance
  await customer.addBalance(data.amount, data.description, {
    adminId: session.userId,
    expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
    notes: data.notes,
  });

  // Send verification email if requested and not verified
  if (data.sendVerification && !customer.emailVerified && customer.email) {
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      `${request.nextUrl.protocol}//${request.nextUrl.host}`;
    // Get org slug - we'll need to find the org
    const { Org } = await import("@topupsend/db");
    const org = await Org.findById(customer.orgId);

    if (org) {
      await emailVerificationService.sendVerificationEmail(
        customer,
        org.slug,
        baseUrl,
      );
    }
  }

  return createCreatedResponse({
    message: "Balance assigned successfully",
    balance: {
      current: customer.currentBalance,
      totalAssigned: customer.totalAssigned,
      totalUsed: customer.totalUsed,
      currency: customer.balanceCurrency,
    },
  });
}

const adjustBalanceSchema = z.object({
  type: z.enum(["reset", "adjustment"]),
  amount: z.number().optional(),
  description: z.string().min(1, "Description is required"),
  notes: z.string().optional(),
});

/**
 * PUT - Adjust customer balance (reset or adjustment)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(request);
  const { id } = await params;

  // Check permission
  if (!hasPermission(session.roles, Permission.ADJUST_CUSTOMER_BALANCE)) {
    throw ApiErrors.Forbidden("Insufficient permissions");
  }

  const body = await request.json();
  const data = adjustBalanceSchema.parse(body);

  // Get customer
  const customer = await Customer.findById(id);

  if (!customer) {
    throw ApiErrors.NotFound("Customer not found");
  }

  // Verify customer belongs to user's org
  if (customer.orgId !== session.orgId) {
    throw ApiErrors.Forbidden("Access denied");
  }

  const previousBalance = customer.currentBalance;

  if (data.type === "reset") {
    // Reset balance to 0
    customer.currentBalance = 0;
    await customer.save();

    // Create history record
    await CustomerBalanceHistory.create({
      customerId: customer._id,
      orgId: customer.orgId,
      amount: -previousBalance,
      type: "reset",
      previousBalance,
      newBalance: 0,
      description: data.description,
      metadata: {
        adminId: session.userId,
        notes: data.notes,
      },
    });
  } else {
    // Adjustment (can be positive or negative)
    if (data.amount === undefined) {
      throw ApiErrors.BadRequest("Amount is required for adjustment");
    }

    const newBalance = customer.currentBalance + data.amount;

    if (newBalance < 0) {
      throw ApiErrors.BadRequest("Adjustment would result in negative balance");
    }

    customer.currentBalance = newBalance;

    // Update totals based on adjustment type
    if (data.amount > 0) {
      customer.totalAssigned += data.amount;
    } else {
      customer.totalUsed += Math.abs(data.amount);
    }

    await customer.save();

    // Create history record
    await CustomerBalanceHistory.create({
      customerId: customer._id,
      orgId: customer.orgId,
      amount: data.amount,
      type: "adjustment",
      previousBalance,
      newBalance,
      description: data.description,
      metadata: {
        adminId: session.userId,
        notes: data.notes,
      },
    });
  }

  return createSuccessResponse({
    message: `Balance ${data.type === "reset" ? "reset" : "adjusted"} successfully`,
    balance: {
      current: customer.currentBalance,
      totalAssigned: customer.totalAssigned,
      totalUsed: customer.totalUsed,
      currency: customer.balanceCurrency,
    },
  });
}
