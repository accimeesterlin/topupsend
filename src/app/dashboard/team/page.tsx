'use client';

import { useState, useEffect } from 'react';
import { UserPlus, Mail, Shield, Eye, Trash2, Edit2, Users as UsersIcon, Crown, AlertCircle, Settings, BarChart3, Store, DollarSign, Tag, Globe, ShoppingCart, CreditCard, Plug, Wallet, Copy, Search } from 'lucide-react';
import { Button, Card, CardContent, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, toast } from '@topupsend/ui';
import { DashboardLayout } from '@/components/dashboard-layout';

// Permission categories with descriptions
const permissionCategories = [
  {
    name: 'Dashboard & Analytics',
    icon: BarChart3,
    permissions: [
      { value: 'view_dashboard', label: 'View Dashboard' },
      { value: 'view_analytics', label: 'View Analytics' },
    ]
  },
  {
    name: 'Storefront',
    icon: Store,
    permissions: [
      { value: 'view_storefront_settings', label: 'View Settings' },
      { value: 'edit_storefront_settings', label: 'Edit Settings' },
    ]
  },
  {
    name: 'Products & Pricing',
    icon: DollarSign,
    permissions: [
      { value: 'view_products', label: 'View Products' },
      { value: 'edit_products', label: 'Edit Products' },
      { value: 'sync_products', label: 'Sync Products' },
      { value: 'view_pricing', label: 'View Pricing' },
      { value: 'edit_pricing', label: 'Edit Pricing' },
    ]
  },
  {
    name: 'Discounts',
    icon: Tag,
    permissions: [
      { value: 'view_discounts', label: 'View' },
      { value: 'create_discounts', label: 'Create' },
      { value: 'edit_discounts', label: 'Edit' },
      { value: 'delete_discounts', label: 'Delete' },
    ]
  },
  {
    name: 'Countries',
    icon: Globe,
    permissions: [
      { value: 'view_countries', label: 'View' },
      { value: 'edit_countries', label: 'Edit' },
    ]
  },
  {
    name: 'Transactions',
    icon: ShoppingCart,
    permissions: [
      { value: 'view_transactions', label: 'View' },
      { value: 'process_transactions', label: 'Process' },
      { value: 'refund_transactions', label: 'Refund' },
    ]
  },
  {
    name: 'Customers',
    icon: UsersIcon,
    permissions: [
      { value: 'view_customers', label: 'View' },
      { value: 'edit_customers', label: 'Edit' },
    ]
  },
  {
    name: 'Team',
    icon: UsersIcon,
    permissions: [
      { value: 'view_team', label: 'View' },
      { value: 'invite_team', label: 'Invite' },
      { value: 'edit_team', label: 'Edit' },
      { value: 'remove_team', label: 'Remove' },
    ]
  },
  {
    name: 'Integrations',
    icon: Plug,
    permissions: [
      { value: 'view_integrations', label: 'View' },
      { value: 'edit_integrations', label: 'Edit' },
    ]
  },
  {
    name: 'Payment Settings',
    icon: CreditCard,
    permissions: [
      { value: 'view_payment_settings', label: 'View' },
      { value: 'edit_payment_settings', label: 'Edit' },
    ]
  },
  {
    name: 'Wallet',
    icon: Wallet,
    permissions: [
      { value: 'view_wallet', label: 'View' },
      { value: 'deposit_wallet', label: 'Deposit' },
      { value: 'edit_wallet_settings', label: 'Edit Settings' },
    ]
  },
  {
    name: 'Organization',
    icon: Settings,
    permissions: [
      { value: 'view_org_settings', label: 'View Settings' },
      { value: 'edit_org_settings', label: 'Edit Settings' },
    ]
  },
];

