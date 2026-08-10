"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Globe,
  Zap,
  Shield,
  BarChart3,
  Users,
  CreditCard,
  ArrowRight,
  Check,
  ChevronDown,
  Wallet,
  Settings,
  Bell,
  TrendingUp,
  Lock,
  RefreshCw,
  Mail,
  Key,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PricingCards } from "@/components/PricingCards";
import { PublicNavbar } from "@/components/PublicNavbar";
import { useLanguage } from "@/lib/i18n/LanguageContext";

/* ─────────────────────────────────────────────────────────── */
/*  STATIC CONFIG (icons, colours — no translatable strings)   */
/* ─────────────────────────────────────────────────────────── */

const STATS_VALUES = [
  { labelKey: "homepage.stats.countries", value: "150+" },
  { labelKey: "homepage.stats.transactions", value: "10K+" },
  { labelKey: "homepage.stats.uptime", value: "99.9%" },
  { labelKey: "homepage.stats.operators", value: "500+" },
];

const HOW_IT_WORKS_ICONS = [
  {
    step: "01",
    titleKey: "homepage.howItWorks.step1Title",
    descKey: "homepage.howItWorks.step1Desc",
    icon: Building2,
  },
  {
    step: "02",
    titleKey: "homepage.howItWorks.step2Title",
    descKey: "homepage.howItWorks.step2Desc",
    icon: RefreshCw,
  },
  {
    step: "03",
    titleKey: "homepage.howItWorks.step3Title",
    descKey: "homepage.howItWorks.step3Desc",
    icon: TrendingUp,
  },
];

const FEATURES_CONFIG = [
  {
    icon: Globe,
    titleKey: "homepage.features.globalTitle",
    descKey: "homepage.features.globalDesc",
    color: "text-blue-600",
    bg: "bg-blue-50",
  },
  {
    icon: Settings,
    titleKey: "homepage.features.pricingTitle",
    descKey: "homepage.features.pricingDesc",
    color: "text-purple-600",
    bg: "bg-purple-50",
  },
  {
    icon: Wallet,
    titleKey: "homepage.features.walletTitle",
    descKey: "homepage.features.walletDesc",
    color: "text-emerald-600",
    bg: "bg-emerald-50",
  },
  {
    icon: Users,
    titleKey: "homepage.features.multitenantTitle",
    descKey: "homepage.features.multitenantDesc",
    color: "text-orange-600",
    bg: "bg-orange-50",
  },
  {
    icon: CreditCard,
    titleKey: "homepage.features.paymentsTitle",
    descKey: "homepage.features.paymentsDesc",
    color: "text-rose-600",
    bg: "bg-rose-50",
  },
  {
    icon: BarChart3,
    titleKey: "homepage.features.analyticsTitle",
    descKey: "homepage.features.analyticsDesc",
    color: "text-sky-600",
    bg: "bg-sky-50",
  },
];

const CAPABILITIES_CONFIG = [
  {
    badgeKey: "homepage.capabilities.whitelabelBadge",
    titleKey: "homepage.capabilities.whitelabelTitle",
    descKey: "homepage.capabilities.whitelabelDesc",
    bulletKeys: [
      "homepage.capabilities.whitelabelBullet1",
      "homepage.capabilities.whitelabelBullet2",
      "homepage.capabilities.whitelabelBullet3",
      "homepage.capabilities.whitelabelBullet4",
    ],
    icon: Building2,
    iconBg: "bg-indigo-100",
    iconColor: "text-indigo-600",
  },
  {
    badgeKey: "homepage.capabilities.apiBadge",
    titleKey: "homepage.capabilities.apiTitle",
    descKey: "homepage.capabilities.apiDesc",
    bulletKeys: [
      "homepage.capabilities.apiBullet1",
      "homepage.capabilities.apiBullet2",
      "homepage.capabilities.apiBullet3",
      "homepage.capabilities.apiBullet4",
    ],
    icon: Key,
    iconBg: "bg-violet-100",
    iconColor: "text-violet-600",
  },
  {
    badgeKey: "homepage.capabilities.customerBadge",
    titleKey: "homepage.capabilities.customerTitle",
    descKey: "homepage.capabilities.customerDesc",
    bulletKeys: [
      "homepage.capabilities.customerBullet1",
      "homepage.capabilities.customerBullet2",
      "homepage.capabilities.customerBullet3",
      "homepage.capabilities.customerBullet4",
    ],
    icon: Users,
    iconBg: "bg-teal-100",
    iconColor: "text-teal-600",
  },
  {
    badgeKey: "homepage.capabilities.securityBadge",
    titleKey: "homepage.capabilities.securityTitle",
    descKey: "homepage.capabilities.securityDesc",
    bulletKeys: [
      "homepage.capabilities.securityBullet1",
      "homepage.capabilities.securityBullet2",
      "homepage.capabilities.securityBullet3",
      "homepage.capabilities.securityBullet4",
    ],
    icon: Lock,
    iconBg: "bg-red-100",
    iconColor: "text-red-600",
  },
];

