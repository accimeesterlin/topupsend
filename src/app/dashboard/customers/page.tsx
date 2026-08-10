'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Search,
  User,
  Phone,
  MapPin,
  Edit2,
  MoreVertical,
  Star,
  StarOff,
  Users,
  Grid3x3,
  List,
  Link2,
  Folder,
  X,
  Filter,
  Check,
  Copy,
  GitMerge,
  Sparkles,
  Pencil,
} from 'lucide-react';

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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Badge,
  toast,
} from '@topupsend/ui';
import { DashboardLayout } from '@/components/dashboard-layout';
import { WhatsAppButton } from '@/components/whatsapp-button';
import type { DuplicateGroup, FindDuplicatesResponse } from '@/types/find-duplicates';

interface Customer {
  _id: string;
  phoneNumber: string;
  email?: string;
  name?: string;
  country?: string;
  isFavorite: boolean;
  groups: string[];
  metadata: {
    totalPurchases: number;
    totalSpent: number;
    currency: string;
  };
  createdAt: string;
}

interface CustomerGroup {
  _id: string;
  name: string;
  description?: string;
  color: string;
  customerCount: number;
}

interface NameGuess {
  customerId: string;
  email: string;
  phoneNumber: string;
  currentName: string | null;
  guessedName: string | null;
  confidence: number;
  decision: 'autofill' | 'suggest' | 'blank';
  reason: string;
}

type ViewMode = 'grid' | 'list';

