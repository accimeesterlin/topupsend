'use client';

import { useEffect, useState } from 'react';
import { Tag, Save, Plus, Edit, Trash2, Search, Filter, Copy, Sparkles, ChevronDown, ChevronRight } from 'lucide-react';
import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, toast, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@topupsend/ui';
import { DashboardLayout } from '@/components/dashboard-layout';
import { cn } from '@/lib/utils';

interface Discount {
  _id: string;
  name: string;
  description: string;
  code?: string;
  type: 'percentage' | 'fixed';
  value: number;
  isActive: boolean;
  startDate?: string;
  endDate?: string;
  minPurchaseAmount?: number;
  maxDiscountAmount?: number;
  applicableCountries?: string[];
  applicableProducts?: string[];
  usageLimit?: number;
  maxUsesPerCustomer?: number;
  usageCount: number;
}

export default function DiscountsPage() {
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState<Discount | null>(null);
  const [saving, setSaving] = useState(false);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [codeTypeFilter, setCodeTypeFilter] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    code: '',
    autoGenerateCode: true, // Default to auto-generate
    type: 'percentage' as 'percentage' | 'fixed',
    value: 0,
    isActive: true,
    startDate: '',
    endDate: '',
    minPurchaseAmount: '',
    maxDiscountAmount: '',
    usageLimit: '',
    maxUsesPerCustomer: '',
  });

  useEffect(() => {
    fetchDiscounts();
  }, [searchQuery, statusFilter, typeFilter, codeTypeFilter]);

  const fetchDiscounts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (typeFilter !== 'all') params.append('type', typeFilter);
      if (codeTypeFilter !== 'all') params.append('codeType', codeTypeFilter);

      const url = `/api/v1/discounts${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await fetch(url);

      if (response.ok) {
        const data = await response.json();
        setDiscounts(data.discounts || []);
      } else {
        const error = await response.json();
        toast({
          title: 'Error',
          description: error.message || error.detail || 'Failed to load discounts',
          variant: 'error',
        });
      }
    } catch (_error) {
      console.error('Failed to fetch discounts:', _error);
      toast({
        title: 'Error',
        description: 'Failed to load discounts. Please check your connection.',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      code: '',
      autoGenerateCode: true, // Default to auto-generate
      type: 'percentage',
      value: 0,
      isActive: true,
      startDate: '',
      endDate: '',
      minPurchaseAmount: '',
      maxDiscountAmount: '',
      usageLimit: '',
      maxUsesPerCustomer: '',
    });
    setEditingDiscount(null);
    setShowAdvanced(false); // Reset advanced options visibility
  };

  const openCreateDialog = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const openEditDialog = (discount: Discount) => {
    setEditingDiscount(discount);
    setFormData({
      name: discount.name,
      description: discount.description,
      code: discount.code || '',
      autoGenerateCode: false,
      type: discount.type,
      value: discount.value,
      isActive: discount.isActive,
      startDate: discount.startDate ? new Date(discount.startDate).toISOString().split('T')[0] : '',
      endDate: discount.endDate ? new Date(discount.endDate).toISOString().split('T')[0] : '',
      minPurchaseAmount: discount.minPurchaseAmount?.toString() || '',
      maxDiscountAmount: discount.maxDiscountAmount?.toString() || '',
      usageLimit: discount.usageLimit?.toString() || '',
      maxUsesPerCustomer: discount.maxUsesPerCustomer?.toString() || '',
    });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast({
        title: 'Error',
        description: 'Discount name is required',
        variant: 'error',
      });
      return;
    }

    if (!formData.description.trim()) {
      toast({
        title: 'Error',
        description: 'Discount description is required',
        variant: 'error',
      });
      return;
    }

    if (formData.value <= 0) {
      toast({
        title: 'Error',
        description: 'Discount value must be greater than 0',
        variant: 'error',
      });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: formData.name.trim(),
        description: formData.description.trim(),
        code: formData.code.trim() || undefined,
        autoGenerateCode: formData.autoGenerateCode,
        type: formData.type,
        value: formData.value,
        isActive: formData.isActive,
        startDate: formData.startDate || null,
        endDate: formData.endDate || null,
        minPurchaseAmount: formData.minPurchaseAmount ? parseFloat(formData.minPurchaseAmount) : null,
        maxDiscountAmount: formData.maxDiscountAmount ? parseFloat(formData.maxDiscountAmount) : null,
        usageLimit: formData.usageLimit ? parseInt(formData.usageLimit) : null,
        maxUsesPerCustomer: formData.maxUsesPerCustomer ? parseInt(formData.maxUsesPerCustomer) : null,
      };

      const url = editingDiscount
        ? `/api/v1/discounts/${editingDiscount._id}`
        : '/api/v1/discounts';

      const method = editingDiscount ? 'PATCH' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        toast({
          title: 'Success',
          description: `Discount ${editingDiscount ? 'updated' : 'created'} successfully!`,
          variant: 'success',
        });
        setIsDialogOpen(false);
        resetForm();
        fetchDiscounts();
      } else {
        const error = await response.json();
        toast({
          title: 'Error',
          description: error.error || error.detail || 'Failed to save discount',
          variant: 'error',
        });
      }
    } catch (_error) {
      console.error('Failed to save discount:', _error);
      toast({
        title: 'Error',
        description: 'An unexpected error occurred',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this discount?')) {
      return;
    }

    try {
      const response = await fetch(`/api/v1/discounts/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        toast({
          title: 'Success',
          description: 'Discount deleted successfully!',
          variant: 'success',
        });
        fetchDiscounts();
      } else {
        toast({
          title: 'Error',
          description: 'Failed to delete discount',
          variant: 'error',
        });
      }
    } catch (_error) {
      console.error('Failed to delete discount:', _error);
      toast({
        title: 'Error',
        description: 'An unexpected error occurred',
        variant: 'error',
      });
    }
  };

  const toggleDiscountStatus = async (discount: Discount) => {
    try {
      const response = await fetch(`/api/v1/discounts/${discount._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !discount.isActive }),
      });

      if (response.ok) {
        toast({
          title: 'Success',
          description: `Discount ${!discount.isActive ? 'activated' : 'deactivated'}`,
          variant: 'success',
        });
        fetchDiscounts();
      } else {
        toast({
          title: 'Error',
          description: 'Failed to update discount status',
          variant: 'error',
        });
      }
    } catch (_error) {
      console.error('Failed to toggle discount:', _error);
      toast({
        title: 'Error',
        description: 'An unexpected error occurred',
        variant: 'error',
      });
    }
  };

  const copyCodeToClipboard = (code: string) => {
    navigator.clipboard.writeText(code);
    toast({
      title: 'Copied!',
      description: `Discount code "${code}" copied to clipboard`,
      variant: 'success',
    });
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading discounts...</p>
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
            <h1 className="text-3xl font-bold tracking-tight">Discounts</h1>
            <p className="text-muted-foreground mt-1">
              Create and manage promotional discounts and discount codes
            </p>
          </div>
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-2" />
            Create Discount
          </Button>
        </div>

        {/* Search and Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              {/* Search Bar */}
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search by name, description, or code..."
                    className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={() => setShowFilters(!showFilters)}
                  className="sm:w-auto"
                >
                  <Filter className="h-4 w-4 mr-2" />
                  Filters
                  {(statusFilter !== 'all' || typeFilter !== 'all' || codeTypeFilter !== 'all') && (
                    <span className="ml-2 px-1.5 py-0.5 bg-primary text-primary-foreground rounded-full text-xs">
                      {[statusFilter !== 'all', typeFilter !== 'all', codeTypeFilter !== 'all'].filter(Boolean).length}
                    </span>
                  )}
                </Button>
              </div>

              {/* Filters */}
              {showFilters && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t animate-in slide-in-from-top-2">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Status</label>
                    <select
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                    >
                      <option value="all">All Statuses</option>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="expired">Expired</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Type</label>
                    <select
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      value={typeFilter}
                      onChange={(e) => setTypeFilter(e.target.value)}
                    >
                      <option value="all">All Types</option>
                      <option value="percentage">Percentage</option>
                      <option value="fixed">Fixed Amount</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Code Type</label>
                    <select
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      value={codeTypeFilter}
                      onChange={(e) => setCodeTypeFilter(e.target.value)}
                    >
                      <option value="all">All</option>
                      <option value="coded">With Code</option>
                      <option value="automatic">Automatic</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Results count */}
              <div className="flex justify-between items-center text-sm text-muted-foreground">
                <span>{discounts.length} discount{discounts.length !== 1 ? 's' : ''} found</span>
                {(searchQuery || statusFilter !== 'all' || typeFilter !== 'all' || codeTypeFilter !== 'all') && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setStatusFilter('all');
                      setTypeFilter('all');
                      setCodeTypeFilter('all');
                    }}
                    className="text-primary hover:underline"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Discounts List */}
        {discounts.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <Tag className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <p className="text-muted-foreground font-medium">
                  {searchQuery || statusFilter !== 'all' || typeFilter !== 'all' || codeTypeFilter !== 'all'
                    ? 'No discounts match your filters'
                    : 'No discounts created yet'}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {searchQuery || statusFilter !== 'all' || typeFilter !== 'all' || codeTypeFilter !== 'all'
                    ? 'Try adjusting your search or filters'
                    : 'Create your first discount to start offering promotions'}
                </p>
                {!searchQuery && statusFilter === 'all' && typeFilter === 'all' && codeTypeFilter === 'all' && (
                  <Button onClick={openCreateDialog} className="mt-4">
                    <Plus className="h-4 w-4 mr-2" />
                    Create Discount
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {discounts.map((discount) => (
              <Card key={discount._id} className={cn('hover:border-primary transition-colors', !discount.isActive && 'opacity-60')}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="truncate">{discount.name}</CardTitle>
                        {discount.isActive ? (
                          <span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs font-medium rounded flex-shrink-0">
                            Active
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-gray-100 text-gray-800 text-xs font-medium rounded flex-shrink-0">
                            Inactive
                          </span>
                        )}
                      </div>
                      <CardDescription className="mt-1">{discount.description}</CardDescription>
                      {/* Discount Code */}
                      {discount.code && (
                        <div className="mt-2 inline-flex items-center gap-2 px-2.5 py-1 bg-primary/10 rounded-md">
                          <code className="text-sm font-mono font-semibold text-primary">{discount.code}</code>
                          <button
                            onClick={() => copyCodeToClipboard(discount.code!)}
                            className="text-primary hover:text-primary/80 transition-colors"
                            title="Copy code"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog(discount)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(discount._id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Discount Value */}
                  <div className="flex items-center justify-between p-3 bg-primary/5 rounded-lg">
                    <span className="text-sm font-medium">Discount:</span>
                    <span className="text-lg font-bold text-primary">
                      {discount.type === 'percentage' ? `${discount.value}%` : `$${discount.value}`} off
                    </span>
                  </div>

                  {/* Details */}
                  <div className="space-y-2 text-sm">
                    {discount.minPurchaseAmount && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Min Purchase:</span>
                        <span className="font-medium">${discount.minPurchaseAmount}</span>
                      </div>
                    )}
                    {discount.maxDiscountAmount && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Max Discount:</span>
                        <span className="font-medium">${discount.maxDiscountAmount}</span>
                      </div>
                    )}
                    {discount.usageLimit && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Usage:</span>
                        <span className="font-medium">
                          {discount.usageCount} / {discount.usageLimit}
                        </span>
                      </div>
                    )}
                    {discount.maxUsesPerCustomer && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Per Customer:</span>
                        <span className="font-medium">{discount.maxUsesPerCustomer} uses max</span>
                      </div>
                    )}
                    {(discount.startDate || discount.endDate) && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Valid:</span>
                        <span className="font-medium text-right">
                          {discount.startDate && new Date(discount.startDate).toLocaleDateString()}
                          {discount.startDate && discount.endDate && ' - '}
                          {discount.endDate && new Date(discount.endDate).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="pt-2">
                    <Button
                      variant={discount.isActive ? 'outline' : 'default'}
                      size="sm"
                      className="w-full"
                      onClick={() => toggleDiscountStatus(discount)}
                    >
                      {discount.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Create/Edit Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingDiscount ? 'Edit Discount' : 'Create New Discount'}
              </DialogTitle>
              <DialogDescription>
                {editingDiscount
                  ? 'Update the discount details below'
                  : 'Fill in the details to create a new discount or discount code'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Essential Fields */}
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Discount Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="e.g., Summer Sale 2024"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">
                  Description <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="e.g., Get 10% off all top-ups this summer!"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">
                    Discount Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as 'percentage' | 'fixed' })}
                  >
                    <option value="percentage">Percentage (%)</option>
                    <option value="fixed">Fixed Amount ($)</option>
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">
                    Discount Value <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder={formData.type === 'percentage' ? '10' : '5.00'}
                      value={formData.value || ''}
                      onChange={(e) => setFormData({ ...formData, value: parseFloat(e.target.value) || 0 })}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {formData.type === 'percentage' ? '%' : '$'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Code Generation Section */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Sparkles className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <label className="text-sm font-medium text-blue-900">Discount Code</label>
                      <Button
                        type="button"
                        size="sm"
                        variant={formData.autoGenerateCode ? 'default' : 'outline'}
                        onClick={() => setFormData({ ...formData, autoGenerateCode: !formData.autoGenerateCode, code: '' })}
                        className="h-7 text-xs"
                      >
                        {formData.autoGenerateCode ? (
                          <>
                            <Sparkles className="h-3 w-3 mr-1" />
                            Auto-Generate
                          </>
                        ) : (
                          <>
                            <Edit className="h-3 w-3 mr-1" />
                            Custom Code
                          </>
                        )}
                      </Button>
                    </div>
                    {formData.autoGenerateCode ? (
                      <p className="text-xs text-blue-700">
                        A unique code will be automatically generated (e.g., SAVE20-ABC123)
                      </p>
                    ) : (
                      <input
                        type="text"
                        className="w-full px-3 py-2 border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase font-mono text-sm mt-2"
                        placeholder="SUMMER2024"
                        value={formData.code}
                        onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                      />
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  className="h-4 w-4 rounded border-gray-300"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                />
                <label htmlFor="isActive" className="text-sm font-medium">
                  Activate discount immediately
                </label>
              </div>

              {/* Advanced Options Toggle */}
              <div className="border-t pt-4">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                >
                  {showAdvanced ? (
                    <>
                      <ChevronDown className="h-4 w-4" />
                      Hide Advanced Options
                    </>
                  ) : (
                    <>
                      <ChevronRight className="h-4 w-4" />
                      Show Advanced Options
                    </>
                  )}
                </button>
              </div>

              {/* Advanced Options */}
              {showAdvanced && (
                <div className="space-y-4 animate-in slide-in-from-top-2 border-t pt-4">
                  <p className="text-sm text-muted-foreground">Configure additional discount constraints and limits</p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium mb-2 block">Start Date</label>
                      <input
                        type="date"
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                        value={formData.startDate}
                        onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                      />
                    </div>

                    <div>
                      <label className="text-sm font-medium mb-2 block">End Date</label>
                      <input
                        type="date"
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                        value={formData.endDate}
                        onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium mb-2 block">Min Purchase Amount</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                        <input
                          type="number"
                          step="0.01"
                          className="w-full pl-7 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                          placeholder="0.00"
                          value={formData.minPurchaseAmount}
                          onChange={(e) => setFormData({ ...formData, minPurchaseAmount: e.target.value })}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-sm font-medium mb-2 block">Max Discount Amount</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                        <input
                          type="number"
                          step="0.01"
                          className="w-full pl-7 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                          placeholder="Unlimited"
                          value={formData.maxDiscountAmount}
                          onChange={(e) => setFormData({ ...formData, maxDiscountAmount: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium mb-2 block">Total Usage Limit</label>
                      <input
                        type="number"
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                        placeholder="Unlimited"
                        value={formData.usageLimit}
                        onChange={(e) => setFormData({ ...formData, usageLimit: e.target.value })}
                      />
                    </div>

                    <div>
                      <label className="text-sm font-medium mb-2 block">Max Uses Per Customer</label>
                      <input
                        type="number"
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                        placeholder="Unlimited"
                        value={formData.maxUsesPerCustomer}
                        onChange={(e) => setFormData({ ...formData, maxUsesPerCustomer: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                <Save className="h-4 w-4 mr-2" />
                {saving ? 'Saving...' : editingDiscount ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
