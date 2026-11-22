import { redirect } from "next/navigation";

/**
 * The old Settings → API Keys page was a dead end: it listed keys
 * with a response shape the API never returned and offered no way to
 * create one. API keys now live under Developers, grouped by app.
 */
export default function LegacyApiKeysPage() {
  redirect("/dashboard/developers");
}
