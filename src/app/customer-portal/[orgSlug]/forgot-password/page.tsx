"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { Button, Input, Label, Alert, AlertDescription } from "@topupsend/ui";

export default function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const [orgSlug, setOrgSlug] = useState<string>("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    params.then((p) => setOrgSlug(p.orgSlug));
  }, [params]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess(false);

    try {
      const res = await fetch("/api/v1/customer-auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, orgSlug }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || "Request failed");
      }

      setSuccess(true);
    } catch (err: any) {
      setError(err.message || t("customer.forgotPassword.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            {t("customer.forgotPassword.title")}
          </h1>
          <p className="text-gray-600 mt-2">
            {t("customer.forgotPassword.subtitle")}
          </p>
        </div>

        {success ? (
          <Alert className="bg-green-50 border-green-200">
            <AlertDescription className="text-green-700">
              <p className="mb-2">
                {t("customer.forgotPassword.successMessage")}
              </p>
              <Link
                href={`/customer-portal/${orgSlug}/login`}
                className="text-green-800 underline font-medium"
              >
                {t("customer.forgotPassword.backToLogin")}
              </Link>
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
              <Label htmlFor="email">
                {t("customer.forgotPassword.email")}
              </Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("customer.forgotPassword.emailPlaceholder")}
                className="mt-1"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full"
            >
              {loading
                ? t("customer.forgotPassword.sending")
                : t("customer.forgotPassword.sendButton")}
            </Button>

            <div className="text-center">
              <Link
                href={`/customer-portal/${orgSlug}/login`}
                className="text-sm text-primary hover:underline"
              >
                {t("customer.forgotPassword.backToLogin")}
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