const TRUST_PILLARS_CONFIG = [
  {
    icon: Shield,
    titleKey: "homepage.trust.securityTitle",
    descKey: "homepage.trust.securityDesc",
  },
  {
    icon: RefreshCw,
    titleKey: "homepage.trust.retriesTitle",
    descKey: "homepage.trust.retriesDesc",
  },
  {
    icon: Bell,
    titleKey: "homepage.trust.alertsTitle",
    descKey: "homepage.trust.alertsDesc",
  },
  {
    icon: Mail,
    titleKey: "homepage.trust.emailTitle",
    descKey: "homepage.trust.emailDesc",
  },
];

const FAQ_KEYS = [
  { qKey: "homepage.faqSection.q1", aKey: "homepage.faqSection.a1" },
  { qKey: "homepage.faqSection.q2", aKey: "homepage.faqSection.a2" },
  { qKey: "homepage.faqSection.q3", aKey: "homepage.faqSection.a3" },
  { qKey: "homepage.faqSection.q4", aKey: "homepage.faqSection.a4" },
  { qKey: "homepage.faqSection.q5", aKey: "homepage.faqSection.a5" },
  { qKey: "homepage.faqSection.q6", aKey: "homepage.faqSection.a6" },
];

const FOOTER_PRODUCT_LINKS = [
  { key: "homepage.footer.features", href: "#features" },
  { key: "homepage.footer.pricing", href: "/pricing" },
  { key: "homepage.footer.apiDocs", href: "/api-docs" },
  { key: "homepage.footer.integrations", href: "#" },
];

const FOOTER_COMPANY_LINKS = [
  { key: "homepage.footer.about", href: "#" },
  { key: "homepage.footer.blog", href: "#" },
  { key: "homepage.footer.careers", href: "#" },
  { key: "homepage.footer.contact", href: "#" },
];

const FOOTER_LEGAL_LINKS = [
  { key: "homepage.footer.privacyPolicy", href: "#" },
  { key: "homepage.footer.termsOfService", href: "#" },
  { key: "homepage.footer.cookiePolicy", href: "#" },
  { key: "homepage.footer.security", href: "#" },
];

