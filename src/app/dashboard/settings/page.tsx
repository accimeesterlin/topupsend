"use client";

import {
  Building2,
  CreditCard,
  Bell,
  Shield,
  Plug,
  Store,
  Users,
} from "lucide-react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription } from "@topupsend/ui";
import { DashboardLayout } from "@/components/dashboard-layout";
import { cn } from "@/lib/utils";

const settingsSections = [
  {
    title: "Organization",
    description: "Manage your organization profile and settings",
    icon: Building2,
    href: "/dashboard/settings/organization",
    color: "text-blue-600",
    bgColor: "bg-blue-100",
  },
  {
    title: "Team Members",
    description: "Manage team access and balance limits",
    icon: Users,
    href: "/dashboard/settings/members",
    color: "text-cyan-600",
    bgColor: "bg-cyan-100",
  },
  {
    title: "Storefront",
    description: "Configure your public storefront for selling top-ups",
    icon: Store,
    href: "/dashboard/settings/storefront",
    color: "text-indigo-600",
    bgColor: "bg-indigo-100",
  },
  {
    title: "Payment Settings",
    description: "Configure payment gateways and processing",
    icon: CreditCard,
    href: "/dashboard/settings/payment",
    color: "text-green-600",
    bgColor: "bg-green-100",
  },
  {
    title: "Integrations",
    description: "Connect top-up providers and other services",
    icon: Plug,
    href: "/dashboard/integrations",
    color: "text-purple-600",
    bgColor: "bg-purple-100",
  },
  {
    title: "Notifications",
    description: "Manage email and SMS notification preferences",
    icon: Bell,
    href: "/dashboard/settings/notifications",
    color: "text-yellow-600",
    bgColor: "bg-yellow-100",
  },
  {
    title: "Security",
    description: "API keys, authentication and access control",
    icon: Shield,
    href: "/dashboard/settings/security",
    color: "text-red-600",
    bgColor: "bg-red-100",
  },
];

export default function SettingsPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-1">
            Manage your account and platform preferences
          </p>
        </div>

        {/* Settings Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {settingsSections.map((section) => (
            <Link key={section.href} href={section.href}>
              <Card className="hover:border-primary transition-colors cursor-pointer h-full">
                <CardHeader>
                  <div
                    className={cn(
                      "h-12 w-12 rounded-lg flex items-center justify-center mb-3",
                      section.bgColor,
                    )}
                  >
                    <section.icon className={cn("h-6 w-6", section.color)} />
                  </div>
                  <CardTitle>{section.title}</CardTitle>
                  <CardDescription>{section.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
