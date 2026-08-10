'use client';

import { useState, useEffect } from 'react';
import { Check, AlertCircle, Save, TestTube, Link as LinkIcon, Info, ChevronDown, ChevronUp, Star } from 'lucide-react';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@topupsend/ui';
import { DashboardLayout } from '@/components/dashboard-layout';
import { cn } from '@/lib/utils';

interface Integration {
  id: string;
  provider: string;
  status: 'active' | 'inactive' | 'error';
  environment?: string;
  isPrimaryEmail?: boolean;
  fromEmail?: string;
  fromName?: string;
  metadata?: {
    lastTestSuccess?: string;
    lastTestError?: string;
    accountBalance?: number;
  };
}

const integrationConfigs = {
  dingconnect: {
    name: 'DingConnect',
    description: 'Connect to DingConnect API for mobile top-ups and airtime distribution',
    icon: '📱',
    category: 'Top-up Providers',
    docsUrl: 'https://www.dingconnect.com/Api',
    fields: [
      {
        name: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'Enter your DingConnect API key',
        required: true,
        helpText: 'Found in your DingConnect dashboard under API Settings',
      },
    ],
  },
  reloadly: {
    name: 'Reloadly',
    description: 'Alternative provider for airtime and mobile data top-ups worldwide',
    icon: '🌍',
    category: 'Top-up Providers',
    docsUrl: 'https://developers.reloadly.com/',
    fields: [
      {
        name: 'clientId',
        label: 'Client ID',
        type: 'text',
        placeholder: 'Enter your Reloadly client ID',
        required: true,
        helpText: 'Found in your Reloadly dashboard',
      },
      {
        name: 'clientSecret',
        label: 'Client Secret',
        type: 'password',
        placeholder: 'Enter your client secret',
        required: true,
        helpText: 'Keep this secure and never share it',
      },
      {
        name: 'environment',
        label: 'Environment',
        type: 'select',
        placeholder: 'Select environment',
        required: true,
        helpText: 'Use sandbox for testing, production for live transactions',
      },
    ],
  },
  zeptomail: {
    name: 'ZeptoMail',
    description: 'Transactional email service for sending order confirmations and notifications',
    icon: '✉️',
    category: 'Email Providers',
    docsUrl: 'https://www.zoho.com/zeptomail/help/',
    fields: [
      {
        name: 'apiKey',
        label: 'Send Mail Token',
        type: 'password',
        placeholder: 'Enter your ZeptoMail Send Mail Token',
        required: true,
        helpText: 'Found in Mail Agent → SMTP/API → Send Mail Token (not the general API key)',
      },
      {
        name: 'fromEmail',
        label: 'From Email',
        type: 'email',
        placeholder: 'noreply@yourdomain.com',
        required: true,
        helpText: 'Email address to send from (must be verified)',
      },
      {
        name: 'fromName',
        label: 'From Name',
        type: 'text',
        placeholder: 'Your Company Name',
        required: false,
        helpText: 'Display name for outgoing emails',
      },
    ],
  },
  mailgun: {
    name: 'Mailgun',
    description: 'Powerful email API for sending transactional emails at scale',
    icon: '📬',
    category: 'Email Providers',
    docsUrl: 'https://documentation.mailgun.com/',
    fields: [
      {
        name: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'Enter your Mailgun API key',
        required: true,
        helpText: 'Found in Mailgun Settings → API Keys',
      },
      {
        name: 'domain',
        label: 'Domain',
        type: 'text',
        placeholder: 'mg.yourdomain.com',
        required: true,
        helpText: 'Your verified sending domain',
      },
      {
        name: 'fromEmail',
        label: 'From Email',
        type: 'email',
        placeholder: 'noreply@yourdomain.com',
        required: true,
        helpText: 'Email address to send from',
      },
      {
        name: 'fromName',
        label: 'From Name',
        type: 'text',
        placeholder: 'Your Company Name',
        required: false,
        helpText: 'Display name for outgoing emails',
      },
    ],
  },
  sendgrid: {
    name: 'SendGrid',
    description: 'Reliable email delivery platform trusted by developers',
    icon: '📧',
    category: 'Email Providers',
    docsUrl: 'https://docs.sendgrid.com/',
    fields: [
      {
        name: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'Enter your SendGrid API key',
        required: true,
        helpText: 'Found in SendGrid Settings → API Keys',
      },
      {
        name: 'fromEmail',
        label: 'From Email',
        type: 'email',
        placeholder: 'noreply@yourdomain.com',
        required: true,
        helpText: 'Email address to send from (must be verified)',
      },
      {
        name: 'fromName',
        label: 'From Name',
        type: 'text',
        placeholder: 'Your Company Name',
        required: false,
        helpText: 'Display name for outgoing emails',
      },
    ],
  },
  mailchimp: {
    name: 'Mailchimp',
    description: 'Marketing automation and email platform for customer engagement',
    icon: '🐒',
    category: 'Email Providers',
    docsUrl: 'https://mailchimp.com/developer/',
    fields: [
      {
        name: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'Enter your Mailchimp API key',
        required: true,
        helpText: 'Found in Mailchimp Account → Extras → API Keys',
      },
      {
        name: 'fromEmail',
        label: 'From Email',
        type: 'email',
        placeholder: 'noreply@yourdomain.com',
        required: true,
        helpText: 'Email address to send from (must be verified)',
      },
      {
        name: 'fromName',
        label: 'From Name',
        type: 'text',
        placeholder: 'Your Company Name',
        required: false,
        helpText: 'Display name for outgoing emails',
      },
    ],
  },
  zapier: {
    name: 'Zapier',
    description: 'Connect to thousands of apps and automate workflows',
    icon: '⚡',
    category: 'Automation',
    docsUrl: 'https://zapier.com/help/',
    fields: [
      {
        name: 'apiKey',
        label: 'Webhook URL',
        type: 'text',
        placeholder: 'https://hooks.zapier.com/hooks/catch/...',
        required: true,
        helpText: 'Create a Zap with a webhook trigger and paste the URL here',
      },
    ],
  },
};

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [testMessage, setTestMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [settingPrimary, setSettingPrimary] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState('');

  useEffect(() => {
    fetchIntegrations();
  }, []);

  const fetchIntegrations = async () => {
    try {
      const response = await fetch('/api/v1/integrations');
      if (response.ok) {
        const data = await response.json();
        console.log('Fetched integrations:', data);
        setIntegrations(data);
      }
    } catch (_error) {
      console.error('Failed to fetch integrations:', _error);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (provider: string) => {
    setSelectedProvider(provider);
    setTestMessage(null);
    setTestEmail('');
    // Pre-fill form if integration exists
    const existing = integrations.find((i) => i.provider === provider);
    if (existing) {
      // For Reloadly, keep environment field
      const defaultData: Record<string, any> = {};
      if (provider === 'reloadly') {
        defaultData.environment = existing.environment || 'sandbox';
      }
      setFormData(defaultData);
    } else {
      // Default environment for Reloadly only
      const defaultData: Record<string, any> = {};
      if (provider === 'reloadly') {
        defaultData.environment = 'sandbox';
      }
      setFormData(defaultData);
    }
  };

  const handleCloseModal = () => {
    setSelectedProvider(null);
    setFormData({});
    setTestMessage(null);
  };

  const handleTest = async () => {
    if (!selectedProvider) return;

    const config = integrationConfigs[selectedProvider as keyof typeof integrationConfigs];
    const isEmailProvider = config.category === 'Email Providers';

    // For email providers, require a test email address
    if (isEmailProvider && !testEmail) {
      setTestMessage({
        type: 'error',
        text: 'Please enter a test email address',
      });
      return;
    }

    setTesting(true);
    setTestMessage(null);

    try {
      const credentials: Record<string, any> = {};

      // Collect all credential fields
      config.fields.forEach((field) => {
        if (field.name !== 'environment') {
          credentials[field.name] = formData[field.name];
        }
      });

      const payload: any = {
        provider: selectedProvider,
        credentials,
      };

      // Only include environment for Reloadly
      if (selectedProvider === 'reloadly') {
        payload.environment = formData.environment;
      }

      // Add test email for email providers
      if (isEmailProvider) {
        payload.testEmail = testEmail;
      }

      const response = await fetch('/api/v1/integrations/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      console.log('Test result:', result);

      if (response.ok && result.success) {
        // For top-up providers, show balance
        if (result.data?.balance && result.data?.currency) {
          setTestMessage({
            type: 'success',
            text: `Connection successful! Balance: ${result.data.balance} ${result.data.currency}`,
          });
        } else if (isEmailProvider) {
          // For email providers, show test email sent message
          setTestMessage({
            type: 'success',
            text: `Test email sent successfully to ${testEmail}! Check your inbox.`,
          });
        } else {
          // For Zapier and other providers
          setTestMessage({
            type: 'success',
            text: 'Connection successful! Credentials verified.',
          });
        }
      } else {
        // Better error handling - ensure error is always a string
        let errorMessage = 'Connection test failed';

        if (result.error) {
          if (typeof result.error === 'string') {
            errorMessage = result.error;
          } else if (result.error.message) {
            errorMessage = result.error.message;
          } else if (result.detail) {
            errorMessage = result.detail;
          } else {
            try {
              errorMessage = JSON.stringify(result.error);
            } catch {
              errorMessage = String(result.error);
            }
          }
        }

        console.error('Test failed:', errorMessage);

        setTestMessage({
          type: 'error',
          text: errorMessage,
        });
      }
    } catch (error: any) {
      setTestMessage({
        type: 'error',
        text: error.message || 'Failed to test connection',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!selectedProvider) return;

    setSaving(true);
    setTestMessage(null);

    try {
      const config = integrationConfigs[selectedProvider as keyof typeof integrationConfigs];
      const credentials: Record<string, any> = {};

      // Collect all credential fields
      config.fields.forEach((field) => {
        if (field.name !== 'environment') {
          credentials[field.name] = formData[field.name];
        }
      });

      const payload: any = {
        provider: selectedProvider,
        credentials,
      };

      // Only include environment for Reloadly
      if (selectedProvider === 'reloadly') {
        payload.environment = formData.environment;
      }

      const response = await fetch('/api/v1/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        setTestMessage({
          type: 'success',
          text: 'Configuration saved successfully! You can now close this dialog.',
        });
        await fetchIntegrations();
        // Don't close modal immediately so user can see success message
        setTimeout(() => {
          handleCloseModal();
        }, 2000);
      } else {
        const error = await response.json();
        setTestMessage({
          type: 'error',
          text: error.error || 'Failed to save integration',
        });
      }
    } catch (_error) {
      console.error('Save error:', _error);
      setTestMessage({
        type: 'error',
        text: 'Failed to save integration',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSetPrimary = async (integrationId: string, currentPrimary: boolean) => {
    console.log('Setting primary:', { integrationId, currentPrimary, newValue: !currentPrimary });
    setSettingPrimary(integrationId);

    try {
      const url = `/api/v1/integrations/${integrationId}/primary`;
      console.log('PATCH request to:', url);

      const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPrimaryEmail: !currentPrimary }),
      });

      console.log('Response status:', response.status);

      if (response.ok) {
        const result = await response.json();
        console.log('Success result:', result);
        await fetchIntegrations();
      } else {
        const errorData = await response.json();
        console.error('Failed to set primary:', errorData);
      }
    } catch (_error) {
      console.error('Set primary error:', _error);
    } finally {
      setSettingPrimary(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
      case 'connected':
        return 'text-green-600 bg-green-100';
      case 'error':
        return 'text-red-600 bg-red-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  const getIntegrationStatus = (provider: string) => {
    const integration = integrations.find((i) => i.provider === provider);
    if (!integration) return { status: 'disconnected', text: 'Not Connected' };
    if (integration.status === 'active') return { status: 'connected', text: 'Connected' };
    if (integration.status === 'error') return { status: 'error', text: 'Error' };
    return { status: 'disconnected', text: 'Not Connected' };
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading integrations...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-4xl">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Integrations</h1>
          <p className="text-muted-foreground mt-1">
            Connect external services to enable top-up functionality, email notifications, and automation
          </p>
        </div>

        {/* Important Notice */}
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-blue-900 mb-1">Integration Required</h3>
                <p className="text-sm text-blue-800 mb-3">
                  You must connect at least one top-up provider (DingConnect or Reloadly) to process transactions.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowInstructions(!showInstructions)}
                  className="text-blue-800 hover:text-blue-900 hover:bg-blue-100 -ml-2"
                >
                  <Info className="h-4 w-4 mr-1" />
                  {showInstructions ? 'Hide' : 'Show'} Setup Instructions
                  {showInstructions ? <ChevronUp className="h-4 w-4 ml-1" /> : <ChevronDown className="h-4 w-4 ml-1" />}
                </Button>
              </div>
            </div>

            {/* Collapsible Instructions */}
            {showInstructions && (
              <div className="mt-4 pt-4 border-t border-blue-200 space-y-4">
                <div>
                  <h4 className="font-semibold text-blue-900 mb-2">DingConnect Setup:</h4>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-blue-800 ml-2">
                    <li>
                      Visit{' '}
                      <a
                        href="https://www.dingconnect.com"
                        target="_blank"
                        rel="noopener"
                        className="underline hover:text-blue-600"
                      >
                        dingconnect.com
                      </a>{' '}
                      and create an account
                    </li>
                    <li>Complete the business verification process</li>
                    <li>Navigate to Settings → API Keys in your dashboard</li>
                    <li>Generate a new API key</li>
                    <li>Click "Configure" above and paste your API key</li>
                  </ol>
                </div>
                <div>
                  <h4 className="font-semibold text-blue-900 mb-2">Reloadly Setup:</h4>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-blue-800 ml-2">
                    <li>
                      Visit{' '}
                      <a
                        href="https://www.reloadly.com"
                        target="_blank"
                        rel="noopener"
                        className="underline hover:text-blue-600"
                      >
                        reloadly.com
                      </a>{' '}
                      and sign up
                    </li>
                    <li>Complete your profile and business information</li>
                    <li>Go to Developers → API Credentials</li>
                    <li>Copy your Client ID and Client Secret</li>
                    <li>Click "Configure" above to enter your credentials</li>
                  </ol>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Integrations List - Grouped by Category */}
        <div className="space-y-8">
          {['Top-up Providers', 'Email Providers', 'Automation'].map((category) => {
            const categoryIntegrations = Object.entries(integrationConfigs).filter(
              ([_, config]) => config.category === category
            );

            if (categoryIntegrations.length === 0) return null;

            return (
              <div key={category}>
                <h2 className="text-xl font-semibold mb-4">{category}</h2>
                <div className="space-y-4">
                  {categoryIntegrations.map(([providerId, config]) => {
                    const status = getIntegrationStatus(providerId);
                    const integration = integrations.find((i) => i.provider === providerId);
                    const isEmailProvider = config.category === 'Email Providers';
                    const isConnected = status.status === 'connected';
                    const isPrimary = integration?.isPrimaryEmail || false;

                    if (isEmailProvider && integration) {
                      console.log(`[${providerId}] Integration:`, integration, 'isPrimary:', isPrimary);
                    }

                    return (
                      <Card key={providerId}>
                        <CardHeader>
                          <div className="flex items-start justify-between">
                            <div className="flex items-start gap-4 flex-1">
                              <div className="text-4xl">{config.icon}</div>
                              <div className="flex-1">
                                <div className="flex items-center gap-3 mb-2">
                                  <CardTitle>{config.name}</CardTitle>
                                  <span
                                    className={cn(
                                      'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium',
                                      getStatusColor(status.status)
                                    )}
                                  >
                                    {status.status === 'connected' && <Check className="h-3 w-3" />}
                                    {status.text}
                                  </span>
                                  {isPrimary && (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                      <Star className="h-3 w-3 fill-yellow-600" />
                                      Primary
                                    </span>
                                  )}
                                </div>
                                <CardDescription>{config.description}</CardDescription>
                                {integration?.fromEmail && (
                                  <p className="text-xs text-muted-foreground mt-2">
                                    From: {integration.fromEmail}
                                  </p>
                                )}
                                <div className="mt-3">
                                  <Button
                                    variant="link"
                                    className="p-0 h-auto text-xs"
                                    onClick={() => window.open(config.docsUrl, '_blank')}
                                  >
                                    <LinkIcon className="h-3 w-3 mr-1" />
                                    API Documentation
                                  </Button>
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              {isEmailProvider && isConnected && (
                                <Button
                                  variant={isPrimary ? 'default' : 'outline'}
                                  size="sm"
                                  onClick={() => integration && handleSetPrimary(integration.id, isPrimary)}
                                  disabled={settingPrimary === integration?.id}
                                >
                                  <Star className={cn('h-4 w-4 mr-2', isPrimary && 'fill-current')} />
                                  {settingPrimary === integration?.id ? 'Setting...' : isPrimary ? 'Primary' : 'Set as Primary'}
                                </Button>
                              )}
                              <Button onClick={() => handleOpenModal(providerId)}>
                                {status.status === 'connected' ? 'Reconfigure' : 'Configure'}
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Configuration Modal */}
        <Dialog open={!!selectedProvider} onOpenChange={handleCloseModal}>
          <DialogContent>
            {selectedProvider && (
              <>
                <DialogHeader>
                  <DialogTitle>
                    Configure {integrationConfigs[selectedProvider as keyof typeof integrationConfigs].name}
                  </DialogTitle>
                  <DialogDescription>
                    Enter your API credentials to connect this integration
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  {integrationConfigs[selectedProvider as keyof typeof integrationConfigs].fields.map((field) => (
                    <div key={field.name}>
                      <label className="block text-sm font-medium mb-2">
                        {field.label}
                        {field.required && <span className="text-red-500 ml-1">*</span>}
                      </label>
                      {field.type === 'select' ? (
                        <select
                          className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                          value={formData[field.name] || ''}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              [field.name]: e.target.value,
                            })
                          }
                        >
                          <option value="">Select...</option>
                          <option value="sandbox">Sandbox (Testing)</option>
                          <option value="production">Production (Live)</option>
                        </select>
                      ) : (
                        <input
                          type={field.type}
                          placeholder={field.placeholder}
                          className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                          value={formData[field.name] || ''}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              [field.name]: e.target.value,
                            })
                          }
                        />
                      )}
                      {field.helpText && (
                        <p className="text-xs text-muted-foreground mt-1">{field.helpText}</p>
                      )}
                    </div>
                  ))}

                  {/* Test Email Input for Email Providers */}
                  {selectedProvider && integrationConfigs[selectedProvider as keyof typeof integrationConfigs].category === 'Email Providers' && (
                    <div className="border-t pt-4">
                      <label className="block text-sm font-medium mb-2">
                        Test Email Address
                        <span className="text-red-500 ml-1">*</span>
                      </label>
                      <input
                        type="email"
                        placeholder="your-email@example.com"
                        className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                        value={testEmail}
                        onChange={(e) => setTestEmail(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        We'll send a test email to this address when you click "Test Connection"
                      </p>
                    </div>
                  )}

                  {/* Test Message */}
                  {testMessage && (
                    <div
                      className={cn(
                        'p-3 rounded-lg text-sm',
                        testMessage.type === 'success'
                          ? 'bg-green-50 text-green-800 border border-green-200'
                          : 'bg-red-50 text-red-800 border border-red-200'
                      )}
                    >
                      {testMessage.text}
                    </div>
                  )}
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={handleCloseModal}>
                    Cancel
                  </Button>
                  <Button onClick={handleTest} disabled={testing} variant="outline">
                    <TestTube className="h-4 w-4 mr-2" />
                    {testing ? 'Testing...' : 'Test Connection'}
                  </Button>
                  <Button onClick={handleSave} disabled={saving}>
                    <Save className="h-4 w-4 mr-2" />
                    {saving ? 'Saving...' : 'Save Configuration'}
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
