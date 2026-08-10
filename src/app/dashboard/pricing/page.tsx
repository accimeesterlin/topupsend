'use client';

import { useEffect, useState } from 'react';
import { DollarSign, Plus, Edit, Trash2, Save, ChevronUp, ChevronDown, Info } from 'lucide-react';
import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, toast, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@topupsend/ui';
import { DashboardLayout } from '@/components/dashboard-layout';
import { cn } from '@/lib/utils';

interface PricingRule {
  _id: string;
  name: string;
  description?: string;
  percentageMarkup?: number;
  fixedMarkup?: number;
  // Legacy fields
  type?: 'percentage' | 'fixed';
  value?: number;
  priority: number;
  isActive: boolean;
  applicableCountries?: string[];
  applicableRegions?: string[];
  excludedCountries?: string[];
  minTransactionAmount?: number;
  maxTransactionAmount?: number;
}

const AVAILABLE_REGIONS = [
  'Africa',
  'Asia',
  'Europe',
  'North America',
  'South America',
  'Oceania',
  'Caribbean',
  'Latin America',
];

export default function PricingPage() {
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<PricingRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [showFeesTip, setShowFeesTip] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    percentageMarkup: '',
    fixedMarkup: '',
    priority: 0,
    isActive: true,
    scopeType: 'all' as 'all' | 'regions' | 'countries',
    applicableRegions: [] as string[],
    applicableCountries: [] as string[],
    excludedCountries: [] as string[],
    minTransactionAmount: '',
    maxTransactionAmount: '',
  });

  useEffect(() => {
    fetchPricingRules();
  }, []);

  const fetchPricingRules = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/v1/pricing');
      if (response.ok) {
        const data = await response.json();
        setPricingRules(data.pricingRules);
      }
    } catch (_error) {
      console.error('Failed to fetch pricing rules:', _error);
      toast({
        title: 'Error',
        description: 'Failed to load pricing rules',
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
      percentageMarkup: '',
      fixedMarkup: '',
      priority: 0,
      isActive: true,
      scopeType: 'all',
      applicableRegions: [],
      applicableCountries: [],
      excludedCountries: [],
      minTransactionAmount: '',
      maxTransactionAmount: '',
    });
    setEditingRule(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const openEditDialog = (rule: PricingRule) => {
    setEditingRule(rule);

    let scopeType: 'all' | 'regions' | 'countries' = 'all';
    if (rule.applicableRegions && rule.applicableRegions.length > 0) {
      scopeType = 'regions';
    } else if (rule.applicableCountries && rule.applicableCountries.length > 0) {
      scopeType = 'countries';
    }

    // Handle both new and legacy fields
    let percentageMarkup = '';
    let fixedMarkup = '';

    if (rule.percentageMarkup !== undefined || rule.fixedMarkup !== undefined) {
      // New format
      percentageMarkup = rule.percentageMarkup?.toString() || '';
      fixedMarkup = rule.fixedMarkup?.toString() || '';
    } else if (rule.type && rule.value !== undefined) {
      // Legacy format - convert to new format
      if (rule.type === 'percentage') {
        percentageMarkup = rule.value.toString();
      } else {
        fixedMarkup = rule.value.toString();
      }
    }

    setFormData({
      name: rule.name,
      description: rule.description || '',
      percentageMarkup,
      fixedMarkup,
      priority: rule.priority,
      isActive: rule.isActive,
      scopeType,
      applicableRegions: rule.applicableRegions || [],
      applicableCountries: rule.applicableCountries || [],
      excludedCountries: rule.excludedCountries || [],
      minTransactionAmount: rule.minTransactionAmount?.toString() || '',
      maxTransactionAmount: rule.maxTransactionAmount?.toString() || '',
    });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast({
        title: 'Error',
        description: 'Pricing rule name is required',
        variant: 'error',
      });
      return;
    }

    const percentageValue = formData.percentageMarkup ? parseFloat(formData.percentageMarkup) : 0;
    const fixedValue = formData.fixedMarkup ? parseFloat(formData.fixedMarkup) : 0;

    if (percentageValue <= 0 && fixedValue <= 0) {
      toast({
        title: 'Error',
        description: 'At least one pricing value (percentage or fixed) must be greater than 0',
        variant: 'error',
      });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: formData.name.trim(),
        description: formData.description.trim(),
        percentageMarkup: percentageValue > 0 ? percentageValue : undefined,
        fixedMarkup: fixedValue > 0 ? fixedValue : undefined,
        priority: formData.priority,
        isActive: formData.isActive,
        applicableRegions: formData.scopeType === 'regions' ? formData.applicableRegions : [],
        applicableCountries: formData.scopeType === 'countries' ? formData.applicableCountries : [],
        excludedCountries: formData.excludedCountries,
        minTransactionAmount: formData.minTransactionAmount ? parseFloat(formData.minTransactionAmount) : null,
        maxTransactionAmount: formData.maxTransactionAmount ? parseFloat(formData.maxTransactionAmount) : null,
      };

      const url = editingRule
        ? `/api/v1/pricing/${editingRule._id}`
        : '/api/v1/pricing';

      const method = editingRule ? 'PATCH' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        toast({
          title: 'Success',
          description: `Pricing rule ${editingRule ? 'updated' : 'created'} successfully!`,
          variant: 'success',
        });
        setIsDialogOpen(false);
        resetForm();
        fetchPricingRules();
      } else {
        const error = await response.json();
        toast({
          title: 'Error',
          description: error.error || 'Failed to save pricing rule',
          variant: 'error',
        });
      }
    } catch (_error) {
      console.error('Failed to save pricing rule:', _error);
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
    if (!confirm('Are you sure you want to delete this pricing rule?')) {
      return;
    }

    try {
      const response = await fetch(`/api/v1/pricing/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        toast({
          title: 'Success',
          description: 'Pricing rule deleted successfully!',
          variant: 'success',
        });
        fetchPricingRules();
      } else {
        toast({
          title: 'Error',
          description: 'Failed to delete pricing rule',
          variant: 'error',
        });
      }
    } catch (_error) {
      console.error('Failed to delete pricing rule:', _error);
      toast({
        title: 'Error',
        description: 'An unexpected error occurred',
        variant: 'error',
      });
    }
  };

  const toggleRuleStatus = async (rule: PricingRule) => {
    try {
      const response = await fetch(`/api/v1/pricing/${rule._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !rule.isActive }),
      });

      if (response.ok) {
        toast({
          title: 'Success',
          description: `Pricing rule ${!rule.isActive ? 'activated' : 'deactivated'}`,
          variant: 'success',
        });
        fetchPricingRules();
      } else {
        toast({
          title: 'Error',
          description: 'Failed to update pricing rule status',
          variant: 'error',
        });
      }
    } catch (_error) {
      console.error('Failed to toggle pricing rule:', _error);
      toast({
        title: 'Error',
        description: 'An unexpected error occurred',
        variant: 'error',
      });
    }
  };

  const movePriority = async (rule: PricingRule, direction: 'up' | 'down') => {
    const newPriority = direction === 'up' ? rule.priority + 1 : rule.priority - 1;

    try {
      const response = await fetch(`/api/v1/pricing/${rule._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: newPriority }),
      });

      if (response.ok) {
        fetchPricingRules();
      }
    } catch (_error) {
      console.error('Failed to update priority:', _error);
    }
  };

  const getScopeDescription = (rule: PricingRule) => {
    if (rule.applicableRegions && rule.applicableRegions.length > 0) {
      return `Regions: ${rule.applicableRegions.join(', ')}`;
    }
    if (rule.applicableCountries && rule.applicableCountries.length > 0) {
      return `Countries: ${rule.applicableCountries.length} selected`;
    }
    return 'All countries';
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading pricing rules...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Pricing Rules</h1>
            <p className="text-muted-foreground mt-1">
              Configure flexible pricing markups for different countries and regions
            </p>
          </div>
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-2" />
            Create Rule
          </Button>
        </div>

        {/* Info Card */}
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <div className="flex-shrink-0">
                <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                  <DollarSign className="h-5 w-5 text-blue-600" />
                </div>
              </div>
              <div>
                <h3 className="font-semibold mb-1">How Pricing Rules Work</h3>
                <p className="text-sm text-muted-foreground">
                  Rules are applied in priority order (higher first). You can create rules for specific countries,
                  regions, or globally. Transaction limits help you control when rules apply.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Pricing Rules List */}
        {pricingRules.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <DollarSign className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <p className="text-muted-foreground font-medium">No pricing rules created yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Create your first pricing rule to start customizing your markups
                </p>
                <Button onClick={openCreateDialog} className="mt-4">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Pricing Rule
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {pricingRules.map((rule, index) => (
              <Card key={rule._id} className={cn(!rule.isActive && 'opacity-60')}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <CardTitle>{rule.name}</CardTitle>
                        {rule.isActive ? (
                          <span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs font-medium rounded">
                            Active
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-gray-100 text-gray-800 text-xs font-medium rounded">
                            Inactive
                          </span>
                        )}
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-xs font-medium rounded">
                          Priority: {rule.priority}
                        </span>
                      </div>
                      {rule.description && (
                        <CardDescription className="mt-1">{rule.description}</CardDescription>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => movePriority(rule, 'up')}
                        disabled={index === 0}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => movePriority(rule, 'down')}
                        disabled={index === pricingRules.length - 1}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog(rule)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(rule._id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Markup Value */}
                    <div className="p-4 bg-primary/5 rounded-lg">
                      <div className="text-sm text-muted-foreground mb-1">Markup</div>
                      <div className="text-2xl font-bold text-primary">
                        {rule.percentageMarkup !== undefined || rule.fixedMarkup !== undefined ? (
                          <>
                            {rule.percentageMarkup && rule.percentageMarkup > 0 && `${rule.percentageMarkup}%`}
                            {rule.percentageMarkup && rule.percentageMarkup > 0 && rule.fixedMarkup && rule.fixedMarkup > 0 && ' + '}
                            {rule.fixedMarkup && rule.fixedMarkup > 0 && `$${rule.fixedMarkup}`}
                          </>
                        ) : (
                          // Legacy display
                          rule.type === 'percentage' ? `${rule.value}%` : `$${rule.value}`
                        )}
                      </div>
                    </div>

                    {/* Scope */}
                    <div className="p-4 bg-muted/50 rounded-lg">
                      <div className="text-sm text-muted-foreground mb-1">Scope</div>
                      <div className="text-sm font-medium">{getScopeDescription(rule)}</div>
                    </div>

                    {/* Transaction Limits */}
                    <div className="p-4 bg-muted/50 rounded-lg">
                      <div className="text-sm text-muted-foreground mb-1">Transaction Limits</div>
                      <div className="text-sm font-medium">
                        {rule.minTransactionAmount || rule.maxTransactionAmount ? (
                          <>
                            {rule.minTransactionAmount && `Min: $${rule.minTransactionAmount}`}
                            {rule.minTransactionAmount && rule.maxTransactionAmount && ' / '}
                            {rule.maxTransactionAmount && `Max: $${rule.maxTransactionAmount}`}
                          </>
                        ) : (
                          'No limits'
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <Button
                      variant={rule.isActive ? 'outline' : 'default'}
                      size="sm"
                      onClick={() => toggleRuleStatus(rule)}
                    >
                      {rule.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Create/Edit Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingRule ? 'Edit Pricing Rule' : 'Create New Pricing Rule'}
              </DialogTitle>
              <DialogDescription>
                {editingRule
                  ? 'Update the pricing rule details below'
                  : 'Create a new rule to customize pricing for specific countries or regions'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Rule Name</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="e.g., African Countries Markup"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Description (optional)</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Brief description of this rule"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              <div>
                <div className="flex items-center gap-2 mb-2">
                  <label className="text-sm font-medium">Fees Configuration</label>
                  <button
                    type="button"
                    onClick={() => setShowFeesTip(!showFeesTip)}
                    className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 hover:bg-blue-200 transition-colors"
                  >
                    <Info className="h-3 w-3 text-blue-600" />
                  </button>
                </div>

                {showFeesTip && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg mb-3 animate-in slide-in-from-top-2">
                    <p className="text-sm text-blue-800">
                      <strong>Tip:</strong> You can use percentage markup, fixed markup, or both together.
                      For example: 20% + $0.50 will apply 20% of the cost price then add $0.50.
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-muted-foreground mb-2 block">Percentage Markup (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="w-full px-3 py-2 border rounded-lg"
                      placeholder="e.g., 20 or 150"
                      value={formData.percentageMarkup}
                      onChange={(e) => setFormData({ ...formData, percentageMarkup: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground mt-1">Optional - Applied as % of cost price</p>
                  </div>

                  <div>
                    <label className="text-sm text-muted-foreground mb-2 block">Fixed Markup ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="w-full px-3 py-2 border rounded-lg"
                      placeholder="e.g., 0.50"
                      value={formData.fixedMarkup}
                      onChange={(e) => setFormData({ ...formData, fixedMarkup: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground mt-1">Optional - Added as fixed amount</p>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Priority</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="0"
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                />
                <p className="text-xs text-muted-foreground mt-1">Higher priority rules are applied first (e.g., 100 before 50)</p>
              </div>

              {/* Scope Selection */}
              <div>
                <label className="text-sm font-medium mb-2 block">Apply To</label>
                <select
                  className="w-full px-3 py-2 border rounded-lg mb-3"
                  value={formData.scopeType}
                  onChange={(e) => setFormData({ ...formData, scopeType: e.target.value as any })}
                >
                  <option value="all">All Countries</option>
                  <option value="regions">Specific Regions</option>
                  <option value="countries">Specific Countries</option>
                </select>

                {formData.scopeType === 'regions' && (
                  <div className="grid grid-cols-2 gap-2">
                    {AVAILABLE_REGIONS.map((region) => (
                      <label key={region} className="flex items-center gap-2 p-2 border rounded hover:bg-muted/50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.applicableRegions.includes(region)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData({
                                ...formData,
                                applicableRegions: [...formData.applicableRegions, region],
                              });
                            } else {
                              setFormData({
                                ...formData,
                                applicableRegions: formData.applicableRegions.filter((r) => r !== region),
                              });
                            }
                          }}
                        />
                        <span className="text-sm">{region}</span>
                      </label>
                    ))}
                  </div>
                )}

                {formData.scopeType === 'countries' && (
                  <div>
                    <textarea
                      className="w-full px-3 py-2 border rounded-lg"
                      rows={3}
                      placeholder="Enter country codes separated by commas (e.g., US, CA, MX)"
                      value={formData.applicableCountries.join(', ')}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          applicableCountries: e.target.value.split(',').map((c) => c.trim()).filter(Boolean),
                        })
                      }
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Min Transaction Amount (optional)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="5.00"
                    value={formData.minTransactionAmount}
                    onChange={(e) => setFormData({ ...formData, minTransactionAmount: e.target.value })}
                  />
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">Max Transaction Amount (optional)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="500.00"
                    value={formData.maxTransactionAmount}
                    onChange={(e) => setFormData({ ...formData, maxTransactionAmount: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  className="h-4 w-4"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                />
                <label htmlFor="isActive" className="text-sm font-medium">
                  Activate rule immediately
                </label>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                <Save className="h-4 w-4 mr-2" />
                {saving ? 'Saving...' : editingRule ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
