"use client";

import Link from "next/link";
import { Zap, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useLanguage } from "@/lib/i18n/LanguageContext";

export function PublicNavbar() {
  const { t } = useLanguage();

  return (
    <nav className="sticky top-0 z-50 border-b border-gray-100 bg-white/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <span className="text-lg font-bold text-gray-900">TopUpSend</span>
          </Link>

          <div className="hidden md:flex items-center gap-8">
            <Link
              href="/#how-it-works"
              className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              {t("nav.howItWorks")}
            </Link>
            <Link
              href="/#features"
              className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              {t("nav.features")}
            </Link>
            <Link
              href="/pricing"
              className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              {t("nav.pricing")}
            </Link>
            <Link
              href="/#faq"
              className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              {t("nav.faq")}
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Link href="/login">
              <Button
                variant="ghost"
                size="sm"
                className="text-gray-600 hover:text-gray-900"
              >
                {t("nav.signIn")}
              </Button>
            </Link>
            <Link href="/signup">
              <Button
                size="sm"
                className="bg-gray-900 text-white hover:bg-gray-800"
              >
                {t("nav.getStarted")}
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
