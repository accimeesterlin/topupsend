'use client';

/**
 * Schedule Top-up Form Component
 * Form for creating and editing scheduled top-ups
 */

import { useState } from 'react';
import { toast } from '@topupsend/ui';
import type { CreateScheduledTopupRequest } from '@/types/scheduled-topups';

interface ScheduleFormProps {
  phoneNumber?: string;
  productId?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function ScheduleTopupForm({
  phoneNumber = '',
  productId = '',
  onSuccess,
  onCancel,
}: ScheduleFormProps) {
  const [formData, setFormData] = useState<Partial<CreateScheduledTopupRequest>>({
    phoneNumber,
    productId,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    recurrence: { enabled: false, type: 'daily' },
    notifications: {
      enabled: true,
      notifyBeforeMinutes: 60,
      notifyOnSuccess: true,
      notifyOnFailure: true,
      channels: ['email'],
    },
  });

  const [isRecurring, setIsRecurring] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/v1/scheduled-topups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create scheduled top-up');
      }

      toast({
        title: 'Success',
        description: 'Scheduled top-up created successfully!',
        variant: 'success',
      });

      onSuccess?.();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Phone Number */}
      <div>
        <label className="block text-sm font-medium mb-2">
          Phone Number <span className="text-red-500">*</span>
        </label>
        <input
          type="tel"
          value={formData.phoneNumber}
          onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
          className="w-full px-3 py-2 border rounded-md"
          placeholder="+50937654321"
          required
        />
      </div>

      {/* Product ID (In real app, this would be a product selector) */}
      <div>
        <label className="block text-sm font-medium mb-2">
          Product ID <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={formData.productId}
          onChange={(e) => setFormData({ ...formData, productId: e.target.value })}
          className="w-full px-3 py-2 border rounded-md"
          placeholder="Product ID"
          required
        />
      </div>

      {/* Amount */}
      <div>
        <label className="block text-sm font-medium mb-2">Amount (USD)</label>
        <input
          type="number"
          step="0.01"
          value={formData.amount || ''}
          onChange={(e) =>
            setFormData({ ...formData, amount: parseFloat(e.target.value) })
          }
          className="w-full px-3 py-2 border rounded-md"
          placeholder="10.00"
        />
      </div>

      {/* Scheduled Date/Time */}
      <div>
        <label className="block text-sm font-medium mb-2">
          Scheduled Date & Time <span className="text-red-500">*</span>
        </label>
        <input
          type="datetime-local"
          value={formData.scheduledDate || ''}
          onChange={(e) => setFormData({ ...formData, scheduledDate: e.target.value })}
          className="w-full px-3 py-2 border rounded-md"
          required
        />
      </div>

      {/* Timezone */}
      <div>
        <label className="block text-sm font-medium mb-2">Timezone</label>
        <input
          type="text"
          value={formData.timezone}
          onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
          className="w-full px-3 py-2 border rounded-md"
          placeholder="America/Port-au-Prince"
        />
      </div>

      {/* Recurrence Toggle */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="recurring"
          checked={isRecurring}
          onChange={(e) => {
            setIsRecurring(e.target.checked);
            setFormData({
              ...formData,
              recurrence: {
                ...formData.recurrence!,
                enabled: e.target.checked,
              },
            });
          }}
          className="h-4 w-4"
        />
        <label htmlFor="recurring" className="text-sm font-medium">
          Make this recurring
        </label>
      </div>

      {/* Recurrence Options */}
      {isRecurring && (
        <div className="border-l-4 border-blue-500 pl-4 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Recurrence Type</label>
            <select
              value={formData.recurrence?.type || 'daily'}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  recurrence: {
                    ...formData.recurrence!,
                    type: e.target.value as any,
                  },
                })
              }
              className="w-full px-3 py-2 border rounded-md"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          {formData.recurrence?.type === 'custom' && (
            <div>
              <label className="block text-sm font-medium mb-2">Interval (days)</label>
              <input
                type="number"
                min="1"
                value={formData.recurrence?.interval || 1}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    recurrence: {
                      ...formData.recurrence!,
                      interval: parseInt(e.target.value),
                    },
                  })
                }
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-2">Max Occurrences</label>
            <input
              type="number"
              min="1"
              value={formData.recurrence?.maxOccurrences || ''}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  recurrence: {
                    ...formData.recurrence!,
                    maxOccurrences: parseInt(e.target.value) || undefined,
                  },
                })
              }
              className="w-full px-3 py-2 border rounded-md"
              placeholder="Leave empty for unlimited"
            />
          </div>
        </div>
      )}

      {/* Customer Email */}
      <div>
        <label className="block text-sm font-medium mb-2">Customer Email</label>
        <input
          type="email"
          value={formData.customerEmail || ''}
          onChange={(e) => setFormData({ ...formData, customerEmail: e.target.value })}
          className="w-full px-3 py-2 border rounded-md"
          placeholder="customer@example.com"
        />
      </div>

      {/* Notes */}
      <div>
        <label className="block text-sm font-medium mb-2">Notes</label>
        <textarea
          value={formData.notes || ''}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          className="w-full px-3 py-2 border rounded-md"
          rows={3}
          placeholder="Optional notes about this schedule"
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 border rounded-md hover:bg-gray-50"
            disabled={isSubmitting}
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Creating...' : 'Create Schedule'}
        </button>
      </div>
    </form>
  );
}
