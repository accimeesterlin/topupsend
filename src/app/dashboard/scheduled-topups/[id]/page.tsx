'use client';

/**
 * Scheduled Top-up Details Page
 * View detailed information about a specific scheduled top-up
 */

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@topupsend/ui';
import type { DetailedScheduledTopupResponse } from '@/types/scheduled-topups';
import { format } from 'date-fns';

interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

export default function ScheduledTopupDetailsPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();
  const [schedule, setSchedule] = useState<DetailedScheduledTopupResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchSchedule();
  }, [id]);

  const fetchSchedule = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/v1/scheduled-topups/${id}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch schedule details');
      }

      setSchedule(data.data);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'error',
      });
      router.push('/dashboard/scheduled-topups');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePause = async () => {
    try {
      const response = await fetch(`/api/v1/scheduled-topups/${id}/pause`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to pause schedule');
      }

      toast({
        title: 'Success',
        description: 'Schedule paused successfully',
        variant: 'success',
      });

      fetchSchedule();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'error',
      });
    }
  };

  const handleResume = async () => {
    try {
      const response = await fetch(`/api/v1/scheduled-topups/${id}/resume`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to resume schedule');
      }

      toast({
        title: 'Success',
        description: 'Schedule resumed successfully',
        variant: 'success',
      });

      fetchSchedule();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'error',
      });
    }
  };

  const handleCancel = async () => {
    if (!confirm('Are you sure you want to cancel this schedule?')) {
      return;
    }

    try {
      const response = await fetch(`/api/v1/scheduled-topups/${id}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to cancel schedule');
      }

      toast({
        title: 'Success',
        description: 'Schedule cancelled successfully',
        variant: 'success',
      });

      router.push('/dashboard/scheduled-topups');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'error',
      });
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      active: 'bg-green-100 text-green-800',
      paused: 'bg-yellow-100 text-yellow-800',
      completed: 'bg-blue-100 text-blue-800',
      cancelled: 'bg-gray-100 text-gray-800',
      failed: 'bg-red-100 text-red-800',
    };

    return (
      <span
        className={`px-3 py-1 rounded-full text-sm font-semibold ${
          colors[status] || 'bg-gray-100 text-gray-800'
        }`}
      >
        {status}
      </span>
    );
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="text-center py-12">Loading schedule details...</div>
      </div>
    );
  }

  if (!schedule) {
    return (
      <div className="p-6">
        <div className="text-center py-12">Schedule not found</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => router.push('/dashboard/scheduled-topups')}
          className="text-blue-600 hover:text-blue-800 mb-4"
        >
          ← Back to Schedules
        </button>
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold mb-2">Scheduled Top-up Details</h1>
            <div className="flex items-center gap-3">
              {getStatusBadge(schedule.status)}
              <span className="text-sm text-gray-600">ID: {schedule.id}</span>
            </div>
          </div>
          <div className="flex gap-2">
            {schedule.status === 'active' && (
              <button
                onClick={handlePause}
                className="px-4 py-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600"
              >
                Pause
              </button>
            )}
            {schedule.status === 'paused' && (
              <button
                onClick={handleResume}
                className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600"
              >
                Resume
              </button>
            )}
            {(schedule.status === 'active' || schedule.status === 'paused') && (
              <button
                onClick={handleCancel}
                className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Info */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        <div className="bg-white p-6 rounded-lg border">
          <h2 className="text-lg font-semibold mb-4">Recipient Information</h2>
          <div className="space-y-3">
            <div>
              <span className="text-sm text-gray-600">Phone Number</span>
              <p className="font-medium">{schedule.phoneNumber}</p>
            </div>
            {schedule.customerEmail && (
              <div>
                <span className="text-sm text-gray-600">Email</span>
                <p className="font-medium">{schedule.customerEmail}</p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg border">
          <h2 className="text-lg font-semibold mb-4">Product Information</h2>
          <div className="space-y-3">
            <div>
              <span className="text-sm text-gray-600">Product</span>
              <p className="font-medium">{schedule.product.snapshot.name}</p>
            </div>
            <div>
              <span className="text-sm text-gray-600">Provider</span>
              <p className="font-medium">{schedule.product.snapshot.providerCode}</p>
            </div>
            <div>
              <span className="text-sm text-gray-600">Amount</span>
              <p className="font-medium">${schedule.amount.toFixed(2)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Schedule Info */}
      <div className="bg-white p-6 rounded-lg border mb-6">
        <h2 className="text-lg font-semibold mb-4">Schedule Configuration</h2>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <span className="text-sm text-gray-600">First Scheduled Date</span>
            <p className="font-medium">
              {format(new Date(schedule.scheduledDate), 'MMM d, yyyy HH:mm')}
            </p>
          </div>
          <div>
            <span className="text-sm text-gray-600">Timezone</span>
            <p className="font-medium">{schedule.timezone}</p>
          </div>
          <div>
            <span className="text-sm text-gray-600">Next Execution</span>
            <p className="font-medium">
              {schedule.nextExecutionAt
                ? format(new Date(schedule.nextExecutionAt), 'MMM d, yyyy HH:mm')
                : 'None scheduled'}
            </p>
          </div>
          <div>
            <span className="text-sm text-gray-600">Recurrence</span>
            <p className="font-medium">
              {schedule.recurrence.enabled ? (
                <span className="capitalize">{schedule.recurrence.type}</span>
              ) : (
                'One-time'
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Execution Stats */}
      <div className="bg-white p-6 rounded-lg border mb-6">
        <h2 className="text-lg font-semibold mb-4">Execution Statistics</h2>
        <div className="grid grid-cols-3 gap-6">
          <div>
            <span className="text-sm text-gray-600">Total Executions</span>
            <p className="text-2xl font-bold text-blue-600">{schedule.executionCount}</p>
          </div>
          <div>
            <span className="text-sm text-gray-600">Failures</span>
            <p className="text-2xl font-bold text-red-600">{schedule.failureCount}</p>
          </div>
          <div>
            <span className="text-sm text-gray-600">Last Executed</span>
            <p className="font-medium">
              {schedule.lastExecutedAt
                ? format(new Date(schedule.lastExecutedAt), 'MMM d, HH:mm')
                : 'Never'}
            </p>
          </div>
        </div>
      </div>

      {/* Upcoming Executions */}
      {schedule.upcomingExecutions.length > 0 && (
        <div className="bg-white p-6 rounded-lg border mb-6">
          <h2 className="text-lg font-semibold mb-4">Upcoming Executions</h2>
          <ul className="space-y-2">
            {schedule.upcomingExecutions.map((date, idx) => (
              <li key={idx} className="flex items-center gap-2">
                <span className="text-blue-600">•</span>
                <span>{format(new Date(date), 'MMM d, yyyy HH:mm')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Transaction History */}
      {schedule.transactions.length > 0 && (
        <div className="bg-white p-6 rounded-lg border">
          <h2 className="text-lg font-semibold mb-4">Transaction History</h2>
          <div className="space-y-3">
            {schedule.transactions.map((txn) => (
              <div
                key={txn.id}
                className="flex justify-between items-center p-3 bg-gray-50 rounded"
              >
                <div>
                  <p className="font-medium text-sm">Transaction #{txn.id.slice(-8)}</p>
                  <p className="text-xs text-gray-600">
                    {format(new Date(txn.createdAt), 'MMM d, yyyy HH:mm')}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium">${txn.amount.toFixed(2)}</p>
                  <p className="text-xs capitalize text-gray-600">{txn.status}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {schedule.notes && (
        <div className="bg-white p-6 rounded-lg border mt-6">
          <h2 className="text-lg font-semibold mb-4">Notes</h2>
          <p className="text-gray-700">{schedule.notes}</p>
        </div>
      )}
    </div>
  );
}
