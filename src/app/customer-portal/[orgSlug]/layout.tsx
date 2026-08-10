"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LanguageProvider, useTranslation } from "@/lib/i18n/LanguageContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { cn, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, Badge } from "@topupsend/ui";
import {
  LayoutDashboard,
  Send,
  History,
  Settings,
  Key,
  LogOut,
  Menu,
  X,
  User,
  ChevronDown,
  BookOpen,
} from "lucide-react";

function CustomerPortalContent({
  children,
  orgSlug,
  isAuthPage,
}: {
  children: React.ReactNode;
  orgSlug: string;
  isAuthPage: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navigation = [
    {
      name: t("customer.portal.menu.dashboard"),
      href: `/customer-portal/${orgSlug}/dashboard`,
      icon: LayoutDashboard,
    },
    {
      name: t("customer.portal.menu.sendMinutes"),
      href: `/customer-portal/${orgSlug}/send-minutes`,
      icon: Send,
    },
    {
      name: t("customer.portal.menu.transactions"),
      href: `/customer-portal/${orgSlug}/transactions`,
      icon: History,
    },
    {
      name: "API Keys",
      href: `/customer-portal/${orgSlug}/api-keys`,
      icon: Key,
    },
    {
      name: "API Docs",
      href: `/customer-portal/${orgSlug}/api-docs`,
      icon: BookOpen,
    },
    {
      name: t("customer.portal.menu.settings"),
      href: `/customer-portal/${orgSlug}/settings`,
      icon: Settings,
    },
  ];

  const handleLogout = async () => {
    await fetch("/api/v1/customer-auth/logout", {
      method: "POST",
    });
    router.push(`/customer-portal/${orgSlug}/login`);
  };

  if (isAuthPage) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 bg-white border-r transform transition-transform duration-200 ease-in-out lg:translate-x-0 lg:relative lg:z-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex flex-col h-screen lg:h-full">
          {/* Sidebar header */}
          <div className="flex items-center justify-between h-16 px-4 border-b lg:hidden">
            <span className="text-lg font-semibold text-gray-900">Menu</span>
            <button
              onClick={() => setSidebarOpen(false)}
              className="text-gray-500 hover:text-gray-700"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
            {navigation.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    "flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-gray-700 hover:bg-gray-100",
                  )}
                >
                  <item.icon className="h-5 w-5 mr-3" />
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* Logout button */}
          <div className="p-4 border-t">
            <button
              onClick={handleLogout}
              className="flex items-center w-full px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <LogOut className="h-5 w-5 mr-3" />
              {t("customer.portal.menu.logout")}
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-full overflow-hidden">
        {/* Mobile menu button */}
        <div className="lg:hidden sticky top-0 z-10 bg-white border-b px-4 py-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-gray-700 hover:text-gray-900"
          >
            <Menu className="h-6 w-6" />
          </button>
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

interface CustomerData {
  id: string;
  email?: string;
  name?: string;
  phoneNumber: string;
  emailVerified: boolean;
  currentBalance: number;
  balanceCurrency: string;
}

export default function CustomerPortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const [orgSlug, setOrgSlug] = useState<string>("");
  const [customer, setCustomer] = useState<CustomerData | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    params.then((p) => setOrgSlug(p.orgSlug));
  }, [params]);

  // Fetch customer data for authenticated pages
  useEffect(() => {
    const isAuthPage =
      pathname?.includes("/login") ||
      pathname?.includes("/register") ||
      pathname?.includes("/forgot-password") ||
      pathname?.includes("/reset-password") ||
      pathname?.includes("/verify-email");

    if (!isAuthPage && orgSlug) {
      fetch("/api/v1/customer-auth/me", { credentials: "include" })
        .then((res) => {
          if (res.ok) {
            return res.json();
          }
          return null;
        })
        .then((data) => {
          if (data?.customer) {
            setCustomer(data.customer);
          }
        })
        .catch(() => {
          // Silently fail - user will be redirected by page-level auth
        });
    }
  }, [pathname, orgSlug]);

  const isAuthPage =
    pathname?.includes("/login") || pathname?.includes("/register");

  return (
    <LanguageProvider>
      <div className="h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-white shadow-sm z-30 flex-shrink-0 w-full">
          <div className="flex justify-between items-center h-16 px-4 sm:px-6 lg:px-8 w-full">
              <div className="flex items-center">
                <Link
                  href={`/customer-portal/${orgSlug}`}
                  className="text-2xl font-bold text-primary"
                >
                  Customer Portal
                </Link>
              </div>
              <div className="flex items-center gap-4">
                <LanguageSwitcher />

                {/* User Menu - only show on authenticated pages */}
                {!isAuthPage && customer && (
                  <DropdownMenu>
                    <DropdownMenuTrigger className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2">
                      <div className="flex items-center gap-3">
                        {/* User Avatar */}
                        <div className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                          {customer.name ? customer.name.charAt(0).toUpperCase() : <User className="h-5 w-5" />}
                        </div>

                        {/* User Info - Hide on mobile */}
                        <div className="hidden md:flex flex-col items-start">
                          <span className="text-sm font-medium text-gray-900">
                            {customer.name || "Customer"}
                          </span>
                          <span className="text-xs text-gray-500">
                            {customer.email || customer.phoneNumber}
                          </span>
                        </div>

                        <ChevronDown className="h-4 w-4 text-gray-500" />
                      </div>
                    </DropdownMenuTrigger>

                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuLabel>
                        <div className="flex flex-col space-y-1">
                          <p className="text-sm font-medium leading-none">
                            {customer.name || "Customer"}
                          </p>
                          <p className="text-xs leading-none text-muted-foreground">
                            {customer.email || customer.phoneNumber}
                          </p>
                        </div>
                      </DropdownMenuLabel>

                      <DropdownMenuSeparator />

                      <div className="px-2 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-700">Balance</span>
                          <Badge variant="default" className="font-semibold">
                            {customer.balanceCurrency} {customer.currentBalance.toFixed(2)}
                          </Badge>
                        </div>
                        {!customer.emailVerified && (
                          <div className="mt-2">
                            <Badge variant="destructive" className="text-xs">
                              Email Not Verified
                            </Badge>
                          </div>
                        )}
                      </div>

                      <DropdownMenuSeparator />

                      <DropdownMenuItem asChild>
                        <Link
                          href={`/customer-portal/${orgSlug}/dashboard`}
                          className="cursor-pointer"
                        >
                          <LayoutDashboard className="mr-2 h-4 w-4" />
                          <span>Dashboard</span>
                        </Link>
                      </DropdownMenuItem>

                      <DropdownMenuItem asChild>
                        <Link
                          href={`/customer-portal/${orgSlug}/settings`}
                          className="cursor-pointer"
                        >
                          <Settings className="mr-2 h-4 w-4" />
                          <span>Settings</span>
                        </Link>
                      </DropdownMenuItem>

                      <DropdownMenuSeparator />

                      <DropdownMenuItem
                        onClick={async () => {
                          await fetch("/api/v1/customer-auth/logout", {
                            method: "POST",
                          });
                          router.push(`/customer-portal/${orgSlug}/login`);
                        }}
                        className="cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50"
                      >
                        <LogOut className="mr-2 h-4 w-4" />
                        <span>Log out</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
          </div>
        </header>

        {/* Main Content with Sidebar */}
        <div className="flex-1 overflow-hidden">
          <CustomerPortalContent orgSlug={orgSlug} isAuthPage={isAuthPage}>
            {children}
          </CustomerPortalContent>
        </div>
      </div>
    </LanguageProvider>
  );
}
