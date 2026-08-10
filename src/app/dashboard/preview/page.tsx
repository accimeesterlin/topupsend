'use client';

import { useState, useEffect } from 'react';
import { ArrowLeft, Smartphone, Search } from 'lucide-react';
import { Button, Card, CardContent } from '@topupsend/ui';
import Link from 'next/link';

export default function StorefrontPreviewPage() {
  const [orgSlug, setOrgSlug] = useState<string>('');
  const [orgName, setOrgName] = useState<string>('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [lookupData, setLookupData] = useState<any>(null);
  const [error, setError] = useState<string>('');
  const [balanceInfo, setBalanceInfo] = useState<any>(null);
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => {
    fetchOrgSlug();
    fetchBalanceInfo();
  }, []);

  const fetchOrgSlug = async () => {
    try {
      const response = await fetch('/api/v1/organizations');
      if (response.ok) {
        const data = await response.json();
        const currentOrg = data.organizations?.find((org: any) => org.isCurrent);
        if (currentOrg) {
          setOrgSlug(currentOrg.slug);
          setOrgName(currentOrg.name);
        }
      }
    } catch (_error) {
      console.error('Failed to fetch org slug:', _error);
    }
  };

  const fetchBalanceInfo = async () => {
    try {
      const response = await fetch('/api/v1/auth/me');
      if (response.ok) {
        const data = await response.json();
        setBalanceInfo(data.balanceLimit);
      }
    } catch (_error) {
      console.error('Failed to fetch balance info:', _error);
    }
  };

  const handleTestPurchase = async (product: any) => {
    setProcessing(product.skuCode);
    try {
      const response = await fetch('/api/v1/preview/test-purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: lookupData.phoneNumber,
          product: {
            skuCode: product.skuCode,
            name: product.name,
            finalPrice: product.pricing.finalPrice,
          },
        }),
      });

      const data = await response.json();

      if (response.ok) {
        // Refresh balance info
        fetchBalanceInfo();
        setError('');
        // Show success message in a more subtle way
        const successMsg = document.createElement('div');
        successMsg.className = 'fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50';
        successMsg.textContent = `Test purchase successful! Used $${product.pricing.finalPrice.toFixed(2)}`;
        document.body.appendChild(successMsg);
        setTimeout(() => successMsg.remove(), 3000);
      } else {
        setError(data.detail || data.error || 'Failed to process test purchase');
      }
    } catch (_error) {
      setError('An error occurred during test purchase');
    } finally {
      setProcessing(null);
    }
  };

  const handleLookup = async () => {
    if (!phoneNumber || !orgSlug) {
      setError('Please enter a phone number');
      return;
    }

    setLoading(true);
    setError('');
    setLookupData(null);

    try {
      const response = await fetch('/api/v1/lookup/phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber,
          orgSlug,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setLookupData(data);
      } else {
        setError(data.detail || data.error || 'Failed to lookup phone number');
      }
    } catch (_error) {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setLookupData(null);
    setPhoneNumber('');
    setError('');
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/dashboard" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <ArrowLeft className="h-5 w-5 text-muted-foreground" />
              <div>
                <h1 className="text-lg font-bold">{orgName || 'TopUpSend'}</h1>
                <p className="text-xs text-muted-foreground">Preview Mode</p>
              </div>
            </Link>

            {/* Balance Info - Compact in header */}
            {balanceInfo && balanceInfo.enabled && (
              <div className="flex items-center gap-3 px-4 py-2 bg-muted/50 rounded-lg">
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Available Balance</p>
                  <p className="text-sm font-bold">
                    ${(balanceInfo.maxBalance - balanceInfo.currentUsed).toFixed(2)}
                  </p>
                </div>
                <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      balanceInfo.currentUsed / balanceInfo.maxBalance >= 0.9
                        ? 'bg-red-500'
                        : balanceInfo.currentUsed / balanceInfo.maxBalance >= 0.75
                        ? 'bg-yellow-500'
                        : 'bg-green-500'
                    }`}
                    style={{
                      width: `${Math.min((balanceInfo.currentUsed / balanceInfo.maxBalance) * 100, 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content - Centered Typeform-style */}
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        {!lookupData ? (
          // Step 1: Phone Number Entry
          <div className="w-full max-w-2xl mx-auto space-y-8 animate-in fade-in-0 slide-in-from-bottom-4 duration-500">
            {/* Preview Mode Info */}
            <div className="text-center space-y-2">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-4">
                <Smartphone className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-3xl font-bold tracking-tight">Test Your Storefront</h2>
              <p className="text-muted-foreground text-lg">
                Enter a phone number to see available products and test purchases
              </p>
            </div>

            {/* Phone Input Card */}
            <Card className="shadow-lg border-2">
              <CardContent className="pt-8 pb-8">
                <div className="space-y-6">
                  <div className="space-y-3">
                    <label className="text-sm font-medium text-foreground">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      placeholder="+1 (555) 123-4567"
                      className="w-full px-4 py-4 text-lg border-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleLookup()}
                      disabled={loading}
                      autoFocus
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter an international phone number with country code (e.g., +1 for USA, +509 for Haiti)
                    </p>
                  </div>

                  {error && (
                    <div className="p-4 bg-red-50 border-2 border-red-200 rounded-lg text-red-800 text-sm animate-in fade-in-0 slide-in-from-top-2">
                      {error}
                    </div>
                  )}

                  <Button
                    onClick={handleLookup}
                    disabled={loading || !phoneNumber}
                    size="lg"
                    className="w-full text-lg h-12"
                  >
                    {loading ? (
                      <>
                        <Search className="h-5 w-5 mr-2 animate-spin" />
                        Searching...
                      </>
                    ) : (
                      <>
                        <Search className="h-5 w-5 mr-2" />
                        Search Products
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Info Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="pt-4 pb-4">
                  <p className="text-blue-900">
                    <strong>No real charges:</strong> Test purchases will only deduct from your balance limit, not process real payments.
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-purple-50 border-purple-200">
                <CardContent className="pt-4 pb-4">
                  <p className="text-purple-900">
                    <strong>See what customers see:</strong> The product selection mimics your live storefront experience.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          // Step 2: Product Selection
          <div className="w-full max-w-6xl mx-auto space-y-6 animate-in fade-in-0 slide-in-from-right-4 duration-500">
            {/* Back Button & Country Info */}
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <div className="flex-1">
                <div className="inline-flex items-center gap-3 px-4 py-2 bg-green-50 border border-green-200 rounded-lg">
                  <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  <div>
                    <span className="text-sm text-green-900">
                      <strong>{lookupData.phoneNumber}</strong> • {lookupData.country?.name}
                    </span>
                    {lookupData.detectedOperators && lookupData.detectedOperators.length > 0 && (
                      <span className="text-xs text-green-700 ml-2">
                        ({lookupData.detectedOperators[0].name})
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
                {error}
              </div>
            )}

            {/* Products Title */}
            <div>
              <h2 className="text-2xl font-bold">
                Available Products
                <span className="ml-2 text-muted-foreground font-normal text-lg">
                  ({lookupData.products?.length || 0})
                </span>
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Click "Test Purchase" to simulate a purchase using your balance limit
              </p>
            </div>

            {/* Products Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-h-[calc(100vh-300px)] overflow-y-auto pr-2">
              {lookupData.products?.slice(0, 20).map((product: any) => {
                const canAfford = !balanceInfo?.enabled || (balanceInfo.maxBalance - balanceInfo.currentUsed) >= product.pricing.finalPrice;

                return (
                  <Card
                    key={product.skuCode}
                    className="hover:shadow-lg hover:border-primary transition-all duration-200 relative overflow-hidden group"
                  >
                    <CardContent className="pt-5 pb-5">
                      <div className="space-y-3">
                        {/* Provider & Type Badge */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-muted-foreground truncate">
                              {product.providerName}
                            </p>
                            <h3 className="font-semibold text-sm line-clamp-2 mt-1">
                              {product.name}
                            </h3>
                          </div>
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary capitalize shrink-0">
                            {product.benefitType}
                          </span>
                        </div>

                        {/* Pricing */}
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl font-bold text-primary">
                            ${product.pricing.finalPrice.toFixed(2)}
                          </span>
                          {product.pricing.discountApplied && (
                            <span className="text-sm text-muted-foreground line-through">
                              ${product.pricing.priceBeforeDiscount.toFixed(2)}
                            </span>
                          )}
                        </div>

                        {/* Variable Value Info */}
                        {product.isVariableValue && (
                          <div className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded border border-blue-200">
                            Custom Amount: ${product.minAmount} - ${product.maxAmount}
                          </div>
                        )}

                        {/* Test Purchase Button */}
                        {balanceInfo && balanceInfo.enabled && (
                          <Button
                            size="sm"
                            className="w-full"
                            onClick={() => handleTestPurchase(product)}
                            disabled={processing === product.skuCode || !canAfford}
                            variant={canAfford ? 'default' : 'secondary'}
                          >
                            {processing === product.skuCode ? (
                              <>
                                <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                                Processing...
                              </>
                            ) : !canAfford ? (
                              'Insufficient Balance'
                            ) : (
                              'Test Purchase'
                            )}
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {lookupData.totalProducts > 20 && (
              <p className="text-sm text-muted-foreground text-center pt-4">
                Showing 20 of {lookupData.totalProducts} products
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
