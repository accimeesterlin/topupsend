"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { toast, Button, Alert, AlertDescription } from "@topupsend/ui";

export default function VerifyEmailPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const [orgSlug, setOrgSlug] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [userEmail, setUserEmail] = useState<string>("");
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t } = useTranslation();

  useEffect(() => {
    params.then((p) => setOrgSlug(p.orgSlug));
  }, [params]);

  // Fetch current user's email from session
  useEffect(() => {
    const fetchUserEmail = async () => {
      try {
        const res = await fetch("/api/v1/customer-auth/me");
        if (res.ok) {
          const data = await res.json();
          setUserEmail(data.customer?.email || "");
        }
      } catch (error) {
        console.error("Failed to fetch user email:", error);
      }
    };

    if (orgSlug) {
      fetchUserEmail();
    }
  }, [orgSlug]);

  // Auto-verify if token is in URL
  useEffect(() => {
    const token = searchParams.get("token");
    const email = searchParams.get("email");

    if (token && email && orgSlug) {
      handleVerify(token, email);
    }
  }, [searchParams, orgSlug]);

  const handleVerify = async (token: string, email: string) => {
    setVerifying(true);
    setError("");

    try {
      const res = await fetch("/api/v1/customer-auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email, orgSlug }),
      });

      // Only parse JSON if we have content
      if (res.status === 204 || res.headers.get("content-length") === "0") {
        if (!res.ok) {
          throw new Error("Verification failed");
        }
        setSuccess(true);
        setTimeout(() => {
          router.push(`/customer-portal/${orgSlug}/login`);
        }, 2000);
        return;
      }

      const data = await res.json();

      if (!res.ok) {
        // Handle RFC 7807 Problem Details format
        throw new Error(data.detail || data.title || data.error?.message || "Verification failed");
      }

      setSuccess(true);
      setTimeout(() => {
        router.push(`/customer-portal/${orgSlug}/login`);
      }, 2000);
    } catch (err: any) {
      setError(err.message || t("verification.verifyEmail.error"));
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    if (!userEmail) {
      toast({
        title: t("common.error"),
        description: "Unable to resend verification email. Please log in again.",
        variant: "error",
      });
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/v1/customer-auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: userEmail, orgSlug }),
      });

      // Only parse JSON if we have content
      if (res.status === 204 || res.headers.get("content-length") === "0") {
        if (!res.ok) {
          throw new Error("Resend failed");
        }
        // Success with no content
        toast({
          title: t("common.success"),
          description: t("verification.verifyEmail.resendSuccess"),
          variant: "success",
        });
        return;
      }

      const data = await res.json();

      if (!res.ok) {
        // Handle RFC 7807 Problem Details format
        throw new Error(data.detail || data.title || data.error?.message || "Resend failed");
      }

      toast({
        title: t("common.success"),
        description: t("verification.verifyEmail.resendSuccess"),
        variant: "success",
      });
    } catch (err: any) {
      const errorMessage = err.message || t("verification.verifyEmail.resendError");
      setError(errorMessage);
      toast({
        title: t("common.error"),
        description: errorMessage,
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <div className="text-center">
          {verifying ? (
            <>
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                {t("verification.verifyEmail.verifying")}
              </h1>
            </>
          ) : success ? (
            <>
              <div className="text-green-500 text-5xl mb-4">✓</div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                {t("verification.verifyEmail.successTitle")}
              </h1>
              <p className="text-gray-600">
                {t("verification.verifyEmail.successMessage")}
              </p>
            </>
          ) : (
            <>
              <div className="text-primary text-5xl mb-4">✉</div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                {t("verification.verifyEmail.title")}
              </h1>
              <p className="text-gray-600 mb-6">
                {t("verification.verifyEmail.message")}
              </p>

              {error && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button
                onClick={handleResend}
                disabled={loading}
                className="w-full"
              >
                {loading
                  ? t("verification.verifyEmail.resending")
                  : t("verification.verifyEmail.resendButton")}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
