/**
 * Organization business logo — validation shared by the settings
 * API, the settings UI, and the public portal branding endpoint.
 *
 * TopUpSend has no file-upload/storage stack anywhere in the repo,
 * so the logo is stored on the Organization record's existing
 * `logo` string field in one of two forms:
 *
 *   1. An https:// URL pointing at an image hosted by the org.
 *   2. A data: URL carrying the uploaded image itself
 *      (data:image/<type>;base64,...) — the settings UI reads the
 *      chosen file with FileReader and submits the data URL
 *      through the same JSON settings PUT the org settings page
 *      already uses, so no new storage infrastructure is invented.
 *
 * Only raster/vector image types the surfaces can render are
 * accepted (png, jpeg, webp, svg), and data URLs are size-capped
 * so a logo stays a logo, not a file store.
 */

/** Maximum decoded image size for an uploaded (data URL) logo. */
export const ORG_LOGO_MAX_BYTES = 200 * 1024; // 200 KB

const ALLOWED_DATA_URL_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
] as const;

const DATA_URL_PATTERN =
  /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=\s]+)$/;

export type OrgLogoValidation =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

/**
 * Validate a logo value being saved. `null` / empty string means
 * "no logo" (removal) and is always valid. Anything else must be
 * an https URL or an allowed image data URL within the size cap.
 */
export function validateOrgLogo(input: unknown): OrgLogoValidation {
  if (input === null || input === undefined || input === "") {
    return { ok: true, value: null };
  }
  if (typeof input !== "string") {
    return { ok: false, error: "Logo must be an image file or an image URL." };
  }

  const value = input.trim();

  if (value.startsWith("data:")) {
    const match = DATA_URL_PATTERN.exec(value);
    if (!match) {
      return {
        ok: false,
        error:
          "Unsupported image. Upload a PNG, JPG, WebP, or SVG image.",
      };
    }
    // Decoded size from the base64 payload length (4 chars -> 3
    // bytes, minus padding). Reject before storing anything big.
    const base64 = match[2].replace(/\s/g, "");
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    const decodedBytes = Math.floor((base64.length * 3) / 4) - padding;
    if (decodedBytes > ORG_LOGO_MAX_BYTES) {
      return {
        ok: false,
        error: `Logo image is too large. Maximum size is ${Math.round(
          ORG_LOGO_MAX_BYTES / 1024,
        )} KB.`,
      };
    }
    return { ok: true, value };
  }

  if (value.startsWith("https://")) {
    try {
      // Must be a parseable absolute URL; rendering surfaces use
      // it as an <img> source only.
      new URL(value);
    } catch {
      return { ok: false, error: "Logo URL is not a valid URL." };
    }
    return { ok: true, value };
  }

  return {
    ok: false,
    error:
      "Logo must be an uploaded PNG, JPG, WebP, or SVG image, or an https:// image URL.",
  };
}

/** The image MIME types the upload input accepts. */
export const ORG_LOGO_ACCEPT = ALLOWED_DATA_URL_TYPES.join(",");
