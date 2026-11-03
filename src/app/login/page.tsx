import LoginForm from './login-form';
import { isPgSsoConfigured } from '@/lib/pg-sso/config';

/**
 * The login page is server-rendered so the "Continue with PGecom"
 * button's visibility is decided where the PG client env lives:
 * while PG_SSO_SANDBOX_CLIENT_ID / PG_SSO_SANDBOX_CLIENT_SECRET are
 * unset, the form renders exactly as it did before Sign in with PG
 * existed. The ?pg_error= reason is how the PG callback reports a
 * refused sign-in back to this surface.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ pg_error?: string }>;
}) {
  const params = await searchParams;
  return <LoginForm pgSsoEnabled={isPgSsoConfigured()} pgError={params.pg_error} />;
}
