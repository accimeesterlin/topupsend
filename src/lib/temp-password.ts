import crypto from "crypto";

/**
 * Generate a temporary password from a CSPRNG.
 *
 * Invite passwords were previously `Math.random().toString(36).slice(-12)`
 * (F-M5): Math.random is predictable and the slice could even return fewer
 * than 12 characters. Bytes come from crypto.randomBytes, mapped onto the
 * alphabet by rejection sampling so every character is unbiased.
 */
const TEMP_PASSWORD_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
// Largest multiple of the alphabet length that fits in a byte; bytes at or
// above it are rejected to avoid modulo bias.
const REJECTION_LIMIT = 256 - (256 % TEMP_PASSWORD_ALPHABET.length);

export function generateTemporaryPassword(length: number = 16): string {
  let password = "";
  while (password.length < length) {
    const bytes = crypto.randomBytes(length - password.length + 8);
    for (const byte of bytes) {
      if (password.length >= length) break;
      if (byte >= REJECTION_LIMIT) continue;
      password += TEMP_PASSWORD_ALPHABET[byte % TEMP_PASSWORD_ALPHABET.length];
    }
  }
  return password;
}
