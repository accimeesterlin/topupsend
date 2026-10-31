"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default function StaffPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <LanguageProvider>
      <div className="min-h-screen bg-background">
        {/* Header */}
        <header className="bg-card border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-8">
                <Link
                  href="/staff-portal"
                  className="text-2xl font-bold text-foreground"
                >
                  Staff Portal
                </Link>
                <nav className="hidden md:flex space-x-4">
                  <Link
                    href="/staff-portal"
                    className={`px-3 py-2 rounded-lg text-sm font-medium ${
                      pathname === "/staff-portal"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    Dashboard
                  </Link>
                  <Link
                    href="/staff-portal/my-transactions"
                    className={`px-3 py-2 rounded-lg text-sm font-medium ${
                      pathname === "/staff-portal/my-transactions"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    My Transactions
                  </Link>
                  <Link
                    href="/staff-portal/my-api-keys"
                    className={`px-3 py-2 rounded-lg text-sm font-medium ${
                      pathname === "/staff-portal/my-api-keys"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    API Keys
                  </Link>
                  <Link
                    href="/staff-portal/my-account"
                    className={`px-3 py-2 rounded-lg text-sm font-medium ${
                      pathname === "/staff-portal/my-account"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    My Account
                  </Link>
                </nav>
              </div>
              <div className="flex items-center space-x-4">
                <LanguageSwitcher />
                <Link
                  href="/dashboard"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Back to Admin
                </Link>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>

        {/* Footer */}
        <footer className="bg-card border-t mt-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <p className="text-center text-muted-foreground text-sm">
              © {new Date().getFullYear()} Prepaid Minutes Staff Portal. All
              rights reserved.
            </p>
          </div>
        </footer>
      </div>
    </LanguageProvider>
  );
}
