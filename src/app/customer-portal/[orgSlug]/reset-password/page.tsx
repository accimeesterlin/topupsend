"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { Button, Input, Label, Alert, AlertDescription } from "@topupsend/ui";

export default function ResetPasswordPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const [orgSlug, setOrgSlug] = useState<string>("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t } = useTranslation();

  const token = searchParams.get("token");
  const email = searchParams.get("email");

  useEffect(() => {
    params.then((p) => setOrgSlug(p.orgSlug));
  }, [params]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      setError(t("customer.resetPassword.passwordMismatch"));
      return;
    }

    if (!token) {
      setError(t("customer.resetPassword.noToken"));
      return;
    }

    setLoading(true);
    setError("");
    setSuccess(false);

    try {
      const res = await fetch("/api/v1/customer-auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email, password, orgSlug }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || data.title || t("customer.resetPassword.error"));
      }

      setSuccess(true);
      setTimeout(() => {
        router.push(`/customer-portal/${orgSlug}/login`);
      }, 2000);
    } catch (err: any) {
      setError(err.message || t("customer.resetPassword.error"));
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
          <Alert variant="destructive">
            <AlertDescription>{t("customer.resetPassword.noToken")}</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            {t("customer.resetPassword.title")}
          </h1>
          <p className="text-gray-600 mt-2">
            {t("customer.resetPassword.subtitle")}
          </p>
        </div>

        {success ? (
          <Alert className="bg-green-50 border-green-200">
            <AlertDescription className="text-green-700">
              {t("customer.resetPassword.successMessage")}
            </AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div>
              <Label htmlFor="password">
                {t("customer.resetPassword.newPassword")}
              </Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="confirmPassword">
                {t("customer.resetPassword.confirmPassword")}
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full"
            >
              {loading
                ? t("customer.resetPassword.resetting")
                : t("customer.resetPassword.resetButton")}
            </Button>

            <div className="text-center">
              <Link
                href={`/customer-portal/${orgSlug}/login`}
                className="text-sm text-primary hover:underline"
              >
                {t("customer.resetPassword.backToLogin")}
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
