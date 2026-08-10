"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { Button, Input, Label, Alert, AlertDescription } from "@topupsend/ui";
import { TwoFactorModal } from "@/components/customer/TwoFactorModal";

export default function CustomerLoginPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const [orgSlug, setOrgSlug] = useState<string>("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [show2FAModal, setShow2FAModal] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation();

  useEffect(() => {
    params.then((p) => setOrgSlug(p.orgSlug));
  }, [params]);

  // Pre-fill email from URL search params (e.g., from admin "Customer Portal" link)
  useEffect(() => {
    const emailParam = searchParams.get("email");
    if (emailParam && !email) {
      setEmail(emailParam);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/v1/customer-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, orgSlug }),
      });

      const text = await res.text();
      const data = text ? JSON.parse(text) : {};

      if (!res.ok) {
        throw new Error(data.detail || data.error?.message || "Login failed");
      }

      // Check if 2FA is required
      if (data.requires2FA) {
        setShow2FAModal(true);
        return;
      }

      // Redirect to dashboard (no 2FA required)
      router.push(`/customer-portal/${orgSlug}/dashboard`);
    } catch (err: any) {
      setError(err.message || t("customer.login.error"));
    } finally {
      setLoading(false);
    }
  };

  const handle2FASuccess = () => {
    setShow2FAModal(false);
    router.push(`/customer-portal/${orgSlug}/dashboard`);
  };

  return (
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            {t("customer.login.title")}
          </h1>
          <p className="text-gray-600 mt-2">{t("customer.login.subtitle")}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">
              {t("customer.login.email")}
            </Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("customer.login.emailPlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">
              {t("customer.login.password")}
            </Label>
            <Input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("customer.login.passwordPlaceholder")}
            />
          </div>

          <div className="flex items-center justify-between">
            <Link
              href={`/customer-portal/${orgSlug}/forgot-password`}
              className="text-sm text-primary hover:underline"
            >
              {t("customer.login.forgotPassword")}
            </Link>
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full"
          >
            {loading
              ? t("customer.login.loggingIn")
              : t("customer.login.loginButton")}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-muted-foreground">
            {t("customer.login.noAccount")}{" "}
            <Link
              href={`/customer-portal/${orgSlug}/register`}
              className="text-primary hover:underline font-medium"
            >
              {t("customer.login.registerLink")}
            </Link>
          </p>
        </div>
      </div>

      {/* 2FA Modal */}
      <TwoFactorModal
        open={show2FAModal}
        onClose={() => setShow2FAModal(false)}
        email={email}
        orgSlug={orgSlug}
        onSuccess={handle2FASuccess}
      />
    </div>
  );
}
