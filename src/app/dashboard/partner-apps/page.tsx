import { DashboardLayout } from "@/components/dashboard-layout";
import PartnerAppsGrid from "@/components/partner-apps-grid";
import { getPartnerApps } from "@/lib/partner-apps/partner-apps";

/**
 * Partner Apps — the PG platform catalog, rendered in TopUpSend.
 *
 * The catalog is owned by PG Top Up (the hub) and read server-side
 * from its public feed; when the feed cannot be read, a static seed
 * list renders instead, so this page never renders broken or empty
 * (see lib/partner-apps/partner-apps.ts). TopUpSend's own entry is
 * excluded — an app does not promote itself.
 */
export default async function PartnerAppsPage() {
  const apps = await getPartnerApps();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Partner Apps</h1>
          <p className="text-muted-foreground mt-1">
            Other apps on the PG platform, plus affiliated apps
          </p>
        </div>

        <PartnerAppsGrid apps={apps} />
      </div>
    </DashboardLayout>
  );
}
