import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dbConnection } from "@topupsend/db/connection";
import { Customer } from "@topupsend/db";
import bcrypt from "bcryptjs";

// GET single customer
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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
        { status: 404 },
      );
    }

    return NextResponse.json(customer);
  } catch (error) {
    console.error("Get customer error:", error);
    return NextResponse.json(
      { error: "Failed to fetch customer" },
      { status: 500 },
    );
  }
}

// PUT - Update customer
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    console.log('[Customer Update] Starting update for customer:', id);
    console.log('[Customer Update] Cookies:', {
      hasSessionCookie: !!request.cookies.get('session'),
      hasCustomerSessionCookie: !!request.cookies.get('customer-session'),
    });

    let isCustomer = false;
    let customerAuthId = null;
    let staffSession = null;

    // Try STAFF auth first (dashboard users)
    try {
      staffSession = await getSession();
      if (staffSession) {
        console.log('[Customer Update] Staff auth successful:', {
          staffUserId: staffSession.userId,
          orgId: staffSession.orgId
        });
      }
    } catch (error) {
      console.log('[Customer Update] Staff auth failed:', error);
    }

    // If no staff session, try customer auth (customer portal users)
    if (!staffSession) {
      const customerSessionCookie = request.cookies.get('customer-session');

      if (customerSessionCookie) {
        try {
          const { getCustomerSession } = await import("@/lib/customer-auth");
          const customerSession = await getCustomerSession();

          if (customerSession) {
            isCustomer = true;
            customerAuthId = customerSession.customerId;
            console.log('[Customer Update] Customer auth detected:', {
              customerId: customerAuthId,
              targetId: id
            });

            // If customer, ensure they can only update themselves
            if (customerAuthId?.toString() !== id) {
              console.log('[Customer Update] Forbidden: Customer trying to update different account');
              return NextResponse.json({ error: "Forbidden" }, { status: 403 });
            }
          }
        } catch (error) {
          console.log('[Customer Update] Customer auth failed:', error);
        }
      }

      // No valid auth found
      if (!isCustomer) {
        console.log('[Customer Update] No valid authentication found');
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const body = await request.json();
    const {
      phoneNumber,
      email,
      name,
      country,
      firstName,
      lastName,
      phone,
      password,
      twoFactorEnabled,
    } = body;

    await dbConnection.connect();

    const customer = await Customer.findById(id);

    if (!customer) {
      console.log('[Customer Update] Customer not found:', id);
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 },
      );
    }

    // If staff, ensure customer belongs to their org
    if (!isCustomer && staffSession) {
      if (customer.orgId?.toString() !== staffSession.orgId) {
        console.log('[Customer Update] Forbidden: Customer belongs to different org');
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // Determine the new phone and email values being set
    const newPhone = phone ?? phoneNumber;
    const newEmail = isCustomer ? undefined : email;

    // Check uniqueness if phone or email is changing
    const checkPhone =
      newPhone !== undefined && newPhone !== customer.phoneNumber
        ? newPhone
        : undefined;
    const checkEmail =
      newEmail !== undefined && newEmail !== customer.email
        ? newEmail
        : undefined;

    if (checkPhone || checkEmail) {
      const duplicate = await Customer.checkDuplicates(
        customer.orgId,
        { phoneNumber: checkPhone, email: checkEmail },
        String(customer._id),
      );

      if (duplicate) {
        const msg =
          duplicate.field === "email"
            ? "Another customer with this email already exists"
            : "Another customer with this phone number already exists";
        return NextResponse.json({ error: msg }, { status: 409 });
      }
    }

    // Allow customer to update limited fields
    if (isCustomer) {
      // Customers can update their name and phone
      if (firstName !== undefined && lastName !== undefined) {
        customer.name = `${firstName} ${lastName}`.trim();
      } else if (name !== undefined) {
        customer.name = name;
      }
      if (phone !== undefined) {
        customer.phoneNumber = phone;
      }
      if (phoneNumber !== undefined) {
        customer.phoneNumber = phoneNumber;
      }
    } else {
      // Staff can update all fields
      if (phoneNumber) customer.phoneNumber = phoneNumber;
      if (email !== undefined) customer.email = email;
      if (name !== undefined) customer.name = name;
      if (country !== undefined) customer.country = country;
      if (firstName !== undefined && lastName !== undefined) {
        customer.name = `${firstName} ${lastName}`.trim();
      }
      if (phone !== undefined) customer.phoneNumber = phone;

      // Staff can toggle 2FA for customers
      if (twoFactorEnabled !== undefined) {
        customer.twoFactorEnabled = twoFactorEnabled;
        // If disabling 2FA, clear any existing codes
        if (twoFactorEnabled === false) {
          customer.twoFactorCode = undefined;
          customer.twoFactorCodeExpiry = undefined;
          customer.twoFactorVerified = false;
        }
      }

      // NOTE: password is handled separately below via direct DB update
      // to avoid issues with Mongoose select:false on passwordHash
    }

    await customer.save();

    // Handle password separately using direct DB update
    // Mongoose may not properly persist fields loaded with select:false
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 12);
      await Customer.updateOne(
        { _id: id },
        { $set: { passwordHash: hashedPassword } },
      );
      console.log("[Customer Update] Password saved via direct update:", {
        customerId: id,
        email: customer.email,
      });
    }

    return NextResponse.json(customer);
  } catch (error) {
    console.error("Update customer error:", error);
    return NextResponse.json(
      { error: "Failed to update customer" },
      { status: 500 },
    );
  }
}

// DELETE customer
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    await dbConnection.connect();

    const customer = await Customer.findOneAndDelete({
      _id: id,
      orgId: session.orgId,
    });

    if (!customer) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete customer error:", error);
    return NextResponse.json(
      { error: "Failed to delete customer" },
      { status: 500 },
    );
  }
}
