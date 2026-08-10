"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle, Loader2, AlertCircle, Beaker } from "lucide-react";
import { Button, Card, CardContent } from "@topupsend/ui";

function PaymentSuccessContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [message, setMessage] = useState("Verifying your payment...");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [nameSaved, setNameSaved] = useState(false);
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    const orderIdParam = searchParams.get("orderId");
    // PGPay returns 'token' not 'pgPayToken' in the success redirect
    const pgPayToken =
      searchParams.get("token") || searchParams.get("pgPayToken");
    const paymentStatus = searchParams.get("status");
    const paymentType = searchParams.get("type") || "transaction"; // 'subscription' or 'transaction'

    setOrderId(orderIdParam);

    if (!orderIdParam) {
      setStatus("error");
      setMessage("No order ID provided");
      return;
    }

    // Detect payment type from orderId if not in params
    const isSubscription =
      paymentType === "subscription" || orderIdParam?.startsWith("sub-");

    // Log the received parameters for debugging
    console.log("Payment success params:", {
      orderId: orderIdParam,
      token: pgPayToken?.substring(0, 20) + "...",
      status: paymentStatus,
      type: isSubscription ? "subscription" : "transaction",
    });

    // Track retry attempts to prevent infinite loops
    let retryCount = 0;
    const MAX_RETRIES = 20; // 20 retries * 3 seconds = 60 seconds max

    // Verify the payment
    const verifyPayment = async () => {
      try {
        console.log("Calling verification API...", {
          orderId: orderIdParam,
          hasToken: !!pgPayToken,
          isSubscription,
        });

        const verifyEndpoint = isSubscription
          ? "/api/v1/subscriptions/verify"
          : "/api/v1/payments/verify";
        const response = await fetch(verifyEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: orderIdParam, pgPayToken }),
        });

        console.log("Verification response:", {
          status: response.status,
          ok: response.ok,
        });

        const result = await response.json();

        console.log("Verification result:", result);

        // Log webhook errors if present
        if (result.webhookError) {
          console.error("Webhook error:", result.webhookError);
        }

        if (response.ok && result.success) {
          console.log("Verification successful, status:", result.status);

          // Set test mode flag from result
          if (result.testMode) {
            setTestMode(true);
          }

          if (result.status === "completed") {
            setStatus("success");
            if (isSubscription) {
              setMessage(
                `Subscription activated successfully! You now have ${result.tier || "your new"} plan access${result.prepaidMonths ? ` for ${result.prepaidMonths} month${result.prepaidMonths > 1 ? "s" : ""}` : ""}.`,
              );
            } else {
              setMessage(
                result.testMode
                  ? "Test transaction completed successfully. No actual top-up was sent."
                  : "Your payment has been confirmed and your top-up has been delivered!",
              );
            }
          } else if (result.status === "processing") {
            setStatus("success");
            setMessage(
              isSubscription
                ? "Your subscription payment is being processed."
                : "Your payment is confirmed. Your top-up is being processed and will be delivered shortly.",
            );
          } else if (result.status === "paid") {
            setStatus("success");
            setMessage(
              isSubscription
                ? "Your subscription payment has been confirmed!"
                : "Your payment has been confirmed! Your top-up is being sent now.",
            );
          } else if (result.status === "failed") {
            // Payment was confirmed but top-up failed
            setStatus("error");
            // Generic customer-facing message - don't expose internal issues
            setMessage(
              "We were unable to complete your top-up at this time. Your payment will be refunded within 3-5 business days. Please contact support if you have any questions.",
            );
          } else if (result.status === "pending") {
            // Payment is still pending - check retry count
            retryCount++;
            if (retryCount >= MAX_RETRIES) {
              console.error(
                "Max retries reached. Transaction stuck in pending state.",
              );
              setStatus("error");
              setMessage(
                "Payment verification is taking longer than expected. Please check your email for confirmation or contact support with your order ID.",
              );
            } else {
              console.log(
                `Status pending, retry ${retryCount}/${MAX_RETRIES}, polling again in 3s`,
              );
              setMessage(`Verifying payment... (${retryCount}/${MAX_RETRIES})`);
              setTimeout(verifyPayment, 3000);
            }
          } else {
            // Unknown status - still retry with limit
            retryCount++;
            if (retryCount >= MAX_RETRIES) {
              console.error(
                "Max retries reached. Unknown status:",
                result.status,
              );
              setStatus("error");
              setMessage(
                "Payment verification timeout. Please contact support with your order ID.",
              );
            } else {
              console.log(
                `Unknown status: ${result.status}, retry ${retryCount}/${MAX_RETRIES}, polling again in 3s`,
              );
              setTimeout(verifyPayment, 3000);
            }
          }
        } else {
          console.error("Verification failed:", result);
          setStatus("error");
          setMessage(
            result.message ||
              "Payment verification failed. Please contact support.",
          );
        }
      } catch (error) {
        console.error("Verification error:", error);
        setStatus("error");
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        setMessage(
          `Unable to verify payment: ${errorMessage}. Please contact support with your order ID.`,
        );
      }
    };

    // Start verification after a short delay
    setTimeout(verifyPayment, 1000);
  }, [searchParams]);

  const handleSaveName = async () => {
    if (!customerName.trim()) {
      return;
    }

    setSavingName(true);

    try {
      const response = await fetch(`/api/v1/transactions?orderId=${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerName: customerName.trim() }),
      });

      if (response.ok) {
        setNameSaved(true);
      } else {
        console.error("Failed to save customer name");
      }
    } catch (error) {
      console.error("Error saving customer name:", error);
    } finally {
      setSavingName(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6">
          <div className="text-center space-y-6">
            {status === "loading" && (
              <>
                <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 text-primary animate-spin" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold mb-2">
                    Processing Payment
                  </h1>
                  <p className="text-muted-foreground">{message}</p>
                </div>
              </>
            )}

            {status === "success" && (
              <>
                <div className="mx-auto h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle className="h-10 w-10 text-green-600" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold mb-2 text-green-600">
                    Payment Successful!
                  </h1>
                  <p className="text-muted-foreground">{message}</p>
                  {orderId && (
                    <p className="text-sm text-muted-foreground mt-2">
                      Order ID: <span className="font-mono">{orderId}</span>
                    </p>
                  )}
                </div>

                {testMode && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm">
                    <div className="flex items-start gap-2 text-amber-800">
                      <Beaker className="h-5 w-5 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold">Test Mode Transaction</p>
                        <p className="mt-1">
                          This was a test transaction. No actual top-up was sent
                          to the recipient. All records were created for testing
                          purposes only.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Name Capture Form */}
                {!nameSaved && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-left">
                    <label className="block text-sm font-medium text-blue-900 mb-2">
                      Your Name (Optional)
                    </label>
                    <p className="text-xs text-blue-700 mb-3">
                      Help us personalize your experience by providing your
                      name.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Enter your full name"
                        className="flex-1 px-3 py-2 border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        onKeyPress={(e) =>
                          e.key === "Enter" && handleSaveName()
                        }
                        disabled={savingName}
                      />
                      <Button
                        size="sm"
                        onClick={handleSaveName}
                        disabled={!customerName.trim() || savingName}
                      >
                        {savingName ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          "Save"
                        )}
                      </Button>
                    </div>
                  </div>
                )}

                {nameSaved && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm">
                    <div className="flex items-center gap-2 text-green-800">
                      <CheckCircle className="h-5 w-5" />
                      <span className="font-medium">
                        Thank you, {customerName}!
                      </span>
                    </div>
                  </div>
                )}

                <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm">
                  <p className="text-green-800">
                    <strong>What happens next?</strong>
                  </p>
                  {orderId?.startsWith("sub-") ? (
                    <ul className="list-disc list-inside text-green-700 mt-2 space-y-1 text-left">
                      <li>Your subscription is now active</li>
                      <li>You have full access to your plan features</li>
                      <li>You&apos;ll receive a confirmation email shortly</li>
                      <li>
                        View your subscription details in the billing page
                      </li>
                    </ul>
                  ) : testMode ? (
                    <ul className="list-disc list-inside text-green-700 mt-2 space-y-1 text-left">
                      <li>Payment verification is complete (test mode)</li>
                      <li>Transaction recorded in database with test flag</li>
                      <li>No actual top-up was sent</li>
                      <li>
                        You can review this test transaction in the dashboard
                      </li>
                    </ul>
                  ) : (
                    <ul className="list-disc list-inside text-green-700 mt-2 space-y-1 text-left">
                      <li>Payment verification is complete</li>
                      <li>Your top-up is being processed</li>
                      <li>You&apos;ll receive an email confirmation shortly</li>
                      <li>The top-up will be delivered within a few minutes</li>
                    </ul>
                  )}
                </div>

                <div className="flex gap-2">
                  {orderId?.startsWith("sub-") ? (
                    <>
                      <Button
                        className="flex-1"
                        onClick={() => router.push("/dashboard/billing")}
                      >
                        View Subscription
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => router.push("/dashboard")}
                      >
                        Go to Dashboard
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => router.push("/")}
                      >
                        Return Home
                      </Button>
                      <Button
                        className="flex-1"
                        onClick={() => router.push("/store/trellis")}
                      >
                        Send Another Top-up
                      </Button>
                    </>
                  )}
                </div>
              </>
            )}

            {status === "error" && (
              <>
                <div className="mx-auto h-16 w-16 rounded-full bg-red-100 flex items-center justify-center">
                  <AlertCircle className="h-10 w-10 text-red-600" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold mb-2 text-red-600">
                    Verification Failed
                  </h1>
                  <p className="text-muted-foreground">{message}</p>
                  {orderId && (
                    <p className="text-sm text-muted-foreground mt-2">
                      Order ID: <span className="font-mono">{orderId}</span>
                    </p>
                  )}
                </div>

                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
                  Please contact support if you were charged but didn&apos;t
                  receive your top-up.
                </div>

                <Button
                  onClick={() => router.push("/store/trellis")}
                  className="w-full"
                >
                  Try Again
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      }
    >
      <PaymentSuccessContent />
    </Suspense>
  );
}
