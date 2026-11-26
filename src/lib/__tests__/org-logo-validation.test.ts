/**
 * Unit tests for organization logo validation (src/lib/org-logo).
 *
 * The logo is stored on the Organization record as either an
 * https image URL or a data URL carrying the uploaded image.
 * Anything else must be rejected with a clear error so a bad logo
 * never reaches the customer portal.
 */
import { ORG_LOGO_MAX_BYTES, validateOrgLogo } from "../org-logo";

function dataUrl(mime: string, payloadBytes: number): string {
  // Build a base64 payload of roughly the requested decoded size.
  const base64Length = Math.ceil(payloadBytes / 3) * 4;
  return `data:${mime};base64,${"A".repeat(base64Length)}`;
}

describe("validateOrgLogo", () => {
  test("accepts removal (null / empty)", () => {
    expect(validateOrgLogo(null)).toEqual({ ok: true, value: null });
    expect(validateOrgLogo("")).toEqual({ ok: true, value: null });
    expect(validateOrgLogo(undefined)).toEqual({ ok: true, value: null });
  });

  test("accepts an https image URL", () => {
    const res = validateOrgLogo("https://example.com/logo.png");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toBe("https://example.com/logo.png");
  });

  test("rejects a plain http URL", () => {
    const res = validateOrgLogo("http://example.com/logo.png");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/https|image/i);
  });

  test("rejects non-URL strings and scriptable URLs", () => {
    for (const bad of [
      "logo.png",
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    ]) {
      expect(validateOrgLogo(bad).ok).toBe(false);
    }
  });

  test("accepts png/jpeg/webp/svg data URLs within the size cap", () => {
    for (const mime of ["image/png", "image/jpeg", "image/webp", "image/svg+xml"]) {
      const res = validateOrgLogo(dataUrl(mime, 1024));
      expect(res.ok).toBe(true);
    }
  });

  test("rejects data URLs of non-image or unlisted types", () => {
    for (const mime of ["image/gif", "image/bmp", "application/pdf"]) {
      const res = validateOrgLogo(dataUrl(mime, 100));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/PNG, JPG, WebP, or SVG/);
    }
  });

  test("rejects an uploaded image over the size cap, accepts one at it", () => {
    const over = validateOrgLogo(dataUrl("image/png", ORG_LOGO_MAX_BYTES + 300));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toMatch(/too large/i);

    const atCap = validateOrgLogo(dataUrl("image/png", ORG_LOGO_MAX_BYTES - 300));
    expect(atCap.ok).toBe(true);
  });

  test("rejects non-string values", () => {
    expect(validateOrgLogo(42).ok).toBe(false);
    expect(validateOrgLogo({}).ok).toBe(false);
  });
});