/* ─────────────────────────────────────────────────────────── */
/*  SUB-COMPONENTS                                              */
/* ─────────────────────────────────────────────────────────── */

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left px-6 py-5 flex items-center justify-between gap-4 hover:bg-gray-50 transition-colors"
      >
        <span className="font-semibold text-gray-900 text-base">
          {question}
        </span>
        <ChevronDown
          className={`h-5 w-5 text-gray-400 flex-shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        className={`overflow-hidden transition-all duration-300 ${open ? "max-h-40 opacity-100" : "max-h-0 opacity-0"}`}
      >
        <p className="px-6 pb-5 text-gray-500 text-sm leading-relaxed">
          {answer}
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */
/*  PAGE                                                        */
/* ─────────────────────────────────────────────────────────── */

export default function Home() {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* ──── NAVBAR ──── */}
      <PublicNavbar />

      {/* ──── HERO ──── */}
      <section className="relative overflow-hidden">
        {/* Subtle gradient orbs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -left-20 w-96 h-96 rounded-full bg-gradient-to-br from-blue-100 to-purple-100 opacity-60 blur-3xl" />
          <div className="absolute -top-20 right-0 w-80 h-80 rounded-full bg-gradient-to-bl from-emerald-100 to-sky-100 opacity-50 blur-3xl" />
          <div className="absolute top-64 left-1/2 -translate-x-1/2 w-2xl h-64 rounded-full bg-gradient-to-r from-violet-100 via-pink-100 to-blue-100 opacity-40 blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-20">
          <div className="text-center max-w-4xl mx-auto">
            <Badge
              variant="secondary"
              className="inline-flex mb-6 text-sm px-3 py-1"
            >
              {t("homepage.badge")}
            </Badge>

            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-gray-900 leading-tight tracking-tight">
              {t("homepage.heroTitle1")}
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600">
                {t("homepage.heroTitle2")}
              </span>
            </h1>

            <p className="mt-6 text-xl text-gray-500 max-w-2xl mx-auto leading-relaxed">
              {t("homepage.heroSubtitle")}
            </p>

            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/signup">
                <Button
                  size="lg"
                  className="bg-gray-900 text-white hover:bg-gray-800 px-8 h-12 text-base font-semibold shadow-lg shadow-gray-900/10"
                >
                  {t("homepage.startFree")}
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
              <Link href="/pricing">
                <Button
                  size="lg"
                  variant="outline"
                  className="px-8 h-12 text-base border-gray-200 text-gray-700"
                >
                  {t("homepage.viewPricing")}
                </Button>
              </Link>
            </div>
          </div>

          {/* Stats bar */}
          <div className="mt-20 max-w-3xl mx-auto">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 bg-white border border-gray-200 rounded-2xl px-6 py-5 shadow-sm">
              {STATS_VALUES.map((s) => (
                <div key={s.labelKey} className="text-center">
                  <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                  <p className="text-xs text-gray-400 mt-0.5 uppercase tracking-wide">
                    {t(s.labelKey)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ──── HOW IT WORKS ──── */}
      <section id="how-it-works" className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <Badge
              variant="outline"
              className="mb-4 text-gray-500 border-gray-300"
            >
              {t("homepage.howItWorks.badge")}
            </Badge>
            <h2 className="text-4xl font-bold text-gray-900">
              {t("homepage.howItWorks.title")}
            </h2>
            <p className="mt-3 text-gray-500 text-lg">
              {t("homepage.howItWorks.subtitle")}
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto relative">
            {/* Connector lines (decorative, desktop only) */}
            <div className="hidden md:block absolute top-12 left-1/3 w-1/3 h-px bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200" />
            <div className="hidden md:block absolute top-12 left-2/3 w-1/3 h-px bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200" />

            {HOW_IT_WORKS_ICONS.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.step}
                  className="relative flex flex-col items-center text-center"
                >
                  <div className="relative z-10 w-24 h-24 rounded-2xl bg-white border border-gray-200 shadow-sm flex items-center justify-center mb-6">
                    <Icon className="h-9 w-9 text-gray-800" />
                  </div>
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                    {item.step}
                  </span>
                  <h3 className="text-lg font-bold text-gray-900 mb-2">
                    {t(item.titleKey)}
                  </h3>
                  <p className="text-sm text-gray-500 leading-relaxed max-w-xs">
                    {t(item.descKey)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ──── FEATURES GRID ──── */}
      <section id="features" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <Badge
              variant="outline"
              className="mb-4 text-gray-500 border-gray-300"
            >
              {t("homepage.features.badge")}
            </Badge>
            <h2 className="text-4xl font-bold text-gray-900">
              {t("homepage.features.title")}
            </h2>
            <p className="mt-3 text-gray-500 text-lg">
              {t("homepage.features.subtitle")}
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {FEATURES_CONFIG.map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.titleKey}
                  className="group bg-white border border-gray-200 rounded-2xl p-6 hover:shadow-md hover:border-gray-300 transition-all duration-200"
                >
                  <div
                    className={`inline-flex items-center justify-center w-12 h-12 rounded-xl ${f.bg} mb-5`}
                  >
                    <Icon className={`h-5 w-5 ${f.color}`} />
                  </div>
                  <h3 className="text-base font-bold text-gray-900 mb-2">
                    {t(f.titleKey)}
                  </h3>
                  <p className="text-sm text-gray-500 leading-relaxed">
                    {t(f.descKey)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ──── CAPABILITIES (alternating) ──── */}
      <section className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <Badge
              variant="outline"
              className="mb-4 text-gray-500 border-gray-300"
            >
              {t("homepage.capabilities.badge")}
            </Badge>
            <h2 className="text-4xl font-bold text-gray-900">
              {t("homepage.capabilities.title")}
            </h2>
            <p className="mt-3 text-gray-500 text-lg">
              {t("homepage.capabilities.subtitle")}
            </p>
          </div>

          <div className="space-y-20 max-w-5xl mx-auto">
            {CAPABILITIES_CONFIG.map((cap, idx) => {
              const Icon = cap.icon;
              const isEven = idx % 2 === 0;
              return (
                <div
                  key={cap.titleKey}
                  className={`grid md:grid-cols-2 gap-12 items-center ${isEven ? "" : "md:[&>div:first-child]:order-2"}`}
                >
                  {/* Content */}
                  <div>
                    <Badge variant="secondary" className="mb-4 text-sm">
                      {t(cap.badgeKey)}
                    </Badge>
                    <h3 className="text-3xl font-bold text-gray-900 leading-tight">
                      {t(cap.titleKey)}
                    </h3>
                    <p className="mt-3 text-gray-500 leading-relaxed">
                      {t(cap.descKey)}
                    </p>
                    <ul className="mt-6 space-y-3">
                      {cap.bulletKeys.map((bKey) => (
                        <li key={bKey} className="flex items-start gap-3">
                          <div className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-gray-900 flex items-center justify-center">
                            <Check className="h-3 w-3 text-white" />
                          </div>
                          <span className="text-sm text-gray-600">
                            {t(bKey)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Visual card */}
                  <div className="bg-white border border-gray-200 rounded-3xl p-8 shadow-sm flex flex-col items-center justify-center min-h-64">
                    <div
                      className={`w-20 h-20 rounded-2xl ${cap.iconBg} flex items-center justify-center mb-6`}
                    >
                      <Icon className={`h-9 w-9 ${cap.iconColor}`} />
                    </div>
                    <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                      {t(cap.badgeKey)}
                    </h4>
                    <p className="text-xs text-gray-400 mt-1 text-center max-w-xs">
                      {t(cap.descKey).split(".")[0]}.
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ──── TRUST PILLARS ──── */}
      <section className="py-20 bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-center text-3xl font-bold mb-12">
            {t("homepage.trust.title")}
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 max-w-5xl mx-auto">
            {TRUST_PILLARS_CONFIG.map((pillar) => {
              const Icon = pillar.icon;
              return (
                <div key={pillar.titleKey} className="text-center">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-gray-800 mb-4">
                    <Icon className="h-6 w-6 text-gray-300" />
                  </div>
                  <h3 className="font-bold text-base">{t(pillar.titleKey)}</h3>
                  <p className="text-sm text-gray-400 mt-1.5 leading-relaxed">
                    {t(pillar.descKey)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ──── PRICING PREVIEW ──── */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <Badge
              variant="outline"
              className="mb-4 text-gray-500 border-gray-300"
            >
              {t("homepage.pricingSection.badge")}
            </Badge>
            <h2 className="text-4xl font-bold text-gray-900">
              {t("homepage.pricingSection.title")}
            </h2>
            <p className="mt-3 text-gray-500 text-lg">
              {t("homepage.pricingSection.subtitle")}
            </p>
          </div>

          <PricingCards variant="homepage" />
        </div>
      </section>

      {/* ──── FAQ ──── */}
      <section id="faq" className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <Badge
              variant="outline"
              className="mb-4 text-gray-500 border-gray-300"
            >
              {t("homepage.faqSection.badge")}
            </Badge>
            <h2 className="text-4xl font-bold text-gray-900">
              {t("homepage.faqSection.title")}
            </h2>
          </div>

          <div className="max-w-2xl mx-auto space-y-3">
            {FAQ_KEYS.map((faq) => (
              <FAQItem
                key={faq.qKey}
                question={t(faq.qKey)}
                answer={t(faq.aKey)}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ──── FINAL CTA ──── */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden bg-gray-900 rounded-3xl px-8 py-16 text-center">
            {/* Decorative blurs */}
            <div className="absolute -top-20 -left-20 w-64 h-64 rounded-full bg-blue-600 opacity-10 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-20 -right-20 w-64 h-64 rounded-full bg-purple-600 opacity-10 blur-3xl pointer-events-none" />

            <div className="relative z-10">
              <h2 className="text-4xl sm:text-5xl font-bold text-white leading-tight">
                {t("homepage.cta.title")}
              </h2>
              <p className="mt-4 text-gray-400 text-lg max-w-xl mx-auto">
                {t("homepage.cta.subtitle")}
              </p>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link href="/signup">
                  <Button
                    size="lg"
                    className="bg-white text-gray-900 hover:bg-gray-100 px-8 h-12 text-base font-semibold shadow-lg"
                  >
                    {t("homepage.cta.startFree")}
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
                <Link href="/pricing">
                  <Button
                    size="lg"
                    variant="outline"
                    className="px-8 h-12 text-base border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white"
                  >
                    {t("homepage.cta.viewPricing")}
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ──── FOOTER ──── */}
      <footer className="border-t border-gray-200 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid sm:grid-cols-4 gap-10">
            {/* Brand */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 rounded-lg bg-gray-900 flex items-center justify-center">
                  <Zap className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="font-bold text-gray-900">TopUpSend</span>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed max-w-xs">
                {t("homepage.footer.brandDesc")}
              </p>
            </div>

            {/* Product */}
            <div>
              <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-4">
                {t("homepage.footer.product")}
              </h4>
              <ul className="space-y-2.5">
                {FOOTER_PRODUCT_LINKS.map((item) => (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
                    >
                      {t(item.key)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Company */}
            <div>
              <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-4">
                {t("homepage.footer.company")}
              </h4>
              <ul className="space-y-2.5">
                {FOOTER_COMPANY_LINKS.map((item) => (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
                    >
                      {t(item.key)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-4">
                {t("homepage.footer.legal")}
              </h4>
              <ul className="space-y-2.5">
                {FOOTER_LEGAL_LINKS.map((item) => (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
                    >
                      {t(item.key)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-12 pt-8 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs text-gray-400">
              {t("homepage.footer.copyright")}
            </p>
            <div className="flex items-center gap-6">
              <Link
                href="/login"
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                {t("homepage.footer.staffSignIn")}
              </Link>
              <Link
                href="/signup"
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                {t("homepage.footer.getStarted")}
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
