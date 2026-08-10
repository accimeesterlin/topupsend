import { NextRequest } from "next/server";
import { z } from "zod";
import { dbConnection } from "@topupsend/db/connection";
import { User } from "@topupsend/db/models/user.model";
import { Org } from "@topupsend/db/models/org.model";
import { UserOrganization } from "@topupsend/db";
import { UserRole } from "@topupsend/types";
import { hashPassword, createToken, createSessionCookie } from "@/lib/auth";
import { ApiErrors, handleApiError } from "@/lib/api-error";
import { createSuccessResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";

const signupSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  orgName: z.string().min(1, "Organization name is required"),
});

export async function POST(request: NextRequest) {
  try {
    // Connect to database
    await dbConnection.connect();

    // Parse and validate request body
    const body = await request.json();
    const validation = signupSchema.safeParse(body);

    if (!validation.success) {
      const errors = validation.error.errors.map((err) => ({
        field: err.path.join("."),
        message: err.message,
      }));
      throw ApiErrors.UnprocessableEntity("Validation failed", { errors });
    }

    const { email, password, orgName } = validation.data;

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      throw ApiErrors.Conflict("User with this email already exists");
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Generate unique slug from organization name
    const baseSlug = orgName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-") // Replace non-alphanumeric with hyphens
      .replace(/^-+|-+$/g, ""); // Remove leading/trailing hyphens

    // Ensure slug is unique
    let slug = baseSlug;
    let counter = 1;
    while (await Org.findOne({ slug })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    // Create organization
    const org = await Org.create({
      name: orgName,
      slug,
      settings: {},
      paymentProviders: [],
    });

    logger.info("Organization created", { orgId: org._id.toString(), orgName });

    // Create user
    const user = await User.create({
      email: email.toLowerCase(),
      passwordHash,
      roles: [UserRole.ADMIN], // First user is admin
      orgId: org._id,
      isActive: true,
    });

    logger.info("User created", {
      userId: user._id.toString(),
      email: user.email,
    });

    // Create UserOrganization record
    await UserOrganization.create({
      userId: user._id,
      orgId: org._id,
      roles: [UserRole.ADMIN],
      isActive: true,
      joinedAt: new Date(),
    });

    logger.info("UserOrganization created", {
      userId: user._id.toString(),
      orgId: org._id.toString(),
    });

    // Create session token
    const token = await createToken({
      userId: user._id.toString(),
      email: user.email,
      roles: user.roles,
      orgId: org._id.toString(),
    });

    // Create response with session cookie
    const response = createSuccessResponse(
      {
        user: {
          id: user._id.toString(),
          email: user.email,
          roles: user.roles,
          orgId: org._id.toString(),
        },
      },
      201,
    );

    response.headers.set("Set-Cookie", createSessionCookie(token));

    return response;
  } catch (error) {
    logger.error("Signup error", { error });
    return handleApiError(error);
  }
}