interface TeamMember {
  id: string;
  user: {
    id: string;
    email: string;
    isActive: boolean;
  };
  roles: string[];
  customPermissions?: string[];
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

export default function TeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRoles, setInviteRoles] = useState<string[]>(['viewer']);
  const [isInviting, setIsInviting] = useState(false);
  const [editRoles, setEditRoles] = useState<string[]>([]);
  const [editCustomPermissions, setEditCustomPermissions] = useState<string[]>([]);
  const [useCustomPermissions, setUseCustomPermissions] = useState(false);
  const [editBalanceLimitEnabled, setEditBalanceLimitEnabled] = useState(false);
  const [editBalanceLimitMax, setEditBalanceLimitMax] = useState('0');
  const [isUpdating, setIsUpdating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchMembers();
  }, []);

  const fetchMembers = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/v1/organizations/members');
      const data = await response.json();

      if (response.ok) {
        setMembers(data.members || []);
      } else {
        toast({
          title: 'Error',
          description: data.detail || 'Failed to load team members',
          variant: 'error',
        });
      }
    } catch (_error) {
      console.error('Failed to fetch members:', _error);
      toast({
        title: 'Error',
        description: 'Failed to load team members',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter an email address',
        variant: 'error',
      });
      return;
    }

    setIsInviting(true);
    try {
      const response = await fetch('/api/v1/organizations/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          roles: inviteRoles,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        toast({
          title: 'Success',
          description: `Successfully invited ${inviteEmail}`,
          variant: 'success',
        });
        setShowInviteModal(false);
        setInviteEmail('');
        setInviteRoles(['viewer']);
        fetchMembers();
      } else {
        toast({
          title: 'Error',
          description: data.detail || 'Failed to invite team member',
          variant: 'error',
        });
      }
    } catch (_error) {
      console.error('Failed to invite member:', _error);
      toast({
        title: 'Error',
        description: 'Failed to invite team member',
        variant: 'error',
      });
    } finally {
      setIsInviting(false);
    }
  };

  const handleEditMember = (member: TeamMember) => {
    setSelectedMember(member);
    setEditRoles(member.roles);
    setEditCustomPermissions(member.customPermissions || []);
    setUseCustomPermissions((member.customPermissions && member.customPermissions.length > 0) || false);
    setEditBalanceLimitEnabled(member.balanceLimit?.enabled || false);
    setEditBalanceLimitMax(member.balanceLimit?.maxBalance?.toString() || '0');
    setShowEditModal(true);
  };

  const handleUpdateMember = async () => {
    if (!selectedMember) return;

    setIsUpdating(true);
    try {
      const response = await fetch(`/api/v1/organizations/members/${selectedMember.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roles: editRoles,
          customPermissions: useCustomPermissions ? editCustomPermissions : [],
          balanceLimit: {
            enabled: editBalanceLimitEnabled,
            maxBalance: parseFloat(editBalanceLimitMax) || 0,
          },
        }),
      });

      const data = await response.json();

      if (response.ok) {
        toast({
          title: 'Success',
          description: 'Team member updated successfully',
          variant: 'success',
        });
        setShowEditModal(false);
        setSelectedMember(null);
        fetchMembers();
      } else {
        toast({
          title: 'Error',
          description: data.detail || 'Failed to update team member',
          variant: 'error',
        });
      }
    } catch (_error) {
      console.error('Failed to update member:', _error);
      toast({
        title: 'Error',
        description: 'Failed to update team member',
        variant: 'error',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleRemoveMember = async (member: TeamMember) => {
    if (!confirm(`Are you sure you want to remove ${member.user.email} from the team?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/v1/organizations/members/${member.id}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (response.ok) {
        toast({
          title: 'Success',
          description: 'Team member removed successfully',
          variant: 'success',
        });
        fetchMembers();
      } else {
        toast({
          title: 'Error',
          description: data.detail || 'Failed to remove team member',
          variant: 'error',
        });
      }
    } catch (_error) {
      console.error('Failed to remove member:', _error);
      toast({
        title: 'Error',
        description: 'Failed to remove team member',
        variant: 'error',
      });
    }
  };

  const toggleRole = (roles: string[], setRoles: (roles: string[]) => void, role: string) => {
    if (roles.includes(role)) {
      const newRoles = roles.filter(r => r !== role);
      if (newRoles.length > 0) {
        setRoles(newRoles);
      }
    } else {
      setRoles([...roles, role]);
    }
  };

  const togglePermission = (permission: string) => {
    if (editCustomPermissions.includes(permission)) {
      setEditCustomPermissions(editCustomPermissions.filter(p => p !== permission));
    } else {
      setEditCustomPermissions([...editCustomPermissions, permission]);
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'operator':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'viewer':
        return 'bg-gray-100 text-gray-800 border-gray-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'admin':
        return Crown;
      case 'operator':
        return Shield;
      case 'viewer':
        return Eye;
      default:
        return Shield;
    }
  };

  const copyInviteLink = async (email: string) => {
    const baseUrl = window.location.origin;
    const inviteLink = `${baseUrl}/signup?email=${encodeURIComponent(email)}`;
    
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast({
        title: 'Success',
        description: 'Invite link copied to clipboard',
        variant: 'success',
      });
    } catch (_error) {
      toast({
        title: 'Error',
        description: 'Failed to copy invite link',
        variant: 'error',
      });
    }
  };

  const filteredMembers = members.filter((member) =>
    member.user.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading team members...</p>
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
            <h1 className="text-3xl font-bold tracking-tight">Team Members</h1>
            <p className="text-muted-foreground mt-1">
              Manage your team members and their permissions
            </p>
          </div>
          <Button onClick={() => setShowInviteModal(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Invite Member
          </Button>
        </div>

        {/* Search Bar */}
        {members.length > 0 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}

        {/* Team Members List */}
        {filteredMembers.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <UsersIcon className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">
                {members.length === 0 ? 'No team members yet' : 'No team members found'}
              </h3>
              <p className="text-muted-foreground text-center max-w-md mb-4">
                {members.length === 0
                  ? 'Invite team members to help you manage your storefront and transactions.'
                  : 'Try adjusting your search query.'}
              </p>
              {members.length === 0 && (
                <Button onClick={() => setShowInviteModal(true)}>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Invite Your First Member
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {filteredMembers.map((member) => (
              <Card key={member.id}>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4 flex-1">
                      <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Mail className="h-6 w-6 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-semibold truncate">{member.user.email}</h3>
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          {member.roles.map((role) => {
                            const Icon = getRoleIcon(role);
                            return (
                              <span
                                key={role}
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border ${getRoleBadgeColor(role)}`}
                              >
                                <Icon className="h-3 w-3" />
                                {role.charAt(0).toUpperCase() + role.slice(1)}
                              </span>
                            );
                          })}
                        </div>
                        <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                          <p>Joined: {new Date(member.joinedAt).toLocaleDateString()}</p>
                          {member.invitedBy && (
                            <p>Invited by: {member.invitedBy.email}</p>
                          )}
                          {member.balanceLimit?.enabled && (
                            <p className="flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" />
                              Balance Limit: ${member.balanceLimit.currentUsed.toFixed(2)} / ${member.balanceLimit.maxBalance.toFixed(2)}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyInviteLink(member.user.email)}
                        title="Copy invite link"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEditMember(member)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRemoveMember(member)}
                        className="text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Invite Member Modal */}
      <Dialog open={showInviteModal} onOpenChange={setShowInviteModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
            <DialogDescription>
              Invite a user to join your organization. If they don't have an account, one will be created for them.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Email Address <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                placeholder="user@example.com"
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                disabled={isInviting}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Roles <span className="text-red-500">*</span>
              </label>
              <div className="space-y-2">
                {['admin', 'operator', 'viewer'].map((role) => {
                  const Icon = getRoleIcon(role);
                  return (
                    <label
                      key={role}
                      className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-muted transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={inviteRoles.includes(role)}
                        onChange={() => toggleRole(inviteRoles, setInviteRoles, role)}
                        disabled={isInviting}
                        className="h-4 w-4 text-primary focus:ring-primary"
                      />
                      <Icon className="h-5 w-5 text-muted-foreground" />
                      <div className="flex-1">
                        <div className="font-medium">
                          {role.charAt(0).toUpperCase() + role.slice(1)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {role === 'admin' && 'Full access to all features'}
                          {role === 'operator' && 'Can manage transactions and customers'}
                          {role === 'viewer' && 'View-only access to reports'}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowInviteModal(false)}
              disabled={isInviting}
            >
              Cancel
            </Button>
            <Button onClick={handleInvite} disabled={isInviting || !inviteEmail.trim()}>
              {isInviting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
                  Inviting...
                </>
              ) : (
                'Send Invite'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Member Modal */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Team Member</DialogTitle>
            <DialogDescription>
              Update roles and balance limits for {selectedMember?.user.email}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Roles <span className="text-red-500">*</span>
              </label>
              <div className="space-y-2">
                {['admin', 'operator', 'viewer'].map((role) => {
                  const Icon = getRoleIcon(role);
                  return (
                    <label
                      key={role}
                      className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-muted transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={editRoles.includes(role)}
                        onChange={() => toggleRole(editRoles, setEditRoles, role)}
                        disabled={isUpdating}
                        className="h-4 w-4 text-primary focus:ring-primary"
                      />
                      <Icon className="h-5 w-5 text-muted-foreground" />
                      <div className="flex-1">
                        <div className="font-medium">
                          {role.charAt(0).toUpperCase() + role.slice(1)}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Custom Permissions Section */}
            <div className="border-t pt-4">
              <label className="flex items-center gap-2 mb-3">
                <input
                  type="checkbox"
                  checked={useCustomPermissions}
                  onChange={(e) => setUseCustomPermissions(e.target.checked)}
                  disabled={isUpdating}
                  className="h-4 w-4 text-primary focus:ring-primary"
                />
                <span className="text-sm font-medium">Use Custom Permissions</span>
              </label>
              <p className="text-xs text-muted-foreground mb-3">
                {useCustomPermissions
                  ? 'Select specific permissions instead of role-based permissions'
                  : 'Using role-based permissions (change roles above to grant permissions)'}
              </p>

              {useCustomPermissions && (
                <div className="max-h-[400px] overflow-y-auto border rounded-lg p-3 space-y-4">
                  {permissionCategories.map((category) => {
                    const CategoryIcon = category.icon;
                    return (
                      <div key={category.name}>
                        <div className="flex items-center gap-2 mb-2">
                          <CategoryIcon className="h-4 w-4 text-muted-foreground" />
                          <h4 className="font-medium text-sm">{category.name}</h4>
                        </div>
                        <div className="grid grid-cols-2 gap-2 ml-6">
                          {category.permissions.map((perm) => (
                            <label
                              key={perm.value}
                              className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted p-2 rounded transition-colors"
                            >
                              <input
                                type="checkbox"
                                checked={editCustomPermissions.includes(perm.value)}
                                onChange={() => togglePermission(perm.value)}
                                disabled={isUpdating}
                                className="h-3 w-3 text-primary focus:ring-primary"
                              />
                              <span className="text-xs">{perm.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <label className="flex items-center gap-2 mb-2">
                <input
                  type="checkbox"
                  checked={editBalanceLimitEnabled}
                  onChange={(e) => setEditBalanceLimitEnabled(e.target.checked)}
                  disabled={isUpdating}
                  className="h-4 w-4 text-primary focus:ring-primary"
                />
                <span className="text-sm font-medium">Enable Balance Limit</span>
              </label>
              {editBalanceLimitEnabled && (
                <div>
                  <label className="block text-sm text-muted-foreground mb-2">
                    Maximum Balance
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="w-full pl-7 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                      value={editBalanceLimitMax}
                      onChange={(e) => setEditBalanceLimitMax(e.target.value)}
                      disabled={isUpdating}
                      placeholder="0.00"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Current usage: ${selectedMember?.balanceLimit?.currentUsed.toFixed(2) || '0.00'}
                  </p>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowEditModal(false)}
              disabled={isUpdating}
            >
              Cancel
            </Button>
            <Button onClick={handleUpdateMember} disabled={isUpdating}>
              {isUpdating ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
                  Updating...
                </>
              ) : (
                'Update Member'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
