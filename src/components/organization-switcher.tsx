'use client';

import { useState, useEffect } from 'react';
import { Check, ChevronsUpDown, PlusCircle, Building2, Settings2 } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Input, Label, toast } from '@topupsend/ui';
import { cn } from '@/lib/utils';

interface Organization {
  id: string;
  name: string;
  slug?: string;
  roles: string[];
  isActive: boolean;
  joinedAt: string;
  isCurrent: boolean;
}

export function OrganizationSwitcher() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [editOrgName, setEditOrgName] = useState('');
  const [editOrgSlug, setEditOrgSlug] = useState('');

  useEffect(() => {
    fetchOrganizations();
  }, []);

  const fetchOrganizations = async () => {
    try {
      const response = await fetch('/api/v1/organizations');
      if (response.ok) {
        const data = await response.json();
        console.log('Fetched organizations data:', data);
        // The API returns { organizations: [...] } directly
        const orgs = data?.organizations || [];
        console.log('Extracted organizations:', orgs);
        setOrganizations(orgs);
      } else {
        console.error('Failed to fetch organizations', response.status);
        setOrganizations([]);
      }
    } catch (error) {
      console.error('Failed to fetch organizations:', error);
      setOrganizations([]);
    } finally {
      setLoading(false);
    }
  };

  const switchOrganization = async (orgId: string) => {
    if (switching) return;

    setSwitching(true);
    try {
      const response = await fetch('/api/v1/organizations/switch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ orgId }),
      });

      if (response.ok) {
        setIsOpen(false);
        // Trigger storage event to notify other components
        localStorage.setItem('orgChanged', Date.now().toString());
        localStorage.removeItem('orgChanged');
        // Refresh the page
        window.location.reload();
      } else {
        const error = await response.json();
        console.error('Failed to switch organization:', error);
        alert('Failed to switch organization. Please try again.');
      }
    } catch (error) {
      console.error('Error switching organization:', error);
      alert('An error occurred. Please try again.');
    } finally {
      setSwitching(false);
    }
  };

  const createOrganization = async () => {
    if (!newOrgName.trim() || creating) return;

    setCreating(true);
    try {
      const response = await fetch('/api/v1/organizations/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newOrgName.trim(),
          switchToNew: true,
        }),
      });

      if (response.ok) {
        setShowCreateDialog(false);
        setNewOrgName('');
        // Refetch organizations to update the list
        await fetchOrganizations();
        // Trigger storage event to notify other components
        localStorage.setItem('orgChanged', Date.now().toString());
        localStorage.removeItem('orgChanged');
        // Reload the page to get new organization context
        window.location.reload();
      } else {
        const error = await response.json();
        console.error('Failed to create organization:', error);
        toast({
          title: 'Error',
          description: error.message || 'Failed to create organization. Please try again.',
          variant: 'error',
        });
      }
    } catch (error) {
      console.error('Error creating organization:', error);
      toast({
        title: 'Error',
        description: 'An error occurred. Please try again.',
        variant: 'error',
      });
    } finally {
      setCreating(false);
    }
  };

  const generateSlugFromName = (name: string): string => {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  const openEditDialog = (org: Organization, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingOrg(org);
    setEditOrgName(org.name || '');
    // If slug doesn't exist, generate one from the name
    setEditOrgSlug(org.slug || generateSlugFromName(org.name || ''));
    setIsOpen(false);
    setShowEditDialog(true);
  };

  const updateOrganization = async () => {
    if (!editOrgName?.trim() || !editOrgSlug?.trim() || !editingOrg || updating) return;

    setUpdating(true);
    try {
      const response = await fetch(`/api/v1/organizations/${editingOrg.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: editOrgName.trim(),
          slug: editOrgSlug.trim(),
        }),
      });

      if (response.ok) {
        setShowEditDialog(false);
        setEditingOrg(null);
        setEditOrgName('');
        setEditOrgSlug('');
        // Refetch organizations to update the list
        await fetchOrganizations();
        toast({
          title: 'Success',
          description: 'Organization updated successfully!',
          variant: 'success',
        });

        // If editing current org, reload to update context
        if (editingOrg.isCurrent) {
          window.location.reload();
        }
      } else {
        const error = await response.json();
        console.error('Failed to update organization:', error);
        toast({
          title: 'Error',
          description: error.message || 'Failed to update organization. Please try again.',
          variant: 'error',
        });
      }
    } catch (error) {
      console.error('Error updating organization:', error);
      toast({
        title: 'Error',
        description: 'An error occurred. Please try again.',
        variant: 'error',
      });
    } finally {
      setUpdating(false);
    }
  };

  const currentOrg = organizations.find((org) => org.isCurrent);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
          <Building2 className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-[120px]">
          <div className="h-4 w-32 bg-muted animate-pulse rounded" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          disabled={switching}
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
            "hover:bg-accent hover:text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            switching && "opacity-50 cursor-not-allowed"
          )}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Building2 className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 text-left min-w-[120px]">
            <p className="text-sm font-medium leading-none truncate">
              {currentOrg?.name || 'Select Organization'}
            </p>
            <p className="text-xs text-muted-foreground mt-1 truncate">
              {currentOrg?.roles.join(', ') || 'No organization'}
            </p>
          </div>
          <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
        </button>

        {/* Dropdown Menu */}
        {isOpen && !showCreateDialog && (
          <>
            <div
              className="fixed inset-0 z-[60]"
              onClick={() => setIsOpen(false)}
            />
            <div className="absolute right-0 top-full z-[70] mt-2 w-80 rounded-md border bg-popover text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95">
              <div className="p-1">
                {organizations.length === 0 ? (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                    No organizations found
                  </div>
                ) : (
                  <div className="max-h-[300px] overflow-y-auto">
                    {organizations.map((org) => (
                      <div
                        key={org.id}
                        className={cn(
                          "relative flex w-full items-center rounded-sm px-2 py-2 text-sm outline-none transition-colors group",
                          "hover:bg-accent hover:text-accent-foreground",
                          org.isCurrent && "bg-accent"
                        )}
                      >
                        <button
                          onClick={() => switchOrganization(org.id)}
                          disabled={switching || org.isCurrent}
                          className={cn(
                            "flex flex-1 items-center cursor-pointer",
                            (switching || org.isCurrent) && "opacity-50 cursor-default"
                          )}
                        >
                          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted mr-3">
                            <Building2 className="h-4 w-4" />
                          </div>
                          <div className="flex-1 text-left">
                            <p className="font-medium">{org.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {org.roles.join(', ')}
                            </p>
                          </div>
                          {org.isCurrent && (
                            <Check className="h-4 w-4 text-primary ml-2" />
                          )}
                        </button>
                        <button
                          onClick={(e) => openEditDialog(org, e)}
                          disabled={switching}
                          className={cn(
                            "p-1.5 rounded hover:bg-muted transition-colors opacity-0 group-hover:opacity-100",
                            switching && "cursor-not-allowed"
                          )}
                          title="Edit organization"
                        >
                          <Settings2 className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="border-t my-1" />

                <button
                  onClick={() => {
                    setIsOpen(false);
                    setShowCreateDialog(true);
                  }}
                  disabled={switching}
                  className={cn(
                    "relative flex w-full cursor-pointer items-center rounded-sm px-2 py-2 text-sm outline-none transition-colors",
                    "hover:bg-accent hover:text-accent-foreground",
                    "focus:bg-accent focus:text-accent-foreground",
                    "text-primary",
                    switching && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <PlusCircle className="h-4 w-4 mr-2" />
                  Create Organization
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Create Organization Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Organization</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="orgName">Organization Name</Label>
              <Input
                id="orgName"
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    createOrganization();
                  } else if (e.key === 'Escape' && !creating) {
                    setShowCreateDialog(false);
                  }
                }}
                disabled={creating}
                placeholder="Acme Inc."
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              onClick={createOrganization}
              disabled={!newOrgName.trim() || creating}
            >
              {creating && (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent mr-2" />
              )}
              {creating ? 'Creating...' : 'Create & Switch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Organization Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Organization</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="editOrgName">Organization Name</Label>
              <Input
                id="editOrgName"
                value={editOrgName}
                onChange={(e) => setEditOrgName(e.target.value)}
                disabled={updating}
                placeholder="Acme Inc."
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editOrgSlug">Organization Slug</Label>
              <Input
                id="editOrgSlug"
                value={editOrgSlug}
                onChange={(e) => setEditOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                disabled={updating}
                placeholder="acme-inc"
              />
              <p className="text-xs text-muted-foreground">
                This will be used in your storefront URL: /store/{editOrgSlug || 'your-slug'}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowEditDialog(false);
                setEditingOrg(null);
                setEditOrgName('');
                setEditOrgSlug('');
              }}
              disabled={updating}
            >
              Cancel
            </Button>
            <Button
              onClick={updateOrganization}
              disabled={!editOrgName?.trim() || !editOrgSlug?.trim() || updating}
            >
              {updating && (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent mr-2" />
              )}
              {updating ? 'Updating...' : 'Update Organization'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
