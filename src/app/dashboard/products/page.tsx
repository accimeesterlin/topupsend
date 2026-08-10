'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, Package, TrendingUp, Globe } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@topupsend/ui';
import { DashboardLayout } from '@/components/dashboard-layout';

interface Product {
  _id: string;
  name: string;
  description?: string;
  provider: 'dingconnect' | 'reloadly';
  operatorName: string;
  operatorCountry: string;
  operatorLogo?: string;
  pricing: {
    costPrice: number;
    sellPrice: number;
    currency: string;
    profitMargin: number;
  };
  denomination: {
    type: 'fixed' | 'range';
    fixedAmount?: number;
    minAmount?: number;
    maxAmount?: number;
    unit: string;
  };
  status: 'active' | 'inactive' | 'out_of_stock';
  createdAt: string;
}

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [search, setSearch] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchProducts = useCallback(async () => {
    try {
      setLoading(true);
      const url = search
        ? `/api/v1/products?search=${encodeURIComponent(search)}`
        : '/api/v1/products';
      const response = await fetch(url, {
        cache: 'no-store', // Force fresh data
      });
      if (response.ok) {
        const data = await response.json();
        setProducts(data);
      }
    } catch (_error) {
      console.error('Failed to fetch products:', _error);
    } finally {
      setLoading(false);
    }
  }, [search]);

  // Fetch products on mount and when search changes
  useEffect(() => {
    fetchProducts();
  }, [fetchProducts, refreshKey]);

  // Listen for storage events (used by org switcher to signal changes)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'orgChanged') {
        setRefreshKey(prev => prev + 1);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const handleCreate = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch('/api/v1/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description,
        }),
      });

      if (response.ok) {
        const product = await response.json();
        // Navigate to product detail page for configuration
        router.push(`/dashboard/products/${product._id}`);
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.error || 'Failed to create product' });
      }
    } catch (_error) {
      setMessage({ type: 'error', text: 'Failed to create product' });
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  };

  const getDenominationDisplay = (product: Product) => {
    if (product.denomination.type === 'fixed') {
      return `${product.denomination.fixedAmount} ${product.denomination.unit}`;
    }
    return `${product.denomination.minAmount}-${product.denomination.maxAmount} ${product.denomination.unit}`;
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading products...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Products</h1>
            <p className="text-muted-foreground mt-1">
              Manage your prepaid minute packages and pricing
            </p>
          </div>
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Product
          </Button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search products by name, operator, or country..."
            className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Products List */}
        {products.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.map((product) => (
              <Card
                key={product._id}
                className="hover:border-primary transition-colors cursor-pointer"
                onClick={() => router.push(`/dashboard/products/${product._id}`)}
              >
                <CardContent className="pt-6">
                  <div className="space-y-4">
                    {/* Product Header */}
                    <div className="flex items-start gap-3">
                      <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Package className="h-6 w-6 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold truncate">{product.name}</h3>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                          <Globe className="h-3 w-3" />
                          <span className="truncate">{product.operatorName}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{product.operatorCountry}</p>
                      </div>
                    </div>

                    {/* Denomination */}
                    <div className="p-3 bg-muted rounded-lg">
                      <div className="text-xs text-muted-foreground mb-1">Denomination</div>
                      <div className="font-semibold">{getDenominationDisplay(product)}</div>
                    </div>

                    {/* Pricing */}
                    <div className="space-y-2 pt-2 border-t">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Cost Price</span>
                        <span className="font-medium">
                          {formatCurrency(product.pricing.costPrice, product.pricing.currency)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Sell Price</span>
                        <span className="font-semibold">
                          {formatCurrency(product.pricing.sellPrice, product.pricing.currency)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <TrendingUp className="h-3 w-3" />
                          <span>Profit Margin</span>
                        </div>
                        <span className="font-semibold text-green-600">
                          {product.pricing.profitMargin.toFixed(1)}%
                        </span>
                      </div>
                    </div>

                    {/* Status Badge */}
                    <div className="flex items-center justify-between pt-2">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          product.status === 'active'
                            ? 'bg-green-100 text-green-800'
                            : product.status === 'out_of_stock'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {product.status}
                      </span>
                      <span className="text-xs text-muted-foreground capitalize">{product.provider}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <Plus className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">No products yet</h3>
              <p className="text-muted-foreground text-center max-w-md mb-6">
                Start by adding your first prepaid minute package. Configure your pricing and operators.
              </p>
              <Button onClick={() => setShowCreateModal(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Product
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Create Product Modal - Simplified */}
        <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Product</DialogTitle>
              <DialogDescription>
                Enter a name for your product. You'll configure pricing and details on the next page.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Product Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g., PNG Mobile Top-ups"
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Choose a descriptive name for this product offering
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Description <span className="text-muted-foreground">(Optional)</span>
                </label>
                <textarea
                  placeholder="Brief description of this product..."
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  rows={3}
                  value={formData.description || ''}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              {message && (
                <div
                  className={`p-3 rounded-lg text-sm ${
                    message.type === 'success'
                      ? 'bg-green-50 text-green-800 border border-green-200'
                      : 'bg-red-50 text-red-800 border border-red-200'
                  }`}
                >
                  {message.text}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateModal(false)} disabled={saving}>
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={saving || !formData.name?.trim()}
              >
                {saving ? 'Creating...' : 'Create & Configure'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
