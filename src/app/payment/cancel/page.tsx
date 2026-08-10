'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { XCircle, Loader2, AlertTriangle } from 'lucide-react';
import { Button, Card, CardContent } from '@topupsend/ui';

function PaymentCancelContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'cancelled' | 'failed'>('loading');
  const [message, setMessage] = useState('Checking payment status...');
  const [orderId, setOrderId] = useState<string | null>(null);

  useEffect(() => {
    const orderIdParam = searchParams.get('orderId');
    const errorParam = searchParams.get('error');

    setOrderId(orderIdParam);

    // Simulate checking the status
    setTimeout(() => {
      // If there's an explicit error parameter, treat as failed
      if (errorParam) {
        setStatus('failed');
        setMessage('Your payment could not be processed. Please try again or contact support if the problem persists.');
      } else {
        // Otherwise treat as user cancellation
        setStatus('cancelled');
        setMessage('Your payment was cancelled. No charges have been made to your account.');
      }
    }, 1500);
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6">
          <div className="text-center space-y-6">
            {status === 'loading' && (
              <>
                <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 text-primary animate-spin" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold mb-2">Checking Status</h1>
                  <p className="text-muted-foreground">{message}</p>
                </div>
              </>
            )}

            {status === 'cancelled' && (
              <>
                <div className="mx-auto h-16 w-16 rounded-full bg-yellow-100 flex items-center justify-center">
                  <AlertTriangle className="h-10 w-10 text-yellow-600" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold mb-2 text-yellow-600">Payment Cancelled</h1>
                  <p className="text-muted-foreground">{message}</p>
                  {orderId && (
                    <p className="text-sm text-muted-foreground mt-2">
                      Order ID: <span className="font-mono">{orderId}</span>
                    </p>
                  )}
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm">
                  <p className="text-yellow-800">
                    <strong>What happened?</strong>
                  </p>
                  <ul className="list-disc list-inside text-yellow-700 mt-2 space-y-1 text-left">
                    <li>Your payment was not completed</li>
                    <li>No charges have been made</li>
                    <li>Your order has been cancelled</li>
                    <li>You can try again anytime</li>
                  </ul>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => router.push('/')}
                  >
                    Return Home
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={() => router.push('/store/trellis')}
                  >
                    Try Again
                  </Button>
                </div>
              </>
            )}

            {status === 'failed' && (
              <>
                <div className="mx-auto h-16 w-16 rounded-full bg-red-100 flex items-center justify-center">
                  <XCircle className="h-10 w-10 text-red-600" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold mb-2 text-red-600">Payment Failed</h1>
                  <p className="text-muted-foreground">{message}</p>
                  {orderId && (
                    <p className="text-sm text-muted-foreground mt-2">
                      Order ID: <span className="font-mono">{orderId}</span>
                    </p>
                  )}
                </div>

                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm">
                  <p className="text-red-800">
                    <strong>Need help?</strong>
                  </p>
                  <ul className="list-disc list-inside text-red-700 mt-2 space-y-1 text-left">
                    <li>Check your payment method is valid</li>
                    <li>Ensure you have sufficient funds</li>
                    <li>Try a different payment method</li>
                    <li>Contact support if the issue persists</li>
                  </ul>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => router.push('/')}
                  >
                    Return Home
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={() => router.push('/store/trellis')}
                  >
                    Try Again
                  </Button>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PaymentCancelPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      }
    >
      <PaymentCancelContent />
    </Suspense>
  );
}
