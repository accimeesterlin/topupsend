'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Package, Edit, Trash2, Save, X } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
  metadata: {
    category?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export default function ProductDetailPage() {
  const router = useRouter();
  const params = useParams();
  const productId = params.id as string;

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    operatorName: '',
    operatorCountry: '',
    costPrice: '',
    sellPrice: '',
    currency: 'USD',
    denominationType: 'fixed',
    fixedAmount: '',
    minAmount: '',
    maxAmount: '',
    unit: 'USD',
    status: 'active',
    category: '',
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetchProduct();
  }, [productId]);

  const fetchProduct = async () => {
    try {
      const response = await fetch(`/api/v1/products/${productId}`);
      if (response.ok) {
        const data = await response.json();
        setProduct(data);
        setFormData({
          name: data.name,
          description: data.description || '',
          operatorName: data.operatorName,
          operatorCountry: data.operatorCountry,
          costPrice: data.pricing.costPrice.toString(),
          sellPrice: data.pricing.sellPrice.toString(),
          currency: data.pricing.currency,
          denominationType: data.denomination.type,
          fixedAmount: data.denomination.fixedAmount?.toString() || '',
          minAmount: data.denomination.minAmount?.toString() || '',
          maxAmount: data.denomination.maxAmount?.toString() || '',
          unit: data.denomination.unit,
          status: data.status,
          category: data.metadata.category || '',
        });
      } else if (response.status === 404) {
        setMessage({ type: 'error', text: 'Product not found' });
      }
    } catch (_error) {
      console.error('Failed to fetch product:', _error);
      setMessage({ type: 'error', text: 'Failed to load product details' });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/v1/products/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        const updatedProduct = await response.json();
        setProduct(updatedProduct);
        setEditing(false);
        setMessage({ type: 'success', text: 'Product updated successfully!' });
        setTimeout(() => setMessage(null), 3000);
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.error || 'Failed to update product' });
      }
    } catch (_error) {
      setMessage({ type: 'error', text: 'Failed to update product' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);

    try {
      const response = await fetch(`/api/v1/products/${productId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        router.push('/dashboard/products');
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.error || 'Failed to delete product' });
        setShowDeleteModal(false);
      }
    } catch (_error) {
      setMessage({ type: 'error', text: 'Failed to delete product' });
      setShowDeleteModal(false);
    } finally {
      setDeleting(false);
    }
  };

  const handleCancelEdit = () => {
    if (product) {
      setFormData({
        name: product.name,
        description: product.description || '',
        operatorName: product.operatorName,
        operatorCountry: product.operatorCountry,
        costPrice: product.pricing.costPrice.toString(),
        sellPrice: product.pricing.sellPrice.toString(),
        currency: product.pricing.currency,
        denominationType: product.denomination.type,
        fixedAmount: product.denomination.fixedAmount?.toString() || '',
        minAmount: product.denomination.minAmount?.toString() || '',
        maxAmount: product.denomination.maxAmount?.toString() || '',
        unit: product.denomination.unit,
        status: product.status,
        category: product.metadata.category || '',
      });
    }
    setEditing(false);
    setMessage(null);
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading product details...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!product) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-2">Product Not Found</h2>
            <p className="text-muted-foreground mb-6">The product you're looking for doesn't exist.</p>
            <Button onClick={() => router.push('/dashboard/products')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Products
            </Button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => router.push('/dashboard/products')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-3xl font-bold tracking-tight">Product Details</h1>
            <p className="text-muted-foreground mt-1">View and manage product information</p>
          </div>
          {!editing && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
              <Button variant="destructive" onClick={() => setShowDeleteModal(true)}>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </div>
          )}
        </div>

        {/* Success/Error Message */}
        {message && (
          <div
            className={`p-4 rounded-lg text-sm ${
              message.type === 'success'
                ? 'bg-green-50 text-green-800 border border-green-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Information */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <Package className="h-8 w-8 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-2xl">{product.name}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Created {formatDate(product.createdAt)}
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Basic Information */}
                <div>
                  <h3 className="font-semibold mb-4">Basic Information</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm text-muted-foreground">Product Name</label>
                      {editing ? (
                        <input
                          type="text"
                          className="w-full mt-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        />
                      ) : (
                        <p className="font-medium mt-1">{product.name}</p>
                      )}
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">Description</label>
                      {editing ? (
                        <textarea
                          className="w-full mt-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                          rows={3}
                          value={formData.description}
                          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        />
                      ) : (
                        <p className="font-medium mt-1">{product.description || 'No description'}</p>
                      )}
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">Category</label>
                      {editing ? (
                        <input
                          type="text"
                          className="w-full mt-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                          value={formData.category}
                          onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                        />
                      ) : (
                        <p className="font-medium mt-1">{product.metadata.category || 'Uncategorized'}</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Operator Information */}
                <div className="pt-4 border-t">
                  <h3 className="font-semibold mb-4">Operator Information</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm text-muted-foreground">Operator Name</label>
                      {editing ? (
                        <input
                          type="text"
                          className="w-full mt-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                          value={formData.operatorName}
                          onChange={(e) => setFormData({ ...formData, operatorName: e.target.value })}
                        />
                      ) : (
                        <p className="font-medium mt-1">{product.operatorName}</p>
                      )}
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">Country</label>
                      {editing ? (
                        <input
                          type="text"
                          className="w-full mt-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                          value={formData.operatorCountry}
                          onChange={(e) => setFormData({ ...formData, operatorCountry: e.target.value })}
                        />
                      ) : (
                        <p className="font-medium mt-1">{product.operatorCountry}</p>
                      )}
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">Provider</label>
                      <p className="font-medium mt-1 capitalize">{product.provider}</p>
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">Status</label>
                      {editing ? (
                        <select
                          className="w-full mt-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                          value={formData.status}
                          onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                          <option value="out_of_stock">Out of Stock</option>
                        </select>
                      ) : (
                        <p className="font-medium mt-1 capitalize">{product.status}</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Denomination */}
                <div className="pt-4 border-t">
                  <h3 className="font-semibold mb-4">Denomination</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm text-muted-foreground">Type</label>
                      {editing ? (
                        <select
                          className="w-full mt-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                          value={formData.denominationType}
                          onChange={(e) => setFormData({ ...formData, denominationType: e.target.value })}
                        >
                          <option value="fixed">Fixed Amount</option>
                          <option value="range">Range</option>
                        </select>
                      ) : (
                        <p className="font-medium mt-1 capitalize">{product.denomination.type}</p>
                      )}
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">Unit</label>
                      {editing ? (
                        <select
                          className="w-full mt-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                          value={formData.unit}
                          onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                        >
                          <option value="USD">USD</option>
                          <option value="PGK">PGK</option>
                          <option value="minutes">Minutes</option>
                          <option value="data">Data (MB/GB)</option>
                        </select>
                      ) : (
                        <p className="font-medium mt-1">{product.denomination.unit}</p>
                      )}
                    </div>
                  </div>
                  {editing && formData.denominationType === 'fixed' ? (
                    <div className="mt-4">
                      <label className="text-sm text-muted-foreground">Amount</label>
                      <input
                        type="number"
                        step="0.01"
                        className="w-full mt-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                        value={formData.fixedAmount}
                        onChange={(e) => setFormData({ ...formData, fixedAmount: e.target.value })}
                      />
                    </div>
                  ) : editing && formData.denominationType === 'range' ? (
                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <div>
                        <label className="text-sm text-muted-foreground">Min Amount</label>
                        <input
                          type="number"
                          step="0.01"
                          className="w-full mt-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                          value={formData.minAmount}
                          onChange={(e) => setFormData({ ...formData, minAmount: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-sm text-muted-foreground">Max Amount</label>
                        <input
                          type="number"
                          step="0.01"
                          className="w-full mt-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                          value={formData.maxAmount}
                          onChange={(e) => setFormData({ ...formData, maxAmount: e.target.value })}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4">
                      <label className="text-sm text-muted-foreground">Value</label>
                      <p className="font-medium mt-1">
                        {product.denomination.type === 'fixed'
                          ? `${product.denomination.fixedAmount} ${product.denomination.unit}`
                          : `${product.denomination.minAmount}-${product.denomination.maxAmount} ${product.denomination.unit}`}
                      </p>
                    </div>
                  )}
                </div>

                {editing && (
                  <div className="flex gap-3 pt-4 border-t">
                    <Button onClick={handleUpdate} disabled={saving}>
                      <Save className="h-4 w-4 mr-2" />
                      {saving ? 'Saving...' : 'Save Changes'}
                    </Button>
                    <Button variant="outline" onClick={handleCancelEdit} disabled={saving}>
                      <X className="h-4 w-4 mr-2" />
                      Cancel
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Pricing Sidebar */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Pricing</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm text-muted-foreground">Cost Price</label>
                  {editing ? (
                    <input
                      type="number"
                      step="0.01"
                      className="w-full mt-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                      value={formData.costPrice}
                      onChange={(e) => setFormData({ ...formData, costPrice: e.target.value })}
                    />
                  ) : (
                    <p className="font-semibold text-lg mt-1">
                      {formatCurrency(product.pricing.costPrice, product.pricing.currency)}
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Sell Price</label>
                  {editing ? (
                    <input
                      type="number"
                      step="0.01"
                      className="w-full mt-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                      value={formData.sellPrice}
                      onChange={(e) => setFormData({ ...formData, sellPrice: e.target.value })}
                    />
                  ) : (
                    <p className="font-semibold text-lg mt-1">
                      {formatCurrency(product.pricing.sellPrice, product.pricing.currency)}
                    </p>
                  )}
                </div>
                {editing && (
                  <div>
                    <label className="text-sm text-muted-foreground">Currency</label>
                    <select
                      className="w-full mt-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                      value={formData.currency}
                      onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                    >
                      <option value="USD">USD</option>
                      <option value="PGK">PGK</option>
                      <option value="EUR">EUR</option>
                      <option value="GBP">GBP</option>
                    </select>
                  </div>
                )}
                <div className="pt-4 border-t">
                  <label className="text-sm text-muted-foreground">Profit Margin</label>
                  <p className="font-bold text-2xl text-green-600 mt-1">
                    {product.pricing.profitMargin.toFixed(1)}%
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Delete Confirmation Modal */}
        <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Product</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this product? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <p className="text-sm text-muted-foreground">
                Product: <span className="font-semibold">{product.name}</span>
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDeleteModal(false)} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting...' : 'Delete Product'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
