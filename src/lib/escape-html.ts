/**
 * Escape a value for safe interpolation into HTML (email bodies, markup).
 *
 * User- and org-controlled strings (org names, inviter/customer names,
 * free-text messages) must never reach an HTML template raw: an org admin
 * could otherwise store markup that renders in mail received by invitees
 * and customers (F-M14). Plain-text bodies and headers do not need this —
 * apply it only at HTML interpolation points.
 */
const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}
