import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { UserRole } from '@topupsend/types';

/**
 * The staff session secret (F-C9: fail closed).
 *
 * There is deliberately NO fallback literal: if JWT_SECRET is unset,
 * signing throws and verification rejects every token, instead of
 * silently trusting a secret printed in the source code. Resolved
 * lazily on each call so importing this module (build, tests) never
 * depends on the deployment's env.
 */
export function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET environment variable is not set; refusing to sign or verify session tokens'
    );
  }
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  userId: string;
  email: string;
  roles: UserRole[];
  orgId: string;
  /**
   * Token version at mint time (F-M1). requireAuth compares it with
   * the user record's current tokenVersion; a mismatch means the
   * session has been revoked (password reset, role change,
   * deactivation, logout). Absent on pre-hardening tokens (= 0).
   */
  tv?: number;
}

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Create a JWT token
 */
export async function createToken(payload: SessionPayload): Promise<string> {
  const token = await new SignJWT(payload as any)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(process.env.JWT_EXPIRES_IN || '7d')
    .sign(getJwtSecret());

  return token;
}

/**
 * Verify a JWT token
 */
export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return payload as unknown as SessionPayload;
  } catch (_error) {
    // Also the fail-closed path: an unset JWT_SECRET lands here and
    // every token is rejected rather than checked against a fallback.
    return null;
  }
}

/**
 * Create a session cookie
 */
export function createSessionCookie(token: string): string {
  const isProduction = process.env.NODE_ENV === 'production';
  const maxAge = 7 * 24 * 60 * 60; // 7 days in seconds

  return `session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${
    isProduction ? '; Secure' : ''
  }`;
}

/**
 * Clear the session cookie
 */
export function clearSessionCookie(): string {
  return 'session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0';
}

/**
 * Get the current session from cookies
 */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('session');

  if (!sessionCookie) {
    return null;
  }

  return verifyToken(sessionCookie.value);
}
