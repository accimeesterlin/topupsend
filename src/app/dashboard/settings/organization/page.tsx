'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Building2, Save, Globe, Mail, Phone, Image as ImageIcon, Trash2, Upload } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@topupsend/ui';
import { DashboardLayout } from '@/components/dashboard-layout';
import { ORG_LOGO_ACCEPT, ORG_LOGO_MAX_BYTES, validateOrgLogo } from '@/lib/org-logo';

interface Organization {
  _id: string;
  name: string;
  logo?: string | null;
  email?: string;
  phone?: string;
  website?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
  };
  settings?: {
    defaultCurrency?: string;
    timezone?: string;
  };
}

export default function OrganizationSettingsPage() {
  const router = useRouter();
  const [_organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    website: '',
    street: '',
    city: '',
    state: '',
    country: '',
    postalCode: '',
    defaultCurrency: 'USD',
    timezone: 'Pacific/Port_Moresby',
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState('');
  const [logoSaving, setLogoSaving] = useState(false);
  const logoFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchOrganization();
  }, []);

  const fetchOrganization = async () => {
    try {
      const response = await fetch('/api/v1/organization');
      if (response.ok) {
        const data = await response.json();
        setOrganization(data);
        setLogo(data.logo ?? null);
        setFormData({
          name: data.name || '',
          email: data.email || '',
          phone: data.phone || '',
          website: data.website || '',
          street: data.address?.street || '',
          city: data.address?.city || '',
          state: data.address?.state || '',
          country: data.address?.country || '',
          postalCode: data.address?.postalCode || '',
          defaultCurrency: data.settings?.defaultCurrency || 'USD',
          timezone: data.settings?.timezone || 'Pacific/Port_Moresby',
        });
      }
    } catch (_error) {
      console.error('Failed to fetch organization:', _error);
      setMessage({ type: 'error', text: 'Failed to load organization details' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch('/api/v1/organization', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          website: formData.website,
          address: {
            street: formData.street,
            city: formData.city,
            state: formData.state,
            country: formData.country,
            postalCode: formData.postalCode,
          },
          settings: {
            defaultCurrency: formData.defaultCurrency,
            timezone: formData.timezone,
          },
        }),
      });

      if (response.ok) {
        const updatedOrganization = await response.json();
        setOrganization(updatedOrganization);
        setMessage({ type: 'success', text: 'Organization settings saved successfully!' });
        setTimeout(() => setMessage(null), 3000);
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.error || 'Failed to save organization settings' });
      }
    } catch (_error) {
      setMessage({ type: 'error', text: 'Failed to save organization settings' });
    } finally {
      setSaving(false);
    }
  };

  const saveLogo = async (value: string | null) => {
    const validation = validateOrgLogo(value);
    if (!validation.ok) {
      setMessage({ type: 'error', text: validation.error });
      return;
    }
    setLogoSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/v1/organization', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logo: validation.value }),
      });
      if (response.ok) {
        setLogo(validation.value);
        setLogoUrl('');
        setMessage({
          type: 'success',
          text: validation.value
            ? 'Business logo saved. It now appears in your dashboard and customer portal.'
            : 'Business logo removed.',
        });
        setTimeout(() => setMessage(null), 3000);
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.error || 'Failed to save logo' });
      }
    } catch (_error) {
      setMessage({ type: 'error', text: 'Failed to save logo' });
    } finally {
      setLogoSaving(false);
    }
  };

  const handleLogoFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > ORG_LOGO_MAX_BYTES) {
      setMessage({
        type: 'error',
        text: `Logo image is too large. Maximum size is ${Math.round(ORG_LOGO_MAX_BYTES / 1024)} KB.`,
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        void saveLogo(reader.result);
      }
    };
    reader.onerror = () => setMessage({ type: 'error', text: 'Could not read that image file.' });
    reader.readAsDataURL(file);
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading organization settings...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-4xl">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => router.push('/dashboard/settings')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-3xl font-bold tracking-tight">Organization Settings</h1>
            <p className="text-muted-foreground mt-1">Manage your organization profile and preferences</p>
          </div>
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

        {/* Organization Information */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Building2 className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle>Organization Profile</CardTitle>
                <CardDescription>Update your organization's basic information</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Organization Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Your Organization Name"
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="email"
                    placeholder="contact@organization.com"
                    className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Phone</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="tel"
                    placeholder="+675 1234 5678"
                    className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Website</label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="url"
                  placeholder="https://www.yourwebsite.com"
                  className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={formData.website}
                  onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Business Logo */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <ImageIcon className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle>Business Logo</CardTitle>
                <CardDescription>
                  Shown in your dashboard and in the customer portal your customers use
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="h-16 min-w-16 px-2 rounded-lg border bg-white flex items-center justify-center overflow-hidden">
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt={formData.name || 'Organization logo'} className="max-h-14 max-w-40 object-contain" />
                ) : (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-6 w-6" />
                    <span className="text-sm font-medium">{formData.name || 'Your business'}</span>
                  </div>
                )}
              </div>
              <div className="text-sm text-muted-foreground">
                {logo
                  ? 'This is how your logo appears to customers.'
                  : 'No logo set. The portal and dashboard use the default branding.'}
              </div>
            </div>

            <input
              ref={logoFileRef}
              type="file"
              accept={ORG_LOGO_ACCEPT}
              className="hidden"
              onChange={(e) => {
                handleLogoFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={logoSaving}
                onClick={() => logoFileRef.current?.click()}
              >
                <Upload className="h-4 w-4 mr-2" />
                {logo ? 'Replace logo' : 'Upload logo'}
              </Button>
              {logo && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={logoSaving}
                  onClick={() => void saveLogo(null)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Remove logo
                </Button>
              )}
              <span className="text-xs text-muted-foreground">
                PNG, JPG, WebP, or SVG, up to {Math.round(ORG_LOGO_MAX_BYTES / 1024)} KB
              </span>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Or use an image URL</label>
              <div className="flex gap-2">
                <input
                  type="url"
                  placeholder="https://example.com/logo.png"
                  className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                />
                <Button
                  variant="outline"
                  disabled={logoSaving || !logoUrl.trim()}
                  onClick={() => void saveLogo(logoUrl.trim())}
                >
                  Use URL
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Address */}
        <Card>
          <CardHeader>
            <CardTitle>Address</CardTitle>
            <CardDescription>Your organization's physical address</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Street Address</label>
              <input
                type="text"
                placeholder="123 Main Street"
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                value={formData.street}
                onChange={(e) => setFormData({ ...formData, street: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">City</label>
                <input
                  type="text"
                  placeholder="Port Moresby"
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">State/Province</label>
                <input
                  type="text"
                  placeholder="National Capital District"
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={formData.state}
                  onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Country</label>
                <input
                  type="text"
                  placeholder="Papua New Guinea"
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={formData.country}
                  onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Postal Code</label>
                <input
                  type="text"
                  placeholder="111"
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={formData.postalCode}
                  onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Regional Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Regional Settings</CardTitle>
            <CardDescription>Configure currency and timezone preferences</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Default Currency</label>
                <select
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={formData.defaultCurrency}
                  onChange={(e) => setFormData({ ...formData, defaultCurrency: e.target.value })}
                >
                  <option value="USD">USD - US Dollar</option>
                  <option value="PGK">PGK - Papua New Guinea Kina</option>
                  <option value="AUD">AUD - Australian Dollar</option>
                  <option value="NZD">NZD - New Zealand Dollar</option>
                  <option value="EUR">EUR - Euro</option>
                  <option value="GBP">GBP - British Pound</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Timezone</label>
                <select
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  value={formData.timezone}
                  onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                >
                  <option value="Pacific/Port_Moresby">Port Moresby (GMT+10)</option>
                  <option value="Australia/Sydney">Sydney (GMT+10/+11)</option>
                  <option value="Pacific/Auckland">Auckland (GMT+12/+13)</option>
                  <option value="Pacific/Fiji">Fiji (GMT+12)</option>
                  <option value="America/Los_Angeles">Los Angeles (GMT-8/-7)</option>
                  <option value="America/New_York">New York (GMT-5/-4)</option>
                  <option value="Europe/London">London (GMT+0/+1)</option>
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving || !formData.name} size="lg">
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
