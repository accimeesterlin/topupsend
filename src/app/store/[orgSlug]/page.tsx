'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { Search, Phone, DollarSign, Zap, Shield, SlidersHorizontal, CreditCard, CheckCircle, XCircle, Wifi, Banknote, AlertCircle, Beaker, LogIn } from 'lucide-react';
import Link from 'next/link';
import { Button, Card, CardContent, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, toast } from '@topupsend/ui';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

export default function PublicStorefrontPage() {
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  const { t } = useLanguage();

  const [phoneNumber, setPhoneNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [lookupData, setLookupData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [recentNumbers, setRecentNumbers] = useState<string[]>([]);
  const [showRecentNumbers, setShowRecentNumbers] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterByProvider, setFilterByProvider] = useState<string>('all');
  const [filterByType, setFilterByType] = useState<'all' | 'plan' | 'prepaid'>('all');
  const [sortBy, setSortBy] = useState<'price-asc' | 'price-desc' | 'value-asc' | 'value-desc'>('price-asc');
  const [currentPage, setCurrentPage] = useState(1);
  const PRODUCTS_PER_PAGE = 12;
  const [showFilters, setShowFilters] = useState(false);

  // Payment modal state
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'stripe' | 'paypal' | 'pgpay'>('stripe');
  const [customerEmail, setCustomerEmail] = useState('');
  const [_customerName, _setCustomerName] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const [customAmount, setCustomAmount] = useState<string>('');
  const [amountError, setAmountError] = useState<string>('');
  const [estimatedReceive, setEstimatedReceive] = useState<{ value: number; currency: string } | null>(null);

  // Payment methods state
  const [paymentMethods, setPaymentMethods] = useState<any>(null);
  const [_paymentMethodsLoading, setPaymentMethodsLoading] = useState(false);

  // Discount code state
  const [discountCode, setDiscountCode] = useState<string>('');
  const [discountData, setDiscountData] = useState<any>(null);
  const [isValidatingDiscount, setIsValidatingDiscount] = useState(false);
  const [discountError, setDiscountError] = useState<string>('');

  // Product description state
  const [productDescription, setProductDescription] = useState<string | null>(null);
  const [isLoadingDescription, setIsLoadingDescription] = useState(false);

  // Phone number validation
  const validatePhoneNumber = (phone: string): { valid: boolean; error?: string } => {
    const cleaned = phone.replace(/\D/g, '');

    if (cleaned.length < 10) {
      return { valid: false, error: t('storefront.phoneNumberTooShort') };
    }

    if (cleaned.length > 15) {
      return { valid: false, error: t('storefront.phoneNumberTooLong') };
    }

    // Basic international format check
    if (!cleaned.match(/^\d{10,15}$/)) {
      return { valid: false, error: t('storefront.invalidPhoneFormat') };
    }

    return { valid: true };
  };

  // Convert country ISO code to flag emoji
  const getCountryFlag = (countryCode: string): string => {
    if (!countryCode || countryCode.length !== 2) return '';
    const codePoints = countryCode
      .toUpperCase()
      .split('')
      .map((char) => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
  };

  // Format phone number as user types
  const formatPhoneNumber = (value: string): string => {
    // Remove all non-digit characters except +
    const cleaned = value.replace(/[^\d+]/g, '');

    // Don't format if empty or just +
    if (cleaned.length <= 1) {
      return cleaned;
    }

    // If starts with +, format international number
    if (cleaned.startsWith('+')) {
      const digits = cleaned.substring(1);

      // Format based on length: +XXX XXXX XXXX
      if (digits.length <= 3) {
        return `+${digits}`;
      } else if (digits.length <= 7) {
        return `+${digits.slice(0, 3)} ${digits.slice(3)}`;
      } else {
        return `+${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`;
      }
    }

    // If no +, add it and format
    if (cleaned.length <= 3) {
      return `+${cleaned}`;
    } else if (cleaned.length <= 7) {
      return `+${cleaned.slice(0, 3)} ${cleaned.slice(3)}`;
    } else {
      return `+${cleaned.slice(0, 3)} ${cleaned.slice(3, 7)} ${cleaned.slice(7)}`;
    }
  };

  // Encryption/Decryption utilities using Web Crypto API
  const getEncryptionKey = async (): Promise<CryptoKey> => {
    // Use a deterministic key derived from browser fingerprint
    // In production, consider using a more sophisticated key derivation
    const keyMaterial = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(navigator.userAgent + window.location.hostname)
    );

    return crypto.subtle.importKey(
      'raw',
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  };

  const encryptData = async (data: string): Promise<string> => {
    try {
      const key = await getEncryptionKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encodedData = new TextEncoder().encode(data);

      const encryptedData = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encodedData
      );

      // Combine IV and encrypted data, then encode as base64
      const combined = new Uint8Array(iv.length + encryptedData.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(encryptedData), iv.length);

      return btoa(String.fromCharCode(...combined));
    } catch (err) {
      console.error('Encryption failed:', err);
      throw err;
    }
  };

  const decryptData = async (encryptedString: string): Promise<string> => {
    try {
      const key = await getEncryptionKey();
      const combined = Uint8Array.from(atob(encryptedString), c => c.charCodeAt(0));

      const iv = combined.slice(0, 12);
      const encryptedData = combined.slice(12);

      const decryptedData = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        encryptedData
      );

      return new TextDecoder().decode(decryptedData);
    } catch (err) {
      console.error('Decryption failed:', err);
      throw err;
    }
  };

  // Load recent numbers and email from localStorage on mount
  useEffect(() => {
    const loadRecentNumbers = async () => {
      try {
        const stored = localStorage.getItem('recentPhoneNumbers_encrypted');
        if (stored) {
          const decrypted = await decryptData(stored);
          const numbers = JSON.parse(decrypted);
          setRecentNumbers(numbers);
        }
      } catch (err) {
        console.error('Failed to load recent numbers:', err);
        // Clear corrupted data
        localStorage.removeItem('recentPhoneNumbers_encrypted');
      }
    };

    const loadSavedEmail = async () => {
      try {
        const stored = localStorage.getItem('customerEmail_encrypted');
        if (stored) {
          const decrypted = await decryptData(stored);
          setCustomerEmail(decrypted);
        }
      } catch (err) {
        console.error('Failed to load saved email:', err);
        // Clear corrupted data
        localStorage.removeItem('customerEmail_encrypted');
      }
    };

    loadRecentNumbers();
    loadSavedEmail();
  }, []);

  // Ref for the phone input container to detect clicks outside
  const phoneInputContainerRef = useRef<HTMLDivElement>(null);

  // Close recent numbers dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showRecentNumbers && phoneInputContainerRef.current && !phoneInputContainerRef.current.contains(e.target as Node)) {
        setShowRecentNumbers(false);
      }
    };

    if (showRecentNumbers) {
      // Use mousedown instead of click to avoid conflicts with focus event
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showRecentNumbers]);

  // Save a phone number to recent numbers (encrypted)
  const saveRecentNumber = async (number: string) => {
    try {
      const cleanNumber = number.trim();
      if (!cleanNumber) return;

      // Remove duplicates and add to front
      const updated = [cleanNumber, ...recentNumbers.filter(n => n !== cleanNumber)].slice(0, 5);
      setRecentNumbers(updated);

      // Encrypt and save
      const encrypted = await encryptData(JSON.stringify(updated));
      localStorage.setItem('recentPhoneNumbers_encrypted', encrypted);
    } catch (err) {
      console.error('Failed to save recent number:', err);
    }
  };

  // Save customer email (encrypted)
  const saveCustomerEmail = async (email: string) => {
    try {
      const cleanEmail = email.trim();
      if (!cleanEmail) return;

      // Encrypt and save
      const encrypted = await encryptData(cleanEmail);
      localStorage.setItem('customerEmail_encrypted', encrypted);
    } catch (err) {
      console.error('Failed to save customer email:', err);
    }
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    setPhoneNumber(formatted);
    if (error) setError(null); // Clear error on change
    // Show recent numbers when user focuses input
    if (!showRecentNumbers && recentNumbers.length > 0) {
      setShowRecentNumbers(true);
    }
  };

  // Fetch payment methods for the organization
  const fetchPaymentMethods = async () => {
    setPaymentMethodsLoading(true);
    try {
      console.log('Fetching payment methods for orgSlug:', orgSlug);
      const url = `/api/v1/storefront/payment-methods?orgSlug=${orgSlug}`;
      console.log('Payment methods URL:', url);

      const response = await fetch(url);
      const data = await response.json();

      console.log('Payment methods response:', {
        status: response.status,
        ok: response.ok,
        data
      });

      if (response.ok) {
        setPaymentMethods(data);
      } else {
        console.error('Failed to fetch payment methods:', data.detail || data.message);
        setPaymentMethods({ available: false, methods: [] });
      }
    } catch (error) {
      console.error('Error fetching payment methods:', error);
      setPaymentMethods({ available: false, methods: [] });
    } finally {
      setPaymentMethodsLoading(false);
    }
  };

  const handleLookup = async (numberToLookup?: string) => {
    const trimmed = (numberToLookup || phoneNumber).trim();

    if (!trimmed) {
      setError(t('storefront.enterValidPhoneNumber'));
      return;
    }

    // Validate phone number
    const validation = validatePhoneNumber(trimmed);
    if (!validation.valid) {
      setError(validation.error || t('storefront.invalidPhoneNumber'));
      return;
    }

    setLoading(true);
    setError(null);
    setLookupData(null);

    try {
      const response = await fetch('/api/v1/lookup/phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: trimmed,
          orgSlug,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setLookupData(data);
        // Reset to first page when new data loads
        setCurrentPage(1);
        // Reset provider filter to show all products
        setFilterByProvider('all');
        // Fetch payment methods for this organization
        await fetchPaymentMethods();
        // Save to recent numbers
        saveRecentNumber(trimmed);
        // Hide recent numbers dropdown
        setShowRecentNumbers(false);
      } else {
        // API returns RFC 7807 Problem Details format with "detail" field
        setError(data.detail || data.error || data.message || t('storefront.lookupFailed'));
      }
    } catch (_err) {
      setError(t('storefront.errorOccurred'));
    } finally {
      setLoading(false);
    }
  };

  const handleProductSelect = (product: any) => {
    setSelectedProduct(product);
    setShowPaymentModal(true);
    setPaymentStatus('idle');
    setEstimatedReceive(null);

    // Set default payment method to the first available method
    if (paymentMethods?.methods?.length > 0) {
      setPaymentMethod(paymentMethods.methods[0].provider as 'stripe' | 'paypal' | 'pgpay');
    }

    // Initialize custom amount for variable-value products and compute estimate
    if (product.isVariableValue && product.minAmount) {
      const amount = product.minAmount;
      setCustomAmount(amount.toString());

      // Compute receive estimate locally from product exchange rate
      if (product.minReceiveValue && product.minAmount) {
        const rate = product.minReceiveValue / product.minAmount;
        setEstimatedReceive({
          value: amount * rate,
          currency: product.receiveCurrency || '',
        });
      }
    } else {
      setCustomAmount('');
    }
    setAmountError('');

    // Reset discount code state
    setDiscountCode('');
    setDiscountData(null);
    setDiscountError('');

    // Only fetch description for fixed-value products (plans) - variable-value top-ups don't have descriptions
    setProductDescription(null);
    if (!product.isVariableValue) {
      fetchProductDescription(product.skuCode);
    }
  };

  // Validate discount code
  const validateDiscountCode = async (code: string) => {
    if (!code.trim()) {
      setDiscountData(null);
      setDiscountError('');
      return;
    }

    setIsValidatingDiscount(true);
    setDiscountError('');

    try {
      // Calculate total amount INCLUDING fees (markup) for proper discount calculation
      let totalAmount = 0;

      if (selectedProduct?.isVariableValue && customAmount) {
        const amount = parseFloat(customAmount);
        const markupPercentage = (selectedProduct.pricing.markup / selectedProduct.pricing.costPrice) * 100;
        const markup = amount * (markupPercentage / 100);

        // Apply product-level discount if any
        const discountPercentage = selectedProduct.pricing.discountApplied && selectedProduct.pricing.priceBeforeDiscount > 0
          ? ((selectedProduct.pricing.priceBeforeDiscount - selectedProduct.pricing.finalPrice) / selectedProduct.pricing.priceBeforeDiscount) * 100
          : 0;
        const productDiscount = discountPercentage > 0 ? ((amount + markup) * discountPercentage / 100) : 0;

        // Total before discount code = amount + markup - product discount
        totalAmount = amount + markup - productDiscount;
      } else {
        // For fixed-value products, use the final price (which already includes markup and any product discounts)
        totalAmount = selectedProduct?.pricing.finalPrice || 0;
      }

      const response = await fetch('/api/v1/discounts/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim(),
          orgSlug,
          amount: totalAmount,  // Use total including fees, not just base price
          countryCode: lookupData?.country?.code,
          productSkuCode: selectedProduct?.skuCode,
        }),
      });

      const data = await response.json();

      if (response.ok && data.valid) {
        setDiscountData(data.discount);
        setDiscountError('');
        toast({
          title: t('storefront.discountApplied'),
          description: `${data.discount.name} - Save $${data.discount.discountAmount.toFixed(2)}`,
          variant: 'success',
        });
      } else {
        setDiscountData(null);
        setDiscountError(data.detail || data.error || data.message || t('storefront.invalidDiscountCode'));
      }
    } catch (_error) {
      setDiscountData(null);
      setDiscountError(t('storefront.errorValidatingDiscount'));
    } finally {
      setIsValidatingDiscount(false);
    }
  };

  // Fetch product description from DingConnect
  const fetchProductDescription = async (skuCode: string) => {
    setIsLoadingDescription(true);
    setProductDescription(null);
    try {
      const response = await fetch(
        `/api/v1/products/description?skuCode=${encodeURIComponent(skuCode)}&orgSlug=${encodeURIComponent(orgSlug)}&lang=en`
      );
      const data = await response.json();
      if (response.ok && data.description) {
        setProductDescription(data.description);
      }
    } catch (error) {
      console.error('Error fetching product description:', error);
    } finally {
      setIsLoadingDescription(false);
    }
  };



  // Compute receive estimate locally when amount changes
  useEffect(() => {
    if (selectedProduct?.isVariableValue && customAmount) {
      const amount = parseFloat(customAmount);

      // Validate amount is within range
      if (isNaN(amount) || amount <= 0) {
        setEstimatedReceive(null);
        setAmountError('');
      } else if (amount < selectedProduct.minAmount) {
        setEstimatedReceive(null);
        setAmountError(t('storefront.enterAmountMin', { min: selectedProduct.minAmount.toFixed(2) }));
      } else if (amount > selectedProduct.maxAmount) {
        setEstimatedReceive(null);
        setAmountError(t('storefront.enterAmountMax', { max: selectedProduct.maxAmount.toFixed(2) }));
      } else {
        // Valid range - compute receive estimate from product exchange rate
        setAmountError('');
        if (selectedProduct.minReceiveValue && selectedProduct.minAmount) {
          const rate = selectedProduct.minReceiveValue / selectedProduct.minAmount;
          setEstimatedReceive({
            value: amount * rate,
            currency: selectedProduct.receiveCurrency || '',
          });
        } else {
          setEstimatedReceive(null);
        }
      }
    }
  }, [customAmount, selectedProduct]);

  // Calculate fees and total - reused by both payment call and display
  const calculateOrderTotal = () => {
    if (!selectedProduct?.pricing) return null;

    const hasPricingRules = selectedProduct.pricing.pricingRule && selectedProduct.pricing.markup > 0;

    let feePercentage = 0;
    let fixedFee = 0;

    if (hasPricingRules && selectedProduct.pricing.pricingRule) {
      feePercentage = (selectedProduct.pricing.pricingRule.percentageValue || 0) / 100;
      fixedFee = selectedProduct.pricing.pricingRule.fixedValue || 0;
    } else {
      const selectedPaymentMethod = paymentMethods?.methods?.find((m: any) => m.provider === paymentMethod);
      feePercentage = selectedPaymentMethod?.feePercentage || 0;
      fixedFee = selectedPaymentMethod?.fixedFee || 0;
    }

    if (selectedProduct.isVariableValue && customAmount) {
      const amount = parseFloat(customAmount);
      if (isNaN(amount) || amount <= 0) return null;

      const processingFee = (amount * feePercentage) + fixedFee;

      const discountPercentage = selectedProduct.pricing.discountApplied && selectedProduct.pricing.priceBeforeDiscount > 0
        ? ((selectedProduct.pricing.priceBeforeDiscount - selectedProduct.pricing.finalPrice) / selectedProduct.pricing.priceBeforeDiscount) * 100
        : 0;
      const discount = discountPercentage > 0 ? ((amount + processingFee) * discountPercentage / 100) : 0;

      const total = Math.max(0, amount + processingFee - discount - (discountData?.discountAmount || 0));

      return {
        baseAmount: amount,
        feePercentage,
        fixedFee,
        processingFee,
        discount,
        discountApplied: discountPercentage > 0,
        total,
      };
    } else {
      const basePrice = selectedProduct.pricing.finalPrice;
      const processingFee = (basePrice * feePercentage) + fixedFee;
      const total = Math.max(0, basePrice + processingFee - (discountData?.discountAmount || 0));

      return {
        baseAmount: basePrice,
        feePercentage,
        fixedFee,
        processingFee,
        discount: selectedProduct.pricing.discount || 0,
        discountApplied: selectedProduct.pricing.discountApplied || false,
        total,
      };
    }
  };

  const handlePayment = async () => {
    if (!customerEmail) {
      toast({
        title: t('storefront.emailRequired'),
        description: t('storefront.emailRequiredDesc'),
        variant: 'error',
      });
      return;
    }

    if (!selectedProduct) return;

    // Validate custom amount for variable-value products
    if (selectedProduct.isVariableValue) {
      const amount = parseFloat(customAmount);
      if (isNaN(amount) || amount <= 0) {
        setAmountError(t('storefront.enterAmountValid'));
        return;
      }
      if (amount < selectedProduct.minAmount) {
        setAmountError(t('storefront.enterAmountMin', { min: selectedProduct.minAmount.toFixed(2) }));
        return;
      }
      if (amount > selectedProduct.maxAmount) {
        setAmountError(t('storefront.enterAmountMax', { max: selectedProduct.maxAmount.toFixed(2) }));
        return;
      }
      setAmountError('');
    }

    setIsProcessing(true);
    setPaymentStatus('processing');

    try {
      // Calculate total including processing fees
      const orderTotal = calculateOrderTotal();
      const finalAmount = orderTotal?.total ?? (selectedProduct.isVariableValue ? parseFloat(customAmount) : selectedProduct.pricing.finalPrice);

      // Collect browser metadata for fraud detection & analytics
      const { collectBrowserMetadata } = await import("@/lib/browser-metadata");

      // Call actual payment API endpoint
      const response = await fetch('/api/v1/payments/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgSlug,
          phoneNumber: lookupData.phoneNumber,
          product: selectedProduct, // Send full product object
          customerEmail,
          paymentMethod,
          amount: parseFloat(finalAmount.toFixed(2)),
          sendValue: selectedProduct.isVariableValue ? parseFloat(customAmount) : undefined,
          browserMetadata: collectBrowserMetadata(),
          country: lookupData.country, // Pass detected country from lookup
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMessage = data.detail || data.error || data.message || 'Payment failed';
        console.error('Payment API error:', data);
        throw new Error(errorMessage);
      }

      // Save customer email for future use (encrypted)
      await saveCustomerEmail(customerEmail);

      // Check if payment requires redirect (PGPay)
      if (data.requiresRedirect && data.data?.checkoutUrl) {
        console.log('Redirecting to payment gateway', {
          checkoutUrl: data.data.checkoutUrl,
          orderId: data.data.orderId,
        });

        // Store order ID in session storage for callback
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('pendingOrderId', data.data.orderId);
          sessionStorage.setItem('pendingPhoneNumber', lookupData.phoneNumber);
        }

        toast({
          title: t('storefront.redirectingToPayment'),
          description: t('storefront.completePaymentDesc'),
          variant: 'default',
        });

        // Redirect to payment gateway
        setTimeout(() => {
          window.location.href = data.data.checkoutUrl;
        }, 1000);

        return;
      }

      // For direct payments (non-redirect)
      setPaymentStatus('success');

      // Determine what value was received
      const receivedAmount = selectedProduct.isVariableValue && estimatedReceive && estimatedReceive.value !== undefined
        ? `${estimatedReceive.value.toFixed(2)} ${estimatedReceive.currency}`
        : `${selectedProduct.benefitAmount} ${selectedProduct.benefitUnit}`;

      toast({
        title: t('storefront.paymentSuccessful'),
        description: data.data?.validateOnly
          ? t('storefront.transactionValidated')
          : t('storefront.topupSuccessToast', { amount: receivedAmount, phone: lookupData.phoneNumber }),
        variant: 'success',
      });

      // Close modal after 3 seconds
      setTimeout(() => {
        setShowPaymentModal(false);
        setSelectedProduct(null);
        // Don't clear email - it's saved for next time
        setPaymentStatus('idle');
      }, 3000);

    } catch (error: any) {
      setPaymentStatus('error');
      toast({
        title: t('storefront.paymentFailed'),
        description: error.message || t('storefront.paymentFailedDesc'),
        variant: 'error',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Get unique providers from products
  const _providers = useMemo(() => {
    if (!lookupData?.products) return [];
    const uniqueProviders = Array.from(
      new Set(lookupData.products.map((p: any) => p.providerName))
    );
    return uniqueProviders;
  }, [lookupData?.products]);

  // Filter and sort products
  const filteredAndSortedProducts = useMemo(() => {
    if (!lookupData?.products) return [];

    let filtered = [...lookupData.products];

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (product: any) =>
          product.name.toLowerCase().includes(query) ||
          product.providerName.toLowerCase().includes(query)
      );
    }

    // Apply provider filter
    if (filterByProvider !== 'all') {
      filtered = filtered.filter(
        (product: any) => product.providerCode === filterByProvider
      );
    }

    // Apply type filter (plan vs prepaid)
    if (filterByType !== 'all') {
      filtered = filtered.filter((product: any) => {
        // Plan classification:
        // - Has "Data" in the Benefits array, OR
        // - Has a ValidityPeriodIso value (e.g., "P30D")
        const hasDataBenefit = product.benefits?.includes('Data');
        const hasValidityPeriod = !!product.validityPeriod;
        const isPlan = hasDataBenefit || hasValidityPeriod;

        // Prepaid is everything that is NOT a plan
        const isPrepaid = !isPlan;

        if (filterByType === 'plan') return isPlan;
        if (filterByType === 'prepaid') return isPrepaid;
        return true;
      });
    }

    // Apply sorting
    filtered.sort((a: any, b: any) => {
      switch (sortBy) {
        case 'price-asc':
          return a.pricing.finalPrice - b.pricing.finalPrice;
        case 'price-desc':
          return b.pricing.finalPrice - a.pricing.finalPrice;
        case 'value-asc':
          return a.benefitAmount - b.benefitAmount;
        case 'value-desc':
          return b.benefitAmount - a.benefitAmount;
        default:
          return 0;
      }
    });

    return filtered;
  }, [lookupData?.products, searchQuery, filterByProvider, filterByType, sortBy]);

  // Paginate products
  const paginatedProducts = useMemo(() => {
    const startIndex = (currentPage - 1) * PRODUCTS_PER_PAGE;
    const endIndex = startIndex + PRODUCTS_PER_PAGE;
    return filteredAndSortedProducts.slice(startIndex, endIndex);
  }, [filteredAndSortedProducts, currentPage]);

  const totalPages = Math.ceil(filteredAndSortedProducts.length / PRODUCTS_PER_PAGE);

  const _primaryColor = lookupData?.branding?.primaryColor || '#3b82f6';

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-50 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="container max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold">
              {lookupData?.branding?.businessName || t('storefront.title')}
            </h1>
            <div className="flex items-center gap-3">
              <LanguageSwitcher />
              <Link
                href={`/customer-portal/${orgSlug}/login`}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <LogIn className="h-4 w-4" />
                <span className="hidden sm:inline">Login</span>
              </Link>
              {lookupData && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Phone className="h-4 w-4" />
                  <span className="hidden sm:inline">
                    {lookupData.phoneNumber.substring(0, 5)}...{lookupData.phoneNumber.substring(lookupData.phoneNumber.length - 4)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Test Mode Banner */}
      {lookupData?.testMode && (
        <div className="border-b bg-amber-50 border-amber-200">
          <div className="container max-w-6xl mx-auto px-4 py-2">
            <div className="flex items-center justify-center gap-2 text-amber-800">
              <Beaker className="h-4 w-4" />
              <span className="text-sm font-medium">
                {t('storefront.testModeBanner')}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Main Content - Typeform Style */}
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        {!lookupData ? (
          /* Step 1: Phone Number Entry - Full Focus */
          <div className="w-full max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="text-center space-y-3">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
                <Phone className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
                {t('storefront.phoneLabel')}
              </h2>
              <p className="text-muted-foreground text-lg">
                {lookupData?.branding?.description || t('storefront.subtitle')}
              </p>
            </div>

            <Card className="shadow-lg">
              <CardContent className="pt-6 space-y-6">
                <div className="space-y-3" ref={phoneInputContainerRef}>
                  <div className="relative">
                    <Phone className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <input
                      type="tel"
                      placeholder={t('storefront.phonePlaceholder')}
                      className="w-full pl-12 pr-4 py-4 text-lg border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                      value={phoneNumber}
                      onChange={handlePhoneChange}
                      onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
                      onFocus={() => recentNumbers.length > 0 && setShowRecentNumbers(true)}
                      autoFocus
                    />
                  </div>

                  {/* Recent Numbers Dropdown */}
                  {showRecentNumbers && recentNumbers.length > 0 && (
                    <div
                      className="border rounded-lg bg-card shadow-sm animate-in slide-in-from-top-2 duration-200"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="p-2 border-b">
                        <p className="text-xs font-medium text-muted-foreground px-2">{t('storefront.recentNumbers')}</p>
                      </div>
                      <div className="p-1">
                        {recentNumbers.map((number, index) => (
                          <button
                            key={index}
                            type="button"
                            onClick={() => {
                              setPhoneNumber(number);
                              setShowRecentNumbers(false);
                              // Automatically trigger lookup with the selected number
                              handleLookup(number);
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-muted transition-colors text-left"
                          >
                            <Phone className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span className="text-sm font-medium">{number}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground text-center">
                    {t('storefront.phonePlaceholder')}
                  </p>
                </div>

                {error && (
                  <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm animate-in slide-in-from-top-2">
                    <div className="flex items-start gap-2">
                      <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <span>{error}</span>
                    </div>
                  </div>
                )}

                <Button
                  className="w-full h-12 text-base"
                  size="lg"
                  onClick={() => handleLookup()}
                  disabled={loading || !phoneNumber.trim()}
                >
                  {loading ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent mr-2" />
                      {t('storefront.searching')}
                    </>
                  ) : (
                    <>
                      {t('storefront.continue')}
                      <Search className="h-5 w-5 ml-2" />
                    </>
                  )}
                </Button>

                <div className="text-center text-xs text-muted-foreground">
                  {t('storefront.pressEnter')} <kbd className="px-2 py-1 bg-muted rounded text-xs font-mono">Enter ↵</kbd>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          /* Step 2: Product Selection - Full Focus */
          <div className="w-full max-w-5xl mx-auto space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Progress Indicator */}
            <div className="flex items-center gap-2 text-sm justify-center">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium">✓</div>
                <span className="text-muted-foreground">{t('storefront.phoneVerified')}</span>
              </div>
              <div className="h-px bg-border flex-1 max-w-[60px]"></div>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full border-2 border-primary flex items-center justify-center text-xs font-medium">2</div>
                <span className="font-medium">{t('storefront.chooseTopup')}</span>
              </div>
            </div>

            {/* Header Section with Country/Operator Info */}
            <div className="text-center space-y-3">
              <h2 className="text-2xl md:text-3xl font-bold">
                {t('storefront.chooseYourTopup')}
              </h2>

              {/* Country & Operator Pills */}
              <div className="flex items-center justify-center gap-2 flex-wrap text-xs">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-muted rounded-full">
                  <span className="text-base" title={lookupData.country.code}>{getCountryFlag(lookupData.country.code)}</span>
                  <span>{lookupData.country.name}</span>
                </div>
                {lookupData.detectedOperators && lookupData.detectedOperators.length > 0 && (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 text-primary rounded-full">
                    <Wifi className="h-3.5 w-3.5" />
                    <span>
                      {lookupData.detectedOperators.filter((op: any) => op.name).map((op: any) => op.name).join(', ')}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Tab Navigation with Filter Toggle - Compact */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 flex justify-center">
                <div className="inline-flex items-center gap-1 p-1 bg-muted rounded-lg">
                  <button
                    onClick={() => {
                      setFilterByType('all');
                      setCurrentPage(1);
                    }}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${
                      filterByType === 'all'
                        ? 'bg-background shadow-sm'
                        : 'hover:bg-background/50'
                    }`}
                  >
                    {t('storefront.all')} ({lookupData.products.length})
                  </button>
                  <button
                    onClick={() => {
                      setFilterByType('prepaid');
                      setCurrentPage(1);
                    }}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${
                      filterByType === 'prepaid'
                        ? 'bg-background shadow-sm'
                        : 'hover:bg-background/50'
                    }`}
                  >
                    {t('storefront.topup')}
                  </button>
                  <button
                    onClick={() => {
                      setFilterByType('plan');
                      setCurrentPage(1);
                    }}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${
                      filterByType === 'plan'
                        ? 'bg-background shadow-sm'
                        : 'hover:bg-background/50'
                    }`}
                  >
                    {t('storefront.plans')}
                  </button>
                </div>
              </div>

              {/* Filter Toggle Button */}
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="p-2 rounded-lg hover:bg-muted transition-colors"
                aria-label={showFilters ? t('storefront.clear') : t('storefront.searchPlaceholder')}
              >
                <SlidersHorizontal className={`h-4 w-4 transition-colors ${showFilters ? 'text-primary' : 'text-muted-foreground'}`} />
              </button>
            </div>

            {/* Compact Filters Row - Collapsible */}
            {showFilters && (
              <Card className="shadow-sm animate-in slide-in-from-top-2 duration-200">
                <CardContent className="p-3">
                  <div className="flex flex-col sm:flex-row gap-2">
                    {/* Search */}
                    <div className="flex-1 relative">
                      <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder={t('storefront.searchPlaceholder')}
                        className="w-full pl-8 pr-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring transition-all text-xs"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                    </div>

                    {/* Provider Filter */}
                    {lookupData?.operators && lookupData.operators.length > 1 && (
                      <select
                        className="px-2.5 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-xs"
                        value={filterByProvider}
                        onChange={(e) => {
                          setFilterByProvider(e.target.value);
                          setCurrentPage(1);
                        }}
                      >
                        <option value="all">{t('storefront.allProviders')}</option>
                        {lookupData.operators.map((operator: any) => (
                          <option key={operator.code} value={operator.code}>
                            {operator.name}
                          </option>
                        ))}
                      </select>
                    )}

                    {/* Sort */}
                    <select
                      className="px-2.5 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-xs"
                      value={sortBy}
                      onChange={(e) => {
                        setSortBy(e.target.value as any);
                        setCurrentPage(1);
                      }}
                    >
                      <option value="price-asc">{t('storefront.priceAsc')}</option>
                      <option value="price-desc">{t('storefront.priceDesc')}</option>
                      <option value="value-asc">{t('storefront.valueAsc')}</option>
                      <option value="value-desc">{t('storefront.valueDesc')}</option>
                    </select>

                    {/* Clear Filters */}
                    {(searchQuery || filterByProvider !== 'all') && (
                      <button
                        onClick={() => {
                          setSearchQuery('');
                          setFilterByProvider('all');
                        }}
                        className="px-2.5 py-2 text-xs font-medium text-primary hover:bg-primary/10 rounded-md transition-colors whitespace-nowrap"
                      >
                        {t('storefront.clear')}
                      </button>
                    )}
                  </div>

                  {/* Results count */}
                  {(searchQuery || filterByProvider !== 'all') && (
                    <p className="mt-2 text-xs text-muted-foreground text-center">
                      {t('storefront.productsCount', { filtered: filteredAndSortedProducts.length, total: lookupData.products.length })}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Products List - Compact Grid */}
            <div className="space-y-2 max-h-[50vh] overflow-y-auto px-1">
              {paginatedProducts.length > 0 ? (
                paginatedProducts.map((product: any) => (
                  <Card
                    key={product.skuCode}
                    className="cursor-pointer hover:shadow-md hover:scale-[1.01] transition-all group"
                    onClick={() => handleProductSelect(product)}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between gap-3">
                        {/* Left: Product Info */}
                        <div className="flex-1 min-w-0">
                          {product.pricing.discountApplied && (
                            <div className="inline-flex items-center gap-1.5 mb-0.5">
                              <span className="text-[10px] font-medium text-muted-foreground line-through">
                                ${product.pricing.priceBeforeDiscount.toFixed(2)}
                              </span>
                              <span className="inline-flex items-center px-1.5 py-0.5 bg-primary/10 text-primary rounded-full text-[10px] font-medium">
                                Save {((product.pricing.priceBeforeDiscount - product.pricing.finalPrice) / product.pricing.priceBeforeDiscount * 100).toFixed(0)}%
                              </span>
                            </div>
                          )}
                          <div className="flex items-baseline gap-1.5">
                            {product.isVariableValue ? (
                              <div className="flex items-center gap-1">
                                <Banknote className="h-4 w-4 text-primary" />
                                <p className="font-semibold text-sm">
                                  ${product.minAmount.toFixed(2)} - ${product.maxAmount.toFixed(2)}
                                </p>
                              </div>
                            ) : (
                              <p className="font-semibold">
                                {product.benefitAmount} {product.benefitUnit}
                              </p>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {product.name}
                          </p>
                        </div>

                        {/* Right: Price Button */}
                        <div className="flex-shrink-0">
                          <Button size="sm" className="group-hover:scale-105 transition-transform font-semibold">
                            ${product.pricing.finalPrice.toFixed(2)}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <Card>
                  <CardContent className="py-8 text-center">
                    <p className="text-sm text-muted-foreground">
                      {lookupData.products.length === 0
                        ? t('storefront.noProductsForNumber')
                        : t('storefront.noProductsMatchFilters')}
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Pagination - Compact */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="h-8 px-2 text-xs"
                >
                  {t('storefront.prev')}
                </Button>

                <div className="flex items-center gap-0.5">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }

                    return (
                      <Button
                        key={pageNum}
                        variant={currentPage === pageNum ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setCurrentPage(pageNum)}
                        className="h-8 w-8 p-0 text-xs"
                      >
                        {pageNum}
                      </Button>
                    );
                  })}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="h-8 px-2 text-xs"
                >
                  {t('storefront.next')}
                </Button>
              </div>
            )}

            {/* Back Button */}
            <div className="text-center pt-2">
              <button
                onClick={() => {
                  setLookupData(null);
                  setPhoneNumber('');
                  setError(null);
                }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {t('storefront.changePhoneNumber')}
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Features Section */}
      {!lookupData && (
        <div className="border-t bg-muted/30">
          <div className="container max-w-5xl mx-auto px-4 py-16">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="text-center space-y-3">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <Zap className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold">{t('storefront.instantDelivery')}</h3>
                <p className="text-sm text-muted-foreground">
                  {t('storefront.instantDeliveryDesc')}
                </p>
              </div>

              <div className="text-center space-y-3">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <Shield className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold">{t('storefront.secureSafe')}</h3>
                <p className="text-sm text-muted-foreground">
                  {t('storefront.secureSafeDesc')}
                </p>
              </div>

              <div className="text-center space-y-3">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <DollarSign className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold">{t('storefront.bestRates')}</h3>
                <p className="text-sm text-muted-foreground">
                  {t('storefront.bestRatesDesc')}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      <Dialog open={showPaymentModal} onOpenChange={setShowPaymentModal}>
        <DialogContent className="max-w-md">
          {paymentStatus === 'idle' || paymentStatus === 'processing' ? (
            <>
              <DialogHeader>
                <DialogTitle>{t('storefront.completePayment')}</DialogTitle>
                <DialogDescription>
                  {t('storefront.sendingTo', { phone: lookupData?.phoneNumber })}
                </DialogDescription>
                {lookupData?.testMode && (
                  <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-800">
                    <Beaker className="h-4 w-4 flex-shrink-0" />
                    <span className="text-xs font-medium">
                      {t('storefront.testModeModal')}
                    </span>
                  </div>
                )}
              </DialogHeader>

              {selectedProduct && (
                <div className="space-y-4">
                  {/* Product Summary */}
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <h4 className="font-semibold mb-1">{selectedProduct.name}</h4>
                    {/* Product Description */}
                    {isLoadingDescription ? (
                      <div className="mb-2 h-4 w-3/4 animate-pulse rounded bg-gray-200" />
                    ) : productDescription ? (
                      <p className="mb-2 text-xs text-gray-500">{productDescription}</p>
                    ) : null}
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">{t('storefront.provider')}</span>
                        <span className="font-medium">{selectedProduct.providerName}</span>
                      </div>

                      {/* Custom Amount Input for Variable-Value Products */}
                      {selectedProduct.isVariableValue ? (
                        <div className="space-y-2 py-2">
                          <label className="block text-sm font-medium text-gray-700">
                            {t('storefront.enterAmount', { min: selectedProduct.minAmount.toFixed(2), max: selectedProduct.maxAmount.toFixed(2) })}
                          </label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
                            <input
                              type="number"
                              min={selectedProduct.minAmount}
                              max={selectedProduct.maxAmount}
                              step="0.01"
                              value={customAmount}
                              onChange={(e) => {
                                setCustomAmount(e.target.value);
                              }}
                              disabled={isProcessing}
                              className={`w-full pl-7 pr-4 py-2 border-2 rounded-lg focus:outline-none focus:ring-2 transition-colors ${
                                amountError
                                  ? 'border-red-500 focus:ring-red-500'
                                  : 'border-gray-300 focus:ring-primary'
                              }`}
                              placeholder={`${selectedProduct.minAmount.toFixed(2)}`}
                            />
                          </div>
                          {amountError && (
                            <div className="flex items-center gap-1 text-xs text-red-600 bg-red-50 px-2 py-1 rounded">
                              <XCircle className="h-3 w-3" />
                              {amountError}
                            </div>
                          )}
                          {/* Estimated Receive Value */}
                          <div className="flex justify-between items-center text-sm pt-2">
                            <span className="text-gray-600">{t('storefront.theyReceive')}</span>
                            {estimatedReceive && estimatedReceive.value !== undefined ? (
                              <span className="font-medium text-green-600">
                                ~{estimatedReceive.value.toFixed(2)} {estimatedReceive.currency}
                              </span>
                            ) : customAmount && parseFloat(customAmount) > 0 ? (
                              <span className="text-gray-400">{t('storefront.enterValidAmount')}</span>
                            ) : null}
                          </div>
                          {estimatedReceive && estimatedReceive.value !== undefined && (
                            <p className="text-xs text-gray-400 mt-1">
                              {t('storefront.receiveDisclaimer')}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">{t('storefront.theyReceive')}</span>
                            <span className="font-medium text-green-600">
                              ~{selectedProduct.benefitAmount} {selectedProduct.benefitUnit}
                            </span>
                          </div>
                          <p className="text-xs text-gray-400 mt-1">
                            {t('storefront.receiveDisclaimer')}
                          </p>
                        </div>
                      )}

                      {/* Pricing Breakdown - Show fees and discount, but NOT cost price (internal seller info) */}
                      {(() => {
                        const breakdown = calculateOrderTotal();
                        if (!breakdown) return null;

                        const hasDiscount = (breakdown.discountApplied && breakdown.discount > 0) || discountData;

                        // Don't show breakdown ONLY if there are no fees AND no discounts
                        // But if payment methods are loaded, always show fees (even if $0)
                        if (breakdown.processingFee === 0 && !hasDiscount && !paymentMethods?.methods) return null;

                        return (
                          <div className="space-y-1 text-sm pt-2 mt-2 border-t">
                            {/* Always show fees if payment methods are loaded */}
                            {paymentMethods?.methods && (
                              <div className="flex justify-between text-gray-600">
                                <span>Processing Fee{breakdown.feePercentage > 0 ? ` (${(breakdown.feePercentage * 100).toFixed(1)}%` : ''}
{breakdown.fixedFee > 0 && breakdown.feePercentage > 0 ? ' + ' : ''}
                                {breakdown.fixedFee > 0 ? `$${breakdown.fixedFee.toFixed(2)}` : ''}
                                {(breakdown.feePercentage > 0 || breakdown.fixedFee > 0) ? ')' : ''}:</span>
                                <span>+${breakdown.processingFee.toFixed(2)}</span>
                              </div>
                            )}
                            {breakdown.discountApplied && breakdown.discount > 0 && (
                              <div className="flex justify-between text-green-600">
                                <span>{t('storefront.discount')}</span>
                                <span>-${breakdown.discount.toFixed(2)}</span>
                              </div>
                            )}
                            {discountData && (
                              <div className="flex justify-between text-green-600 font-medium">
                                <span>{t('storefront.discountCode')} ({discountData.code})</span>
                                <span>-${discountData.discountAmount.toFixed(2)}</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      <div className="flex justify-between text-lg font-bold mt-2 pt-2 border-t">
                        <span>{t('storefront.total')}</span>
                        <span>
                          ${(calculateOrderTotal()?.total ?? 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Customer Email */}
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      {t('storefront.emailAddress')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      placeholder={t('storefront.emailPlaceholderShort')}
                      className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      disabled={isProcessing}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {t('storefront.receiptEmail')}
                    </p>
                  </div>

                  {/* Discount Code */}
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      {t('storefront.discountCode')} ({t('storefront.optional')})
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder={t('storefront.enterDiscountCode')}
                        className={`flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 uppercase ${
                          discountError
                            ? 'border-red-500 focus:ring-red-500'
                            : discountData
                            ? 'border-green-500 focus:ring-green-500'
                            : 'focus:ring-primary'
                        }`}
                        value={discountCode}
                        onChange={(e) => {
                          setDiscountCode(e.target.value.toUpperCase());
                          setDiscountError('');
                          setDiscountData(null);
                        }}
                        disabled={isProcessing || isValidatingDiscount}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => validateDiscountCode(discountCode)}
                        disabled={!discountCode.trim() || isProcessing || isValidatingDiscount}
                        className="whitespace-nowrap"
                      >
                        {isValidatingDiscount ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent mr-2" />
                            {t('storefront.validating')}
                          </>
                        ) : (
                          t('storefront.apply')
                        )}
                      </Button>
                    </div>
                    {discountError && (
                      <div className="flex items-center gap-1 mt-1 text-xs text-red-600">
                        <XCircle className="h-3 w-3" />
                        {discountError}
                      </div>
                    )}
                    {discountData && (
                      <div className="flex items-center gap-1 mt-1 text-xs text-green-600">
                        <CheckCircle className="h-3 w-3" />
                        {discountData.name} - Save ${discountData.discountAmount.toFixed(2)}
                      </div>
                    )}
                  </div>

                  {/* Payment Method Selection - Only show if payment methods are available */}
                  {paymentMethods?.available && paymentMethods?.methods?.length > 0 ? (
                    paymentMethods.methods.length > 1 ? (
                      <div>
                        <label className="block text-sm font-medium mb-2">
                          {t('storefront.paymentMethod')}
                        </label>
                        <div className={`grid gap-2 ${paymentMethods.methods.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                          {paymentMethods.methods.map((method: any) => {
                            const providerConfig = {
                              stripe: { icon: CreditCard, label: t('storefront.card') },
                              paypal: { icon: DollarSign, label: t('storefront.paypal') },
                              pgpay: { icon: Banknote, label: t('storefront.pgpay') },
                            }[method.provider as 'stripe' | 'paypal' | 'pgpay'];

                            if (!providerConfig) return null;

                            const Icon = providerConfig.icon;

                            return (
                              <button
                                key={method.provider}
                                type="button"
                                onClick={() => setPaymentMethod(method.provider as 'stripe' | 'paypal' | 'pgpay')}
                                disabled={isProcessing}
                                className={`p-3 border-2 rounded-lg flex flex-col items-center gap-1 transition-colors ${
                                  paymentMethod === method.provider
                                    ? 'border-primary bg-primary/5'
                                    : 'border-gray-200 hover:border-gray-300'
                                }`}
                              >
                                <Icon className="h-5 w-5" />
                                <span className="text-xs font-medium">{providerConfig.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      // Single payment method - show as readonly badge
                      <div>
                        <label className="block text-sm font-medium mb-2">
                          {t('storefront.paymentMethod')}
                        </label>
                        {(() => {
                          const method = paymentMethods.methods[0];
                          const providerConfig = {
                            stripe: { icon: CreditCard, label: t('storefront.card') },
                            paypal: { icon: DollarSign, label: t('storefront.paypal') },
                            pgpay: { icon: Banknote, label: t('storefront.pgpay') },
                          }[method.provider as 'stripe' | 'paypal' | 'pgpay'];

                          if (!providerConfig) return null;

                          const Icon = providerConfig.icon;

                          return (
                            <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/5 border-2 border-primary rounded-lg">
                              <Icon className="h-5 w-5 text-primary" />
                              <span className="text-sm font-medium">{providerConfig.label}</span>
                              <CheckCircle className="h-4 w-4 text-primary ml-1" />
                            </div>
                          );
                        })()}
                      </div>
                    )
                  ) : (
                    /* Payment Methods Error Banner */
                    <div className={`p-3 border-2 rounded-lg ${
                      paymentMethods?.inactiveCount > 0
                        ? 'bg-amber-50 border-amber-400'
                        : 'bg-red-50 border-red-400'
                    }`}>
                      <div className="flex items-start gap-2">
                        {paymentMethods?.inactiveCount > 0 ? (
                          <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                        )}
                        <div>
                          <p className={`font-semibold text-sm ${
                            paymentMethods?.inactiveCount > 0 ? 'text-amber-900' : 'text-red-900'
                          }`}>
                            {paymentMethods?.inactiveCount > 0
                              ? t('storefront.paymentMethodsPending')
                              : t('storefront.paymentMethodsNotAvailable')}
                          </p>
                          <p className={`text-xs mt-1 ${
                            paymentMethods?.inactiveCount > 0 ? 'text-amber-800' : 'text-red-800'
                          }`}>
                            {paymentMethods?.message || t('storefront.paymentMethodsNotConfigured')}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <DialogFooter className="flex-col gap-2">
                {/* Helper text when button is disabled */}
                {(amountError || (!paymentMethods?.available || paymentMethods?.methods?.length === 0)) && (
                  <p className="text-xs text-gray-500 text-center w-full">
                    {amountError
                      ? t('storefront.enterValidAmountRange')
                      : (!paymentMethods?.available || paymentMethods?.methods?.length === 0)
                      ? t('storefront.paymentMethodsNotConfiguredShort')
                      : ''}
                  </p>
                )}

                <div className="flex gap-2 w-full">
                  <Button
                    variant="outline"
                    onClick={() => setShowPaymentModal(false)}
                    disabled={isProcessing}
                    className="flex-1"
                  >
                    {t('storefront.cancel')}
                  </Button>
                  <Button
                    onClick={handlePayment}
                    disabled={
                      isProcessing ||
                      !!amountError ||
                      (selectedProduct?.isVariableValue && !estimatedReceive && customAmount !== '') ||
                      (!paymentMethods?.available || paymentMethods?.methods?.length === 0)
                    }
                    className="flex-1"
                  >
                    {isProcessing ? (
                      <div className="flex items-center gap-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                        {t('storefront.processing')}
                      </div>
                    ) : (
                      t('storefront.pay', {
                        amount: (calculateOrderTotal()?.total ?? 0).toFixed(2)
                      })
                    )}
                  </Button>
                </div>
              </DialogFooter>
            </>
          ) : paymentStatus === 'success' ? (
            <>
              <div className="text-center py-6">
                <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle className="h-10 w-10 text-green-600" />
                </div>
                <DialogTitle className="text-2xl mb-2">{t('storefront.paymentSuccessful')}</DialogTitle>
                <DialogDescription>
                  {t('storefront.topupSentSuccess')}
                </DialogDescription>
                <div className="mt-4 p-4 bg-green-50 rounded-lg text-sm">
                  <p className="font-medium">
                    {selectedProduct?.isVariableValue && estimatedReceive && estimatedReceive.value !== undefined
                      ? `${estimatedReceive.value.toFixed(2)} ${estimatedReceive.currency}`
                      : `${selectedProduct?.benefitAmount} ${selectedProduct?.benefitUnit}`}
                  </p>
                  <p className="text-gray-600">{t('storefront.sentTo', { phone: lookupData?.phoneNumber })}</p>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="text-center py-6">
                <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-red-100 flex items-center justify-center">
                  <XCircle className="h-10 w-10 text-red-600" />
                </div>
                <DialogTitle className="text-2xl mb-2">{t('storefront.paymentFailed')}</DialogTitle>
                <DialogDescription>
                  {t('storefront.paymentFailedDesc')}
                </DialogDescription>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowPaymentModal(false);
                    setPaymentStatus('idle');
                  }}
                >
                  {t('storefront.close')}
                </Button>
                <Button
                  onClick={() => setPaymentStatus('idle')}
                >
                  {t('storefront.tryAgainBtn')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Footer */}
      <footer className="border-t bg-card mt-auto">
        <div className="container max-w-5xl mx-auto px-4 py-8">
          <div className="text-center space-y-2 text-sm text-muted-foreground">
            {lookupData?.branding?.supportEmail && (
              <p>
                {t('storefront.support')}{' '}
                <a
                  href={`mailto:${lookupData.branding.supportEmail}`}
                  className="text-primary hover:underline"
                >
                  {lookupData.branding.supportEmail}
                </a>
              </p>
            )}
            {lookupData?.branding?.supportPhone && (
              <p>
                {t('storefront.phone')}{' '}
                <a
                  href={`tel:${lookupData.branding.supportPhone}`}
                  className="text-primary hover:underline"
                >
                  {lookupData.branding.supportPhone}
                </a>
              </p>
            )}
            <p className="pt-4 border-t">
              {t('storefront.poweredByBrand', { brand: lookupData?.branding?.businessName || t('storefront.title') })}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
