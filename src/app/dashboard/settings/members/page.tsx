'use client';

import { useState, useEffect } from 'react';
import { UserRole } from '@topupsend/types';
import { DollarSign, RotateCcw } from 'lucide-react';
import { toast } from '@topupsend/ui';
import { DashboardLayout } from '@/components/dashboard-layout';

interface Member {
  id: string;
  user: {
    id: string;
    email: string;
    isActive: boolean;
  };
  roles: UserRole[];
  joinedAt: string;
  invitedBy: {
    id: string;
    email: string;
  } | null;
  invitedAt?: string;
  balanceLimit?: {
    enabled: boolean;
    maxBalance: number;
    currentUsed: number;
  };
}

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRoles, setInviteRoles] = useState<UserRole[]>([UserRole.VIEWER]);
  const [inviting, setInviting] = useState(false);

  // Balance limit management state
  const [showBalanceDialog, setShowBalanceDialog] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [balanceEnabled, setBalanceEnabled] = useState(false);
  const [maxBalance, setMaxBalance] = useState('');
  const [savingBalance, setSavingBalance] = useState(false);

  useEffect(() => {
    fetchMembers();
  }, []);

  const fetchMembers = async () => {
    try {
      const response = await fetch('/api/v1/organizations/members');
      if (response.ok) {
        const data = await response.json();
        setMembers(data.data.members);
      }
    } catch (_error) {
      console.error('Failed to fetch members:', _error);
    } finally {
      setLoading(false);
    }
  };

  const inviteUser = async () => {
    if (!inviteEmail.trim() || inviting) return;

    setInviting(true);
    try {
      const response = await fetch('/api/v1/organizations/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          roles: inviteRoles,
        }),
      });

      if (response.ok) {
        setShowInviteDialog(false);
        setInviteEmail('');
        setInviteRoles([UserRole.VIEWER]);
        fetchMembers(); // Refresh the list
        toast({
          title: 'Success',
          description: 'User invited successfully!',
          variant: 'success',
        });
      } else {
        const error = await response.json();
        toast({
          title: 'Error',
          description: error.message || 'Failed to invite user. Please try again.',
          variant: 'error',
        });
      }
    } catch (_error) {
      console.error('Error inviting user:', _error);
      toast({
        title: 'Error',
        description: 'An error occurred. Please try again.',
        variant: 'error',
      });
    } finally {
      setInviting(false);
    }
  };

  const toggleRole = (role: UserRole) => {
    if (inviteRoles.includes(role)) {
      setInviteRoles(inviteRoles.filter((r) => r !== role));
    } else {
      setInviteRoles([...inviteRoles, role]);
    }
  };

  const openBalanceDialog = (member: Member) => {
    setSelectedMember(member);
    setBalanceEnabled(member.balanceLimit?.enabled || false);
    setMaxBalance(member.balanceLimit?.maxBalance?.toString() || '');
    setShowBalanceDialog(true);
  };

  const saveBalanceLimit = async () => {
    if (!selectedMember || savingBalance) return;

    // Validate input
    if (balanceEnabled && (!maxBalance || parseFloat(maxBalance) <= 0)) {
      toast({
        title: 'Invalid Amount',
        description: 'Please enter a valid balance limit greater than 0',
        variant: 'error',
      });
      return;
    }

    setSavingBalance(true);
    try {
      const response = await fetch(`/api/v1/organizations/members/${selectedMember.id}/balance`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enabled: balanceEnabled,
          maxBalance: balanceEnabled ? parseFloat(maxBalance) : 0,
        }),
      });

      if (response.ok) {
        setShowBalanceDialog(false);
        fetchMembers(); // Refresh the list
        toast({
          title: 'Success',
          description: 'Balance limit updated successfully',
          variant: 'success',
        });
      } else {
        const error = await response.json();
        toast({
          title: 'Error',
          description: error.detail || error.error || 'Failed to update balance limit',
          variant: 'error',
        });
      }
    } catch (_error) {
      console.error('Error updating balance limit:', _error);
      toast({
        title: 'Error',
        description: 'An error occurred. Please try again.',
        variant: 'error',
      });
    } finally {
      setSavingBalance(false);
    }
  };

  const resetBalance = async (member: Member) => {
    if (!confirm('Are you sure you want to reset this member\'s used balance to zero?')) {
      return;
    }

    try {
      const response = await fetch(`/api/v1/organizations/members/${member.id}/balance`, {
        method: 'POST',
      });

      if (response.ok) {
        fetchMembers(); // Refresh the list
        toast({
          title: 'Success',
          description: 'Balance reset successfully',
          variant: 'success',
        });
      } else {
        const error = await response.json();
        toast({
          title: 'Error',
          description: error.detail || error.error || 'Failed to reset balance',
          variant: 'error',
        });
      }
    } catch (_error) {
      console.error('Error resetting balance:', _error);
      toast({
        title: 'Error',
        description: 'An error occurred. Please try again.',
        variant: 'error',
      });
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Organization Members</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage who has access to your organization
          </p>
        </div>
        <button
          onClick={() => setShowInviteDialog(true)}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
        >
          Invite Member
        </button>
      </div>

      <div className="bg-white rounded-lg border">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Roles
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Balance Limit
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Joined
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {members.map((member) => {
                const isAdmin = member.roles.includes(UserRole.ADMIN);
                const hasBalanceLimit = member.balanceLimit?.enabled;
                const available = hasBalanceLimit
                  ? (member.balanceLimit!.maxBalance - member.balanceLimit!.currentUsed)
                  : 0;
                const percentUsed = hasBalanceLimit
                  ? Math.round((member.balanceLimit!.currentUsed / member.balanceLimit!.maxBalance) * 100)
                  : 0;

                return (
                  <tr key={member.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {member.user.email}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex gap-1">
                        {member.roles.map((role) => (
                          <span
                            key={role}
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              role === UserRole.ADMIN
                                ? 'bg-purple-100 text-purple-800'
                                : role === UserRole.OPERATOR
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {role}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {isAdmin ? (
                        <span className="text-xs text-gray-500">Unlimited</span>
                      ) : hasBalanceLimit ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">
                              ${available.toFixed(2)} / ${member.balanceLimit!.maxBalance.toFixed(2)}
                            </span>
                          </div>
                          <div className="w-32">
                            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className={`h-full transition-all ${
                                  percentUsed >= 90
                                    ? 'bg-red-500'
                                    : percentUsed >= 75
                                    ? 'bg-yellow-500'
                                    : 'bg-green-500'
                                }`}
                                style={{ width: `${Math.min(percentUsed, 100)}%` }}
                              />
                            </div>
                          </div>
                          <span className="text-xs text-gray-500">
                            {percentUsed}% used
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-500">No limit set</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(member.joinedAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          member.user.isActive
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {member.user.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {!isAdmin && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openBalanceDialog(member)}
                            className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 transition-colors"
                          >
                            <DollarSign className="h-4 w-4" />
                            Manage
                          </button>
                          {hasBalanceLimit && member.balanceLimit!.currentUsed > 0 && (
                            <button
                              onClick={() => resetBalance(member)}
                              className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-800 transition-colors"
                              title="Reset used balance to zero"
                            >
                              <RotateCcw className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite Dialog */}
      {showInviteDialog && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50"
            onClick={() => !inviting && setShowInviteDialog(false)}
          />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-white p-6 shadow-lg">
            <h2 className="text-lg font-semibold mb-4">Invite User to Organization</h2>
            <div className="space-y-4">
              <div>
                <label htmlFor="inviteEmail" className="block text-sm font-medium text-gray-700 mb-2">
                  Email Address
                </label>
                <input
                  id="inviteEmail"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  disabled={inviting}
                  placeholder="user@example.com"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  autoFocus
                />
                <p className="text-xs text-gray-500 mt-1">
                  User must already have an account to be invited
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Roles
                </label>
                <div className="space-y-2">
                  {Object.values(UserRole).map((role) => (
                    <label key={role} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={inviteRoles.includes(role)}
                        onChange={() => toggleRole(role)}
                        disabled={inviting}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700 capitalize">{role}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-6">
              <button
                onClick={() => setShowInviteDialog(false)}
                disabled={inviting}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={inviteUser}
                disabled={!inviteEmail.trim() || inviteRoles.length === 0 || inviting}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {inviting && (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                )}
                {inviting ? 'Inviting...' : 'Invite User'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Balance Limit Dialog */}
      {showBalanceDialog && selectedMember && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50"
            onClick={() => !savingBalance && setShowBalanceDialog(false)}
          />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-white p-6 shadow-lg">
            <h2 className="text-lg font-semibold mb-4">Manage Balance Limit</h2>
            <p className="text-sm text-gray-600 mb-4">
              Set a spending limit for {selectedMember.user.email}
            </p>

            <div className="space-y-4">
              {/* Current Usage Display */}
              {selectedMember.balanceLimit?.enabled && (
                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium text-gray-700">Current Usage</span>
                    <span className="text-sm font-bold text-gray-900">
                      ${selectedMember.balanceLimit.currentUsed.toFixed(2)} / ${selectedMember.balanceLimit.maxBalance.toFixed(2)}
                    </span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all"
                      style={{
                        width: `${Math.min(
                          (selectedMember.balanceLimit.currentUsed / selectedMember.balanceLimit.maxBalance) * 100,
                          100
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Enable/Disable Toggle */}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={balanceEnabled}
                  onChange={(e) => setBalanceEnabled(e.target.checked)}
                  disabled={savingBalance}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-700">Enable balance limit</span>
              </label>

              {/* Max Balance Input */}
              {balanceEnabled && (
                <div>
                  <label htmlFor="maxBalance" className="block text-sm font-medium text-gray-700 mb-2">
                    Maximum Balance Limit ($)
                  </label>
                  <input
                    id="maxBalance"
                    type="number"
                    min="0"
                    step="0.01"
                    value={maxBalance}
                    onChange={(e) => setMaxBalance(e.target.value)}
                    disabled={savingBalance}
                    placeholder="0.00"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    autoFocus
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Team member can spend up to this amount
                  </p>
                </div>
              )}

              {/* Warning Message */}
              {balanceEnabled && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-xs text-yellow-800">
                    <strong>Note:</strong> This limit only applies to preview mode transactions. Admins have unlimited access.
                  </p>
                </div>
              )}
            </div>

            <div className="flex gap-2 justify-end mt-6">
              <button
                onClick={() => setShowBalanceDialog(false)}
                disabled={savingBalance}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={saveBalanceLimit}
                disabled={savingBalance || (balanceEnabled && !maxBalance)}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {savingBalance && (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                )}
                {savingBalance ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </>
      )}
      </div>
    </DashboardLayout>
  );
}