export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showAddToGroupModal, setShowAddToGroupModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [orgSlug, setOrgSlug] = useState<string>('');

  const [formData, setFormData] = useState({
    phoneNumber: '',
    email: '',
    name: '',
    country: '',
  });

  const [editFormData, setEditFormData] = useState({
    phoneNumber: '',
    email: '',
    name: '',
    country: '',
  });

  const [groupFormData, setGroupFormData] = useState({
    name: '',
    description: '',
    color: '#3b82f6',
  });

  const [saving, setSaving] = useState(false);
  const [mergeMode, setMergeMode] = useState(false);
  const [primaryCustomer, setPrimaryCustomer] = useState<Customer | null>(null);
  const [selectedDuplicates, setSelectedDuplicates] = useState<string[]>([]);
  const [showMergeConfirmModal, setShowMergeConfirmModal] = useState(false);
  const [merging, setMerging] = useState(false);
  const [showGuessNamesModal, setShowGuessNamesModal] = useState(false);
  const [guessing, setGuessing] = useState(false);
  const [nameGuesses, setNameGuesses] = useState<NameGuess[]>([]);
  const [editedNames, setEditedNames] = useState<Record<string, string>>({});
  const [editingGuessId, setEditingGuessId] = useState<string | null>(null);
  const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set());
  const [showFindDuplicatesModal, setShowFindDuplicatesModal] = useState(false);
  const [findingDuplicates, setFindingDuplicates] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [duplicateSummary, setDuplicateSummary] = useState({ totalGroups: 0, totalDuplicateCustomers: 0 });
  const [mergeGroupCustomers, setMergeGroupCustomers] = useState<Customer[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });

  useEffect(() => {
    fetchOrgSlug();
    fetchGroups();
  }, []);

  // Debounce search input - wait 300ms after user stops typing
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentPage(1);
    }, 300);
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [search]);

  useEffect(() => {
    fetchCustomers();
  }, [debouncedSearch, selectedFilter, selectedGroup, currentPage, pageSize]);

  const fetchOrgSlug = async () => {
    try {
      const response = await fetch('/api/v1/organizations');
      if (response.ok) {
        const data = await response.json();
        const currentOrg = data.organizations?.find((org: any) => org.isCurrent);
        if (currentOrg) {
          setOrgSlug(currentOrg.slug);
        }
      }
    } catch (error) {
      console.error('Failed to fetch organization slug:', error);
    }
  };

  const fetchGroups = async () => {
    try {
      const response = await fetch('/api/v1/customer-groups');
      if (response.ok) {
        const data = await response.json();
        setGroups(data);
      }
    } catch (error) {
      console.error('Failed to fetch groups:', error);
    }
  };

  const fetchCustomers = async () => {
    try {
      const params = new URLSearchParams();
      params.append('page', currentPage.toString());
      params.append('limit', pageSize.toString());

      if (debouncedSearch) params.append('search', debouncedSearch);
      if (selectedFilter === 'favorites') params.append('favorites', 'true');
      if (selectedGroup) params.append('groupId', selectedGroup);

      const response = await fetch(`/api/v1/customers?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setCustomers(data.customers || []);
        setPagination(
          data.pagination || { page: 1, limit: 10, total: 0, totalPages: 0 },
        );
      }
    } catch (error) {
      console.error('Failed to fetch customers:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    setSaving(true);

    try {
      const response = await fetch('/api/v1/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        toast({
          title: 'Success',
          description: 'Customer created successfully!',
          variant: 'success',
        });
        await fetchCustomers();
        setShowCreateModal(false);
        setFormData({ phoneNumber: '', email: '', name: '', country: '' });
      } else {
        const error = await response.json();
        toast({
          title: 'Error',
          description: error.error || 'Failed to create customer',
          variant: 'error',
        });
      }
    } catch (_error) {
      toast({
        title: 'Error',
        description: 'Failed to create customer',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    setEditFormData({
      phoneNumber: customer.phoneNumber,
      email: customer.email || '',
      name: customer.name || '',
      country: customer.country || '',
    });
    setShowEditModal(true);
  };

  const handleUpdate = async () => {
    if (!editingCustomer) return;

    setSaving(true);

    try {
      const response = await fetch(`/api/v1/customers/${editingCustomer._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editFormData),
      });

      if (response.ok) {
        toast({
          title: 'Success',
          description: 'Customer updated successfully!',
          variant: 'success',
        });
        await fetchCustomers();
        setShowEditModal(false);
        setEditingCustomer(null);
        setEditFormData({ phoneNumber: '', email: '', name: '', country: '' });
      } else {
        const error = await response.json();
        toast({
          title: 'Error',
          description: error.error || 'Failed to update customer',
          variant: 'error',
        });
      }
    } catch (_error) {
      toast({
        title: 'Error',
        description: 'Failed to update customer',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleFavorite = async (customer: Customer, e: React.MouseEvent) => {
    e.stopPropagation();

    try {
      const response = await fetch(`/api/v1/customers/${customer._id}/favorite`, {
        method: 'POST',
      });

      if (response.ok) {
        await fetchCustomers();
        toast({
          title: 'Success',
          description: customer.isFavorite ? 'Removed from favorites' : 'Added to favorites',
          variant: 'success',
        });
      }
    } catch (_error) {
      toast({
        title: 'Error',
        description: 'Failed to toggle favorite',
        variant: 'error',
      });
    }
  };

  const copyPortalLink = (customer: Customer) => {
    const portalUrl = `${window.location.origin}/customer-portal/${orgSlug}/login?email=${encodeURIComponent(customer.email || '')}`;
    navigator.clipboard.writeText(portalUrl);
    toast({
      title: 'Success',
      description: 'Customer portal link copied to clipboard',
      variant: 'success',
    });
  };

  const copyEmail = (customer: Customer) => {
    if (!customer.email) return;
    navigator.clipboard.writeText(customer.email);
    toast({
      title: 'Copied',
      description: 'Email copied to clipboard',
      variant: 'success',
    });
  };

  const handleMergeSelection = (customer: Customer) => {
    if (!primaryCustomer) {
      setPrimaryCustomer(customer);
    } else if (customer._id === primaryCustomer._id) {
      setPrimaryCustomer(null);
      setSelectedDuplicates([]);
    } else {
      setSelectedDuplicates((prev) =>
        prev.includes(customer._id)
          ? prev.filter((id) => id !== customer._id)
          : [...prev, customer._id],
      );
    }
  };

  const cancelMerge = () => {
    setMergeMode(false);
    setPrimaryCustomer(null);
    setSelectedDuplicates([]);
    setMergeGroupCustomers([]);
  };

  const handleMerge = async () => {
    if (!primaryCustomer || selectedDuplicates.length === 0) return;

    setMerging(true);
    try {
      const response = await fetch('/api/v1/customers/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryCustomerId: primaryCustomer._id,
          duplicateCustomerIds: selectedDuplicates,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        toast({
          title: 'Success',
          description: `Merged ${data.mergedCount} customer(s). ${data.migratedRecords.transactions} transactions migrated.`,
          variant: 'success',
        });
        cancelMerge();
        setShowMergeConfirmModal(false);
        await fetchCustomers();
        await fetchGroups();
      } else {
        const error = await response.json();
        toast({
          title: 'Error',
          description: error.error || 'Failed to merge customers',
          variant: 'error',
        });
      }
    } catch (_error) {
      toast({
        title: 'Error',
        description: 'Failed to merge customers',
        variant: 'error',
      });
    } finally {
      setMerging(false);
    }
  };

  const fetchNameGuesses = async () => {
    setGuessing(true);
    setNameGuesses([]);
    setEditedNames({});
    setEditingGuessId(null);
    setApprovingIds(new Set());
    try {
      const response = await fetch('/api/v1/customers/guess-names', {
        method: 'POST',
      });
      if (response.ok) {
        const data = await response.json();
        setNameGuesses(data.guesses || []);
        if ((data.guesses || []).length === 0) {
          toast({
            title: 'No guesses',
            description: data.totalUnnamed
              ? `Found ${data.totalUnnamed} unnamed customers but could not guess any names from their emails.`
              : 'All customers already have names.',
            variant: 'default',
          });
        }
      } else {
        const error = await response.json();
        toast({
          title: 'Error',
          description: error.error || 'Failed to guess names',
          variant: 'error',
        });
      }
    } catch (_error) {
      toast({
        title: 'Error',
        description: 'Failed to guess names',
        variant: 'error',
      });
    } finally {
      setGuessing(false);
    }
  };

  const getDisplayName = (guess: NameGuess): string => {
    return editedNames[guess.customerId] ?? guess.guessedName ?? '';
  };

  const approveGuess = async (guess: NameGuess) => {
    const name = getDisplayName(guess);
    if (!name.trim()) return;

    setApprovingIds((prev) => new Set(prev).add(guess.customerId));
    try {
      const response = await fetch(`/api/v1/customers/${guess.customerId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });

      if (response.ok) {
        toast({
          title: 'Name updated',
          description: `${guess.email} → ${name.trim()}`,
          variant: 'success',
        });
        setNameGuesses((prev) => prev.filter((g) => g.customerId !== guess.customerId));
        await fetchCustomers();
      } else {
        const error = await response.json();
        toast({
          title: 'Error',
          description: error.error || 'Failed to update name',
          variant: 'error',
        });
      }
    } catch (_error) {
      toast({
        title: 'Error',
        description: 'Failed to update name',
        variant: 'error',
      });
    } finally {
      setApprovingIds((prev) => {
        const next = new Set(prev);
        next.delete(guess.customerId);
        return next;
      });
    }
  };

  const approveAll = async () => {
    for (const guess of nameGuesses) {
      await approveGuess(guess);
    }
    if (nameGuesses.length === 0) {
      setShowGuessNamesModal(false);
    }
  };

  const fetchDuplicates = async () => {
    setFindingDuplicates(true);
    setDuplicateGroups([]);
    setDuplicateSummary({ totalGroups: 0, totalDuplicateCustomers: 0 });
    try {
      const response = await fetch('/api/v1/customers/find-duplicates', {
        method: 'POST',
      });
      if (response.ok) {
        const data: FindDuplicatesResponse = await response.json();
        setDuplicateGroups(data.groups);
        setDuplicateSummary({
          totalGroups: data.totalGroups,
          totalDuplicateCustomers: data.totalDuplicateCustomers,
        });
        if (data.groups.length === 0) {
          toast({
            title: 'No duplicates found',
            description: 'All customer records appear to be unique.',
            variant: 'default',
          });
        }
      } else {
        const error = await response.json();
        toast({
          title: 'Error',
          description: error.error || 'Failed to find duplicates',
          variant: 'error',
        });
      }
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to find duplicates',
        variant: 'error',
      });
    } finally {
      setFindingDuplicates(false);
    }
  };

  const startMergeFromDuplicateGroup = (group: DuplicateGroup) => {
    setShowFindDuplicatesModal(false);

    // Sort by createdAt — oldest becomes suggested primary
    const sorted = [...group.customers].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    const primary = sorted[0];
    const duplicateIds = sorted.slice(1).map((c) => String(c._id));

    // Map to the Customer interface used by existing merge state
    const toCustomer = (c: typeof primary): Customer => ({
      _id: String(c._id),
      phoneNumber: c.phoneNumber,
      email: c.email,
      name: c.name,
      country: c.country,
      isFavorite: c.isFavorite,
      groups: c.groups,
      metadata: c.metadata,
      createdAt: c.createdAt,
    });

    setMergeGroupCustomers(sorted.map(toCustomer));
    setMergeMode(true);
    setPrimaryCustomer(toCustomer(primary));
    setSelectedDuplicates(duplicateIds);
    setShowMergeConfirmModal(true);
  };

  const handleCreateGroup = async () => {
    setSaving(true);

    try {
      const response = await fetch('/api/v1/customer-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(groupFormData),
      });

      if (response.ok) {
        toast({
          title: 'Success',
          description: 'Group created successfully!',
          variant: 'success',
        });
        await fetchGroups();
        setShowGroupModal(false);
        setGroupFormData({ name: '', description: '', color: '#3b82f6' });
      } else {
        const error = await response.json();
        toast({
          title: 'Error',
          description: error.error || 'Failed to create group',
          variant: 'error',
        });
      }
    } catch (_error) {
      toast({
        title: 'Error',
        description: 'Failed to create group',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const addToGroup = async (groupId: string) => {
    if (!selectedCustomer) return;

    try {
      const response = await fetch(`/api/v1/customers/${selectedCustomer._id}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId }),
      });

      if (response.ok) {
        toast({
          title: 'Success',
          description: 'Customer added to group',
          variant: 'success',
        });
        await fetchCustomers();
        await fetchGroups();
        setShowAddToGroupModal(false);
        setSelectedCustomer(null);
      } else {
        const error = await response.json();
        toast({
          title: 'Error',
          description: error.error || 'Failed to add to group',
          variant: 'error',
        });
      }
    } catch (_error) {
      toast({
        title: 'Error',
        description: 'Failed to add to group',
        variant: 'error',
      });
    }
  };

  const removeFromGroup = async (customerId: string, groupId: string) => {
    try {
      const response = await fetch(`/api/v1/customers/${customerId}/groups?groupId=${groupId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        toast({
          title: 'Success',
          description: 'Customer removed from group',
          variant: 'success',
        });
        await fetchCustomers();
        await fetchGroups();
      } else {
        const error = await response.json();
        toast({
          title: 'Error',
          description: error.error || 'Failed to remove from group',
          variant: 'error',
        });
      }
    } catch (_error) {
      toast({
        title: 'Error',
        description: 'Failed to remove from group',
        variant: 'error',
      });
    }
  };

  const deleteGroup = async (groupId: string) => {
    if (!confirm('Are you sure you want to delete this group? Customers will not be deleted.')) {
      return;
    }

    try {
      const response = await fetch(`/api/v1/customer-groups/${groupId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        toast({
          title: 'Success',
          description: 'Group deleted successfully',
          variant: 'success',
        });
        await fetchGroups();
        await fetchCustomers();
        if (selectedGroup === groupId) {
          setSelectedGroup('');
        }
      } else {
        const error = await response.json();
        toast({
          title: 'Error',
          description: error.error || 'Failed to delete group',
          variant: 'error',
        });
      }
    } catch (_error) {
      toast({
        title: 'Error',
        description: 'Failed to delete group',
        variant: 'error',
      });
    }
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  };

  const getActiveFilterLabel = () => {
    if (selectedFilter === 'favorites') {
      return 'Favorites';
    }
    if (selectedGroup) {
      const group = groups.find((g) => g._id === selectedGroup);
      return group?.name || 'Group';
    }
    return 'All Customers';
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading customers...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const getMergeCardClasses = (customerId: string) => {
    if (!mergeMode) return 'hover:border-primary';
    if (primaryCustomer?._id === customerId) return 'border-green-500 bg-green-50 ring-2 ring-green-200';
    if (selectedDuplicates.includes(customerId)) return 'border-orange-500 bg-orange-50 ring-2 ring-orange-200';
    return 'hover:border-primary';
  };

  const CustomerCard = ({ customer }: { customer: Customer }) => (
    <Card
      className={`transition-colors cursor-pointer ${getMergeCardClasses(customer._id)}`}
      onClick={() =>
        mergeMode
          ? handleMergeSelection(customer)
          : router.push(`/dashboard/customers/${customer._id}`)
      }
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            {mergeMode && primaryCustomer?._id === customer._id ? (
              <Check className="h-5 w-5 text-green-600" />
            ) : mergeMode && selectedDuplicates.includes(customer._id) ? (
              <Check className="h-5 w-5 text-orange-600" />
            ) : (
              <User className="h-5 w-5 text-primary" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <h3 className="font-semibold text-sm truncate">{customer.name || 'Unnamed Customer'}</h3>
                {customer.isFavorite && <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500 flex-shrink-0" />}
                {mergeMode && primaryCustomer?._id === customer._id && (
                  <Badge variant="outline" className="text-xs border-green-500 text-green-700 flex-shrink-0">Primary</Badge>
                )}
                {mergeMode && selectedDuplicates.includes(customer._id) && (
                  <Badge variant="outline" className="text-xs border-orange-500 text-orange-700 flex-shrink-0">Duplicate</Badge>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 hover:bg-primary/10">
                    <MoreVertical className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={(e) => toggleFavorite(customer, e as any)}>
                    {customer.isFavorite ? (
                      <>
                        <StarOff className="h-4 w-4 mr-2" />
                        Remove from Favorites
                      </>
                    ) : (
                      <>
                        <Star className="h-4 w-4 mr-2" />
                        Add to Favorites
                      </>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedCustomer(customer);
                      setShowAddToGroupModal(true);
                    }}
                  >
                    <Folder className="h-4 w-4 mr-2" />
                    Add to Group
                  </DropdownMenuItem>
                  {customer.email && (
                    <>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          copyEmail(customer);
                        }}
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        Copy Email
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          copyPortalLink(customer);
                        }}
                      >
                        <Link2 className="h-4 w-4 mr-2" />
                        Copy Portal Link
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEdit(customer);
                    }}
                  >
                    <Edit2 className="h-4 w-4 mr-2" />
                    Edit Customer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="space-y-0.5 mt-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Phone className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{customer.phoneNumber}</span>
                <WhatsAppButton phoneNumber={customer.phoneNumber} size="sm" />
              </div>
              {customer.email && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <svg className="h-3 w-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                  <span className="truncate">{customer.email}</span>
                </div>
              )}
              {customer.country && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{customer.country}</span>
                </div>
              )}
            </div>
            {customer.groups.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {customer.groups.map((groupId) => {
                  const group = groups.find((g) => g._id === groupId);
                  if (!group) return null;
                  return (
                    <Badge
                      key={groupId}
                      variant="outline"
                      className="text-xs"
                      style={{ borderColor: group.color, color: group.color }}
                    >
                      {group.name}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFromGroup(customer._id, groupId);
                        }}
                        className="ml-1 hover:bg-destructive/20 rounded-full"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            )}
            <div className="mt-2 pt-2 border-t flex justify-between text-xs">
              <span className="text-muted-foreground">{customer.metadata.totalPurchases} purchases</span>
              <span className="font-semibold">{formatCurrency(customer.metadata.totalSpent, customer.metadata.currency)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const CustomerListItem = ({ customer }: { customer: Customer }) => (
    <Card
      className={`transition-colors cursor-pointer ${getMergeCardClasses(customer._id)}`}
      onClick={() =>
        mergeMode
          ? handleMergeSelection(customer)
          : router.push(`/dashboard/customers/${customer._id}`)
      }
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            {mergeMode && primaryCustomer?._id === customer._id ? (
              <Check className="h-6 w-6 text-green-600" />
            ) : mergeMode && selectedDuplicates.includes(customer._id) ? (
              <Check className="h-6 w-6 text-orange-600" />
            ) : (
              <User className="h-6 w-6 text-primary" />
            )}
          </div>
          <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="flex items-center gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{customer.name || 'Unnamed Customer'}</h3>
                  {customer.isFavorite && <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />}
                  {mergeMode && primaryCustomer?._id === customer._id && (
                    <Badge variant="outline" className="text-xs border-green-500 text-green-700">Primary</Badge>
                  )}
                  {mergeMode && selectedDuplicates.includes(customer._id) && (
                    <Badge variant="outline" className="text-xs border-orange-500 text-orange-700">Duplicate</Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <p className="text-sm text-muted-foreground">{customer.phoneNumber}</p>
                  <WhatsAppButton phoneNumber={customer.phoneNumber} size="sm" />
                </div>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium">Email</p>
              <p className="text-sm text-muted-foreground truncate">{customer.email || 'N/A'}</p>
            </div>
            <div>
              <p className="text-sm font-medium">Purchases</p>
              <p className="text-sm text-muted-foreground">
                {customer.metadata.totalPurchases} ({formatCurrency(customer.metadata.totalSpent, customer.metadata.currency)})
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              {customer.groups.slice(0, 2).map((groupId) => {
                const group = groups.find((g) => g._id === groupId);
                if (!group) return null;
                return (
                  <Badge key={groupId} variant="outline" style={{ borderColor: group.color, color: group.color }}>
                    {group.name}
                  </Badge>
                );
              })}
              {customer.groups.length > 2 && <Badge variant="outline">+{customer.groups.length - 2}</Badge>}
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="sm">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={(e) => toggleFavorite(customer, e as any)}>
                    {customer.isFavorite ? (
                      <>
                        <StarOff className="h-4 w-4 mr-2" />
                        Remove from Favorites
                      </>
                    ) : (
                      <>
                        <Star className="h-4 w-4 mr-2" />
                        Add to Favorites
                      </>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedCustomer(customer);
                      setShowAddToGroupModal(true);
                    }}
                  >
                    <Folder className="h-4 w-4 mr-2" />
                    Add to Group
                  </DropdownMenuItem>
                  {customer.email && (
                    <>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          copyEmail(customer);
                        }}
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        Copy Email
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          copyPortalLink(customer);
                        }}
                      >
                        <Link2 className="h-4 w-4 mr-2" />
                        Copy Portal Link
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEdit(customer);
                    }}
                  >
                    <Edit2 className="h-4 w-4 mr-2" />
                    Edit Customer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
            <p className="text-muted-foreground mt-1">Manage your customer database and relationships</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              onClick={() => {
                setShowGuessNamesModal(true);
                fetchNameGuesses();
              }}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Guess Names
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setShowFindDuplicatesModal(true);
                fetchDuplicates();
              }}
            >
              <Search className="h-4 w-4 mr-2" />
              Find Duplicates
            </Button>
            <Button
              variant={mergeMode ? 'default' : 'outline'}
              onClick={() => (mergeMode ? cancelMerge() : setMergeMode(true))}
            >
              <GitMerge className="h-4 w-4 mr-2" />
              {mergeMode ? 'Cancel Merge' : 'Merge Customers'}
            </Button>
            <Button variant="outline" onClick={() => setShowGroupModal(true)}>
              <Users className="h-4 w-4 mr-2" />
              Manage Groups
            </Button>
            <Button onClick={() => setShowCreateModal(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Customer
            </Button>
          </div>
        </div>

        {/* Merge Mode Banner */}
        {mergeMode && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="font-medium text-amber-800">
              {!primaryCustomer
                ? 'Step 1: Click on a customer to select them as the primary (they will keep their identity).'
                : `Step 2: Primary selected: ${primaryCustomer.name || primaryCustomer.phoneNumber}. Now click duplicate customers to merge into them.${selectedDuplicates.length > 0 ? ` Selected: ${selectedDuplicates.length}` : ''}`}
            </p>
            <div className="flex gap-2 mt-2">
              {primaryCustomer && selectedDuplicates.length > 0 && (
                <Button size="sm" onClick={() => setShowMergeConfirmModal(true)}>
                  <GitMerge className="h-4 w-4 mr-2" />
                  Merge {selectedDuplicates.length} Customer{selectedDuplicates.length > 1 ? 's' : ''}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={cancelMerge}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Filters and View Toggle */}
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by phone, email, or name..."
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Filter Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="min-w-[160px] justify-between">
                <span className="flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  {getActiveFilterLabel()}
                </span>
                {(selectedFilter !== 'all' || selectedGroup) && (
                  <Badge variant="secondary" className="ml-2 h-5 px-1.5">
                    1
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                onClick={() => {
                  setSelectedFilter('all');
                  setSelectedGroup('');
                  setCurrentPage(1);
                }}
                className="flex items-center justify-between"
              >
                <span className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  All Customers
                </span>
                {selectedFilter === 'all' && !selectedGroup && <Check className="h-4 w-4" />}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setSelectedFilter('favorites');
                  setSelectedGroup('');
                  setCurrentPage(1);
                }}
                className="flex items-center justify-between"
              >
                <span className="flex items-center gap-2">
                  <Star className="h-4 w-4" />
                  Favorites
                </span>
                {selectedFilter === 'favorites' && <Check className="h-4 w-4" />}
              </DropdownMenuItem>
              {groups.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Groups</div>
                  {groups.map((group) => (
                    <DropdownMenuItem
                      key={group._id}
                      onClick={() => {
                        setSelectedFilter('group');
                        setSelectedGroup(group._id);
                        setCurrentPage(1);
                      }}
                      className="flex items-center justify-between"
                    >
                      <span className="flex items-center gap-2">
                        <div
                          className="h-3 w-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: group.color }}
                        />
                        <span className="truncate">{group.name}</span>
                        <span className="text-xs text-muted-foreground">({group.customerCount})</span>
                      </span>
                      {selectedGroup === group._id && <Check className="h-4 w-4 flex-shrink-0" />}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* View Toggle */}
          <div className="flex gap-1 border rounded-lg p-1">
            <Button
              variant={viewMode === 'grid' ? 'default' : 'ghost'}
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setViewMode('grid')}
            >
              <Grid3x3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setViewMode('list')}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Customers Display */}
        {customers.length > 0 ? (
          viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">{customers.map((customer) => <CustomerCard key={customer._id} customer={customer} />)}</div>
          ) : (
            <div className="space-y-2">{customers.map((customer) => <CustomerListItem key={customer._id} customer={customer} />)}</div>
          )
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <Plus className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">No customers found</h3>
              <p className="text-muted-foreground text-center max-w-md mb-6">
                {selectedFilter === 'favorites'
                  ? 'You haven\'t marked any customers as favorites yet.'
                  : selectedGroup
                    ? 'No customers in this group yet.'
                    : search
                      ? 'No customers match your search criteria.'
                      : 'Customer records will be created automatically when they make their first purchase, or you can add them manually.'}
              </p>
              <Button onClick={() => setShowCreateModal(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Customer
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Pagination Info */}
        {!loading && pagination.total > 0 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <div>
              Showing {(pagination.page - 1) * pagination.limit + 1} to{' '}
              {Math.min(pagination.page * pagination.limit, pagination.total)}{' '}
              of {pagination.total} customers
            </div>
            <div className="flex items-center gap-2">
              <label className="font-medium">Per page:</label>
              <select
                className="px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
              >
                <option value="10">10</option>
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
          </div>
        )}

        {/* Pagination Controls */}
        {!loading && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between border-t pt-4">
            <div className="text-sm text-muted-foreground">
              Page <span className="font-medium">{pagination.page}</span> of{' '}
              <span className="font-medium">{pagination.totalPages}</span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
              >
                First
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>

              {/* Page Numbers */}
              <div className="hidden sm:flex items-center gap-1">
                {Array.from(
                  { length: Math.min(5, pagination.totalPages) },
                  (_, i) => {
                    let pageNum;
                    if (pagination.totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= pagination.totalPages - 2) {
                      pageNum = pagination.totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }

                    return (
                      <Button
                        key={pageNum}
                        variant={currentPage === pageNum ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setCurrentPage(pageNum)}
                        className="min-w-[2.5rem]"
                      >
                        {pageNum}
                      </Button>
                    );
                  },
                )}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={currentPage === pagination.totalPages}
              >
                Next
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(pagination.totalPages)}
                disabled={currentPage === pagination.totalPages}
              >
                Last
              </Button>
            </div>
          </div>
        )}

        {/* Create Customer Modal */}
        <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Customer</DialogTitle>
              <DialogDescription>Create a new customer record</DialogDescription>
            </DialogHeader>

            <form onSubmit={(e) => { e.preventDefault(); handleCreate(); }}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Phone Number <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="tel"
                    placeholder="+1 (555) 123-4567"
                    className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    value={formData.phoneNumber}
                    onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Name</label>
                  <input
                    type="text"
                    placeholder="John Doe"
                    className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Email</label>
                  <input
                    type="email"
                    placeholder="john.doe@example.com"
                    className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
              </div>

              <DialogFooter className="mt-4">
                <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving || !formData.phoneNumber}>
                  {saving ? 'Creating...' : 'Create Customer'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Edit Customer Modal */}
        <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Customer</DialogTitle>
              <DialogDescription>Update customer information</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Phone Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={editFormData.phoneNumber}
                  onChange={(e) => setEditFormData({ ...editFormData, phoneNumber: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Name</label>
                <input
                  type="text"
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={editFormData.name}
                  onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Email</label>
                <input
                  type="email"
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={editFormData.email}
                  onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Country</label>
                <input
                  type="text"
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={editFormData.country}
                  onChange={(e) => setEditFormData({ ...editFormData, country: e.target.value })}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowEditModal(false)}>
                Cancel
              </Button>
              <Button onClick={handleUpdate} disabled={saving || !editFormData.phoneNumber}>
                {saving ? 'Updating...' : 'Update Customer'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Create/Manage Group Modal */}
        <Dialog open={showGroupModal} onOpenChange={setShowGroupModal}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Manage Customer Groups</DialogTitle>
              <DialogDescription>Create and manage groups to organize your customers</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Create New Group Form */}
              <div className="p-4 border rounded-lg space-y-3">
                <h4 className="font-medium">Create New Group</h4>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="Group name"
                    className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    value={groupFormData.name}
                    onChange={(e) => setGroupFormData({ ...groupFormData, name: e.target.value })}
                  />
                  <input
                    type="color"
                    className="h-10 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    value={groupFormData.color}
                    onChange={(e) => setGroupFormData({ ...groupFormData, color: e.target.value })}
                  />
                </div>
                <input
                  type="text"
                  placeholder="Description (optional)"
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={groupFormData.description}
                  onChange={(e) => setGroupFormData({ ...groupFormData, description: e.target.value })}
                />
                <Button onClick={handleCreateGroup} disabled={saving || !groupFormData.name} size="sm">
                  {saving ? 'Creating...' : 'Create Group'}
                </Button>
              </div>

              {/* Existing Groups List */}
              <div>
                <h4 className="font-medium mb-3">Existing Groups ({groups.length})</h4>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {groups.map((group) => (
                    <div key={group._id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded" style={{ backgroundColor: group.color }} />
                        <div>
                          <p className="font-medium">{group.name}</p>
                          <p className="text-xs text-muted-foreground">{group.customerCount} customers</p>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => deleteGroup(group._id)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button onClick={() => setShowGroupModal(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add to Group Modal */}
        <Dialog open={showAddToGroupModal} onOpenChange={setShowAddToGroupModal}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add to Group</DialogTitle>
              <DialogDescription>Select a group to add {selectedCustomer?.name || 'this customer'} to</DialogDescription>
            </DialogHeader>

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {groups
                .filter((group) => !selectedCustomer?.groups.includes(group._id))
                .map((group) => (
                  <button
                    key={group._id}
                    onClick={() => addToGroup(group._id)}
                    className="w-full flex items-center gap-3 p-3 border rounded-lg hover:bg-muted transition-colors text-left"
                  >
                    <div className="h-8 w-8 rounded flex-shrink-0" style={{ backgroundColor: group.color }} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{group.name}</p>
                      {group.description && <p className="text-xs text-muted-foreground truncate">{group.description}</p>}
                    </div>
                    <Badge variant="outline">{group.customerCount} members</Badge>
                  </button>
                ))}
              {groups.filter((group) => !selectedCustomer?.groups.includes(group._id)).length === 0 && (
                <p className="text-center text-muted-foreground py-8">Customer is already in all available groups</p>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setShowAddToGroupModal(false);
                  setSelectedCustomer(null);
                }}
              >
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {/* Guess Names Modal */}
        <Dialog open={showGuessNamesModal} onOpenChange={setShowGuessNamesModal}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Guess Customer Names
              </DialogTitle>
              <DialogDescription>
                Names guessed from customer email addresses. Review, edit if needed, then approve.
              </DialogDescription>
            </DialogHeader>

            {guessing ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4" />
                <p className="text-sm text-muted-foreground">Analyzing emails...</p>
              </div>
            ) : nameGuesses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Sparkles className="h-8 w-8 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">No name guesses available.</p>
                <p className="text-xs text-muted-foreground mt-1">All customers already have names, or emails didn&apos;t yield confident guesses.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {nameGuesses.map((guess) => {
                  const isEditing = editingGuessId === guess.customerId;
                  const displayName = getDisplayName(guess);
                  const isApproving = approvingIds.has(guess.customerId);

                  return (
                    <div
                      key={guess.customerId}
                      className="flex items-center gap-3 p-3 border rounded-lg"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground truncate">{guess.email}</span>
                          <Badge
                            variant="outline"
                            className={
                              guess.confidence >= 0.75
                                ? 'text-xs border-green-500 text-green-700'
                                : guess.confidence >= 0.5
                                  ? 'text-xs border-amber-500 text-amber-700'
                                  : 'text-xs border-gray-400 text-gray-500'
                            }
                          >
                            {Math.round(guess.confidence * 100)}%
                          </Badge>
                        </div>
                        {isEditing ? (
                          <div className="flex items-center gap-2 mt-1">
                            <input
                              type="text"
                              className="flex-1 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                              value={displayName}
                              onChange={(e) =>
                                setEditedNames((prev) => ({
                                  ...prev,
                                  [guess.customerId]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') setEditingGuessId(null);
                                if (e.key === 'Escape') {
                                  setEditedNames((prev) => {
                                    const next = { ...prev };
                                    delete next[guess.customerId];
                                    return next;
                                  });
                                  setEditingGuessId(null);
                                }
                              }}
                              autoFocus
                            />
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditingGuessId(null)}>
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <p className="font-semibold text-sm mt-0.5">{displayName}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {!isEditing && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            onClick={() => setEditingGuessId(guess.customerId)}
                            disabled={isApproving}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          onClick={() => setNameGuesses((prev) => prev.filter((g) => g.customerId !== guess.customerId))}
                          disabled={isApproving}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => approveGuess(guess)}
                          disabled={isApproving || !displayName.trim()}
                        >
                          {isApproving ? 'Saving...' : 'Approve'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowGuessNamesModal(false)}>
                Close
              </Button>
              {nameGuesses.length > 0 && (
                <Button onClick={approveAll} disabled={approvingIds.size > 0}>
                  {approvingIds.size > 0 ? 'Saving...' : `Approve All (${nameGuesses.length})`}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Find Duplicates Modal */}
        <Dialog open={showFindDuplicatesModal} onOpenChange={setShowFindDuplicatesModal}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                Find Duplicate Customers
              </DialogTitle>
              <DialogDescription>
                Customers that share the same phone number or email address.
                {duplicateSummary.totalGroups > 0 && (
                  <span className="ml-1">
                    Found {duplicateSummary.totalGroups} group{duplicateSummary.totalGroups !== 1 ? 's' : ''} involving{' '}
                    {duplicateSummary.totalDuplicateCustomers} customer{duplicateSummary.totalDuplicateCustomers !== 1 ? 's' : ''}.
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>

            {findingDuplicates ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4" />
                <p className="text-sm text-muted-foreground">Scanning for duplicates...</p>
              </div>
            ) : duplicateGroups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Users className="h-8 w-8 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">No duplicate customers found.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  All customer records have unique phone numbers and email addresses.
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                {duplicateGroups.map((group, groupIndex) => (
                  <div key={`${group.matchType}-${group.matchValue}-${groupIndex}`} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={
                            group.matchType === 'phone'
                              ? 'border-blue-500 text-blue-700'
                              : 'border-purple-500 text-purple-700'
                          }
                        >
                          {group.matchType === 'phone' ? (
                            <><Phone className="h-3 w-3 mr-1" /> Phone</>
                          ) : (
                            <>Email</>
                          )}
                        </Badge>
                        <span className="text-sm font-mono text-muted-foreground">
                          {group.matchValue}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startMergeFromDuplicateGroup(group)}
                      >
                        <GitMerge className="h-3.5 w-3.5 mr-1" />
                        Merge
                      </Button>
                    </div>
                    <div className="space-y-1.5">
                      {group.customers.map((customer, custIndex) => (
                        <div
                          key={String(customer._id)}
                          className={`flex items-center gap-3 p-2 rounded text-sm ${
                            custIndex === 0 ? 'bg-green-50 border border-green-200' : 'bg-muted/50'
                          }`}
                        >
                          <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <span className="font-medium">
                              {customer.name || 'Unnamed'}
                            </span>
                            <span className="text-muted-foreground ml-2">
                              {customer.phoneNumber}
                            </span>
                            <WhatsAppButton phoneNumber={customer.phoneNumber} size="sm" />
                            {customer.email && (
                              <span className="text-muted-foreground ml-2">
                                {customer.email}
                              </span>
                            )}
                          </div>
                          {custIndex === 0 && (
                            <Badge variant="outline" className="text-xs border-green-500 text-green-700 flex-shrink-0">
                              Suggested Primary
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowFindDuplicatesModal(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Merge Confirmation Modal */}
        <Dialog open={showMergeConfirmModal} onOpenChange={setShowMergeConfirmModal}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Confirm Customer Merge</DialogTitle>
              <DialogDescription>
                This action cannot be undone. The following customers will be merged into the primary customer.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 max-h-96 overflow-y-auto">
              {/* Primary Customer */}
              {primaryCustomer && (
                <div className="p-3 border-2 border-green-500 rounded-lg bg-green-50">
                  <Badge variant="outline" className="mb-2 border-green-500 text-green-700">Primary — keeps identity</Badge>
                  <p className="font-semibold">{primaryCustomer.name || 'Unnamed Customer'}</p>
                  <p className="text-sm text-muted-foreground">{primaryCustomer.phoneNumber}</p>
                  {primaryCustomer.email && (
                    <p className="text-sm text-muted-foreground">{primaryCustomer.email}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {primaryCustomer.metadata.totalPurchases} purchases &middot; {formatCurrency(primaryCustomer.metadata.totalSpent, primaryCustomer.metadata.currency)}
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <GitMerge className="h-4 w-4" />
                <span>Merging into primary:</span>
              </div>

              {/* Duplicate Customers */}
              {selectedDuplicates.map((dupId) => {
                const dup = customers.find((c) => c._id === dupId) || mergeGroupCustomers.find((c) => c._id === dupId);
                if (!dup) return null;
                return (
                  <div key={dupId} className="p-3 border border-orange-300 rounded-lg bg-orange-50">
                    <Badge variant="outline" className="mb-2 border-orange-500 text-orange-700">Will be merged &amp; deleted</Badge>
                    <p className="font-semibold">{dup.name || 'Unnamed Customer'}</p>
                    <p className="text-sm text-muted-foreground">{dup.phoneNumber}</p>
                    {dup.email && (
                      <p className="text-sm text-muted-foreground">{dup.email}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {dup.metadata.totalPurchases} purchases &middot; {formatCurrency(dup.metadata.totalSpent, dup.metadata.currency)}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
              <strong>Warning:</strong> {selectedDuplicates.length} customer record{selectedDuplicates.length > 1 ? 's' : ''} will
              be permanently deleted. Their transactions, balance history, and other data will be transferred to the primary customer.
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowMergeConfirmModal(false)} disabled={merging}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleMerge} disabled={merging}>
                {merging ? 'Merging...' : `Merge ${selectedDuplicates.length} Customer${selectedDuplicates.length > 1 ? 's' : ''}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
