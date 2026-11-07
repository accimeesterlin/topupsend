/* eslint-disable @next/next/no-img-element */
import { ExternalLink, HeartHandshake } from "lucide-react";
import { Badge, Button, Card, CardContent } from "@topupsend/ui";
import type { PartnerApp } from "@/lib/partner-apps/partner-apps";

/** Up-to-two-letter monogram from an app name, e.g. "ID Verification Hub" -> "IV". */
function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function PartnerAppCard({ app }: { app: PartnerApp }) {
  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col p-6">
        <div className="flex items-start justify-between gap-3">
          {app.logoUrl ? (
            // Partner logos are arbitrary external URLs managed in the
            // PG Top Up console; render them directly rather than
            // routing them through the image optimizer.
            <img
              src={app.logoUrl}
              alt=""
              className="h-12 w-12 rounded-lg object-contain"
              loading="lazy"
            />
          ) : (
            <div
              aria-hidden
              className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground"
            >
              {monogram(app.name)}
            </div>
          )}
          <Badge variant={app.category === "pg" ? "default" : "secondary"}>
            {app.category === "pg" ? "PG app" : "Affiliated"}
          </Badge>
        </div>

        <h2 className="mt-4 font-semibold">{app.name}</h2>
        {app.tagline && (
          <p className="mt-1 text-sm text-muted-foreground">{app.tagline}</p>
        )}

        <div className="mt-auto pt-6">
          <Button asChild variant="outline" size="sm">
            <a href={app.url} target="_blank" rel="noopener noreferrer">
              Visit
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PartnerAppsGrid({ apps }: { apps: PartnerApp[] }) {
  if (apps.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center p-10 text-center">
          <HeartHandshake className="h-8 w-8 text-muted-foreground" />
          <h2 className="mt-4 font-semibold">No partner apps yet</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Partner apps from the PG platform will appear here once they are
            published.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {apps.map((app) => (
        <PartnerAppCard key={app.url} app={app} />
      ))}
    </div>
  );
}
