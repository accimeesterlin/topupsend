import { Button } from '@topupsend/ui';

/**
 * The "Continue with PGecom" button for the login page, mirroring
 * Servanzo's shared PG sign-in button. Presentational only: the
 * caller decides visibility (the server-rendered login page checks
 * lib/pg-sso/config) — while the PG client env is unset this is never
 * rendered at all. It is a plain anchor to the start route: the flow
 * must work without client JS, and the route is what mints the state
 * cookie.
 */
export default function PgSignInButton({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Button asChild variant="outline" className="w-full">
      <a href={href}>{label}</a>
    </Button>
  );
}
