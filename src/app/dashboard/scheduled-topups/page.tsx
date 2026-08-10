'use client';

/**
 * Scheduled Top-ups List Page
 * Displays all scheduled top-ups with filtering and actions
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@topupsend/ui';
import { ScheduleTopupForm } from '@/components/scheduled-topups/schedule-form';
import type { ScheduledTopupsListResponse } from '@/types/scheduled-topups';
import { format } from 'date-fns';

export default function ScheduledTopupsPage() {
  const router = useRouter();
  const [schedules, setSchedules] = useState<ScheduledTopupsListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    fetchSchedules();
  }, [statusFilter]);

  const fetchSchedules = async () => {
    try {
      setIsLoading(true);
      const params = new URLSearchParams();
      if (statusFilter !== 'all') {
        params.append('status', statusFilter);
      }

      const response = await fetch(`/api/v1/scheduled-topups?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch schedules');
      }

      setSchedules(data.data);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePause = async (scheduleId: string) => {
    try {
      const response = await fetch(`/api/v1/scheduled-topups/${scheduleId}/pause`, {
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

      fetchSchedules();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'error',
      });
    }
  };

  const handleResume = async (scheduleId: string) => {
    try {
      const response = await fetch(`/api/v1/scheduled-topups/${scheduleId}/resume`, {
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

      fetchSchedules();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'error',
      });
    }
  };

  const handleCancel = async (scheduleId: string) => {
    if (!confirm('Are you sure you want to cancel this schedule?')) {
      return;
    }

    try {
      const response = await fetch(`/api/v1/scheduled-topups/${scheduleId}`, {
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

      fetchSchedules();
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
        className={`px-2 py-1 rounded-full text-xs font-semibold ${
          colors[status] || 'bg-gray-100 text-gray-800'
        }`}
      >
        {status}
      </span>
    );
  };

  if (showCreateForm) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">Create Scheduled Top-up</h1>
        <ScheduleTopupForm
          onSuccess={() => {
            setShowCreateForm(false);
            fetchSchedules();
          }}
          onCancel={() => setShowCreateForm(false)}
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Scheduled Top-ups</h1>
        <button
          onClick={() => setShowCreateForm(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          + New Schedule
        </button>
      </div>

      {/* Filters */}
      <div className="mb-6 flex gap-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border rounded-md"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Schedules Table */}
      {isLoading ? (
        <div className="text-center py-12">Loading schedules...</div>
      ) : schedules && schedules.schedules.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full bg-white border rounded-lg">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Phone Number
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Product
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Next Execution
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Recurrence
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Executions
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {schedules.schedules.map((schedule) => (
                <tr key={schedule.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">{schedule.phoneNumber}</td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium">{schedule.product.snapshot.name}</div>
                    <div className="text-xs text-gray-500">
                      ${schedule.estimatedCost.toFixed(2)}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {schedule.nextExecutionAt
                      ? format(new Date(schedule.nextExecutionAt), 'MMM d, yyyy HH:mm')
                      : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {schedule.recurrence.enabled ? (
                      <span className="text-sm capitalize">{schedule.recurrence.type}</span>
                    ) : (
                      <span className="text-sm text-gray-500">One-time</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(schedule.status)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {schedule.executionCount}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                    <button
                      onClick={() => router.push(`/dashboard/scheduled-topups/${schedule.id}`)}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      View
                    </button>
                    {schedule.status === 'active' && (
                      <button
                        onClick={() => handlePause(schedule.id)}
                        className="text-yellow-600 hover:text-yellow-800"
                      >
                        Pause
                      </button>
                    )}
                    {schedule.status === 'paused' && (
                      <button
                        onClick={() => handleResume(schedule.id)}
                        className="text-green-600 hover:text-green-800"
                      >
                        Resume
                      </button>
                    )}
                    {(schedule.status === 'active' || schedule.status === 'paused') && (
                      <button
                        onClick={() => handleCancel(schedule.id)}
                        className="text-red-600 hover:text-red-800"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {schedules.pagination.totalPages > 1 && (
            <div className="mt-4 flex justify-center gap-2">
              <span className="text-sm text-gray-600">
                Page {schedules.pagination.page} of {schedules.pagination.totalPages}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <p className="text-gray-600 mb-4">No scheduled top-ups found</p>
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Create Your First Schedule
          </button>
        </div>
      )}
    </div>
  );
}
