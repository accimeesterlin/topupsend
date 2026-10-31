'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Input, Label, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Alert, AlertDescription } from '@topupsend/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [requires2FA, setRequires2FA] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Login failed');
      }

      // Check if 2FA is required
      if (data.requires2FA) {
        setRequires2FA(true);
        // Automatically send the 2FA code
        await sendVerificationCode(data.email || email);
        return;
      }

      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const sendVerificationCode = async (emailToSend: string) => {
    try {
      const response = await fetch('/api/v1/auth/2fa/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailToSend }),
      });

      if (response.ok) {
        setCodeSent(true);
      } else {
        throw new Error('Failed to send verification code');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send verification code');
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/v1/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: verificationCode }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Verification failed');
      }

      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    setError('');
    setCodeSent(false);
    await sendVerificationCode(email);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-md">
        {!requires2FA ? (
          <>
            <CardHeader>
              <CardTitle className="text-2xl">Sign In</CardTitle>
              <CardDescription>
                Enter your credentials to access your account
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                      Forgot password?
                    </Link>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>
              </CardContent>
              <CardFooter className="flex flex-col gap-4">
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Signing in...' : 'Sign In'}
                </Button>
                <p className="text-sm text-center text-muted-foreground">
                  Don&apos;t have an account?{' '}
                  <Link href="/signup" className="text-primary hover:underline">
                    Sign up
                  </Link>
                </p>
              </CardFooter>
            </form>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle className="text-2xl">Two-Factor Authentication</CardTitle>
              <CardDescription>
                {codeSent
                  ? 'Enter the 6-digit code sent to your email'
                  : 'Sending verification code...'}
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleVerifyCode}>
              <CardContent className="space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                {codeSent && (
                  <>
                    <Alert>
                      <AlertDescription>
                        A 6-digit verification code has been sent to {email}. The code will expire in 10 minutes.
                      </AlertDescription>
                    </Alert>
                    <div className="space-y-2">
                      <Label htmlFor="code">Verification Code</Label>
                      <Input
                        id="code"
                        type="text"
                        placeholder="Enter 6-digit code"
                        value={verificationCode}
                        onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        required
                        disabled={loading}
                        maxLength={6}
                        className="text-center text-2xl tracking-widest"
                      />
                    </div>
                  </>
                )}
              </CardContent>
              <CardFooter className="flex flex-col gap-3">
                {codeSent && (
                  <>
                    <Button type="submit" className="w-full" disabled={loading || verificationCode.length !== 6}>
                      {loading ? 'Verifying...' : 'Verify Code'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={handleResendCode}
                      disabled={loading}
                    >
                      Resend Code
                    </Button>
                  </>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    setRequires2FA(false);
                    setVerificationCode('');
                    setCodeSent(false);
                    setError('');
                  }}
                >
                  Back to Login
                </Button>
              </CardFooter>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
