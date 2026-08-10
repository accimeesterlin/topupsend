"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ShoppingCart,
  Users,
  CreditCard,
  Settings,
  BarChart3,
  Menu,
  X,
  LogOut,
  Building2,
  Bell,
  ChevronDown,
  Plug,
  Store,
  Tag,
  Globe,
  DollarSign,
  User,
  Shield,
} from "lucide-react";
import { Button } from "@topupsend/ui";
import { cn } from "@/lib/utils";
import { OrganizationSwitcher } from "./organization-switcher";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

// Organized navigation with sections
const navigationSections = [
  {
    title: "Overview",
    items: [
      { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { name: "Analytics", href: "/dashboard/analytics", icon: BarChart3 },
    ],
  },
  {
    title: "Storefront",
    items: [
      { name: "Settings", href: "/dashboard/storefront", icon: Store },
      { name: "Pricing", href: "/dashboard/pricing", icon: DollarSign },
      { name: "Discounts", href: "/dashboard/discounts", icon: Tag },
      { name: "Countries", href: "/dashboard/countries", icon: Globe },
    ],
  },
  {
    title: "Business",
    items: [
      {
        name: "Transactions",
        href: "/dashboard/transactions",
        icon: ShoppingCart,
      },
      { name: "Customers", href: "/dashboard/customers", icon: Users },
    ],
  },
  {
    title: "Configuration",
    items: [
      { name: "Team Members", href: "/dashboard/team", icon: Users },
      { name: "Integrations", href: "/dashboard/integrations", icon: Plug },
      {
        name: "Payment Settings",
        href: "/dashboard/settings/payment",
        icon: CreditCard,
      },
      { name: "Audit Logs", href: "/dashboard/audit", icon: Shield },
      { name: "Settings", href: "/dashboard/settings", icon: Settings },
    ],
  },
];

// Flatten for active item detection
const navigation = navigationSections.flatMap((section) => section.items);

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [_organization, setOrganization] = useState<{ name: string } | null>(
    null,
  );
  const [user, setUser] = useState<{ email: string; roles: string[] } | null>(
    null,
  );
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    fetchOrganization();
    fetchUser();
  }, []);

  const fetchOrganization = async () => {
    try {
      const response = await fetch("/api/v1/organization");
      if (response.ok) {
        const data = await response.json();
        setOrganization(data);
      }
    } catch (error) {
      console.error("Failed to fetch organization:", error);
    }
  };

  const fetchUser = async () => {
    try {
      const response = await fetch("/api/v1/auth/me");
      if (response.ok) {
        const data = await response.json();
        setUser(data);
      }
    } catch (error) {
      console.error("Failed to fetch user:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
      router.push("/");
    } catch (err) {
      console.error("Logout failed:", err);
      router.push("/");
    }
  };

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 transform bg-background border-r transition-transform duration-200 ease-in-out lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="flex h-16 items-center gap-3 px-6">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <CreditCard className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="flex-1">
              <h1 className="text-sm font-bold">TopUpSend</h1>
              <p className="text-xs text-muted-foreground">Seller Platform</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="lg:hidden"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto px-3 py-4">
            {(() => {
              // Find the best matching navigation item (most specific match)
              const activeItem =
                navigation.find((nav) => pathname === nav.href) ||
                navigation
                  .filter((nav) => pathname.startsWith(nav.href + "/"))
                  .sort((a, b) => b.href.length - a.href.length)[0];

              return navigationSections.map((section, sectionIdx) => (
                <div
                  key={section.title}
                  className={sectionIdx > 0 ? "mt-6" : ""}
                >
                  <h3 className="mb-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {section.title}
                  </h3>
                  <div className="space-y-1">
                    {section.items.map((item) => {
                      const isActive = item.href === activeItem?.href;
                      return (
                        <Link
                          key={item.name}
                          href={item.href}
                          className={cn(
                            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                            isActive
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                          onClick={() => setSidebarOpen(false)}
                        >
                          <item.icon className="h-5 w-5" />
                          {item.name}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ));
            })()}
          </nav>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-40 flex h-16 items-center gap-4 border-b bg-background px-6">
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>

          <div className="flex-1" />

          {/* Right side - Notifications, Organization Switcher, Profile */}
          <div className="flex items-center gap-2">
            {/* Notifications (red dot temporarily disabled) */}
            <Button variant="ghost" size="sm" className="relative">
              <Bell className="h-5 w-5" />
            </Button>

            {/* Organization Switcher */}
            <OrganizationSwitcher />

            {/* Profile Dropdown */}
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                className="flex items-center gap-2"
              >
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="h-4 w-4 text-primary" />
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </Button>

              {/* Profile Dropdown Menu */}
              {profileDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setProfileDropdownOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-64 rounded-md border bg-popover text-popover-foreground shadow-lg z-50 animate-in fade-in-0 zoom-in-95">
                    <div className="p-3 border-b">
                      <p className="text-sm font-medium">
                        {user?.email || "Loading..."}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {user?.roles?.join(", ") || "User"}
                      </p>
                    </div>
                    <div className="p-1">
                      <Link
                        href="/dashboard/settings"
                        className="flex items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent transition-colors"
                        onClick={() => setProfileDropdownOpen(false)}
                      >
                        <Settings className="h-4 w-4" />
                        Settings
                      </Link>
                      <Link
                        href="/dashboard/settings/organization"
                        className="flex items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent transition-colors"
                        onClick={() => setProfileDropdownOpen(false)}
                      >
                        <Building2 className="h-4 w-4" />
                        Organization
                      </Link>
                      <div className="border-t my-1" />
                      <button
                        onClick={() => {
                          setProfileDropdownOpen(false);
                          handleLogout();
                        }}
                        className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm text-destructive hover:bg-accent transition-colors"
                      >
                        <LogOut className="h-4 w-4" />
                        Sign Out
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
