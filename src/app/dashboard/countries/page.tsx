'use client';

import { useEffect, useState } from 'react';
import { Globe, Save, Search, Filter } from 'lucide-react';
import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, toast } from '@topupsend/ui';
import { DashboardLayout } from '@/components/dashboard-layout';
import { cn } from '@/lib/utils';

// Helper to get country flag emoji from ISO code
const getCountryFlag = (countryCode: string): string => {
  if (!countryCode || countryCode.length !== 2) return '🌍';
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
};

// ISO 3166-1 alpha-2 country codes with names
const COUNTRY_NAMES: Record<string, string> = {
  'AF': 'Afghanistan', 'AL': 'Albania', 'DZ': 'Algeria', 'AS': 'American Samoa',
  'AD': 'Andorra', 'AO': 'Angola', 'AI': 'Anguilla', 'AQ': 'Antarctica',
  'AG': 'Antigua and Barbuda', 'AR': 'Argentina', 'AM': 'Armenia', 'AW': 'Aruba',
  'AU': 'Australia', 'AT': 'Austria', 'AZ': 'Azerbaijan', 'BS': 'Bahamas',
  'BH': 'Bahrain', 'BD': 'Bangladesh', 'BB': 'Barbados', 'BY': 'Belarus',
  'BE': 'Belgium', 'BZ': 'Belize', 'BJ': 'Benin', 'BM': 'Bermuda',
  'BT': 'Bhutan', 'BO': 'Bolivia', 'BA': 'Bosnia and Herzegovina', 'BW': 'Botswana',
  'BR': 'Brazil', 'BN': 'Brunei', 'BG': 'Bulgaria', 'BF': 'Burkina Faso',
  'BI': 'Burundi', 'KH': 'Cambodia', 'CM': 'Cameroon', 'CA': 'Canada',
  'CV': 'Cape Verde', 'KY': 'Cayman Islands', 'CF': 'Central African Republic', 'TD': 'Chad',
  'CL': 'Chile', 'CN': 'China', 'CO': 'Colombia', 'KM': 'Comoros',
  'CG': 'Congo', 'CD': 'Congo (DRC)', 'CK': 'Cook Islands', 'CR': 'Costa Rica',
  'CI': 'Côte d\'Ivoire', 'HR': 'Croatia', 'CU': 'Cuba', 'CW': 'Curaçao',
  'CY': 'Cyprus', 'CZ': 'Czech Republic', 'DK': 'Denmark', 'DJ': 'Djibouti',
  'DM': 'Dominica', 'DO': 'Dominican Republic', 'EC': 'Ecuador', 'EG': 'Egypt',
  'SV': 'El Salvador', 'GQ': 'Equatorial Guinea', 'ER': 'Eritrea', 'EE': 'Estonia',
  'ET': 'Ethiopia', 'FJ': 'Fiji', 'FI': 'Finland', 'FR': 'France',
  'GF': 'French Guiana', 'PF': 'French Polynesia', 'GA': 'Gabon', 'GM': 'Gambia',
  'GE': 'Georgia', 'DE': 'Germany', 'GH': 'Ghana', 'GI': 'Gibraltar',
  'GR': 'Greece', 'GL': 'Greenland', 'GD': 'Grenada', 'GP': 'Guadeloupe',
  'GU': 'Guam', 'GT': 'Guatemala', 'GG': 'Guernsey', 'GN': 'Guinea',
  'GW': 'Guinea-Bissau', 'GY': 'Guyana', 'HT': 'Haiti', 'HN': 'Honduras',
  'HK': 'Hong Kong', 'HU': 'Hungary', 'IS': 'Iceland', 'IN': 'India',
  'ID': 'Indonesia', 'IR': 'Iran', 'IQ': 'Iraq', 'IE': 'Ireland',
  'IM': 'Isle of Man', 'IL': 'Israel', 'IT': 'Italy', 'JM': 'Jamaica',
  'JP': 'Japan', 'JE': 'Jersey', 'JO': 'Jordan', 'KZ': 'Kazakhstan',
  'KE': 'Kenya', 'KI': 'Kiribati', 'KP': 'Korea (North)', 'KR': 'Korea (South)',
  'KW': 'Kuwait', 'KG': 'Kyrgyzstan', 'LA': 'Laos', 'LV': 'Latvia',
  'LB': 'Lebanon', 'LS': 'Lesotho', 'LR': 'Liberia', 'LY': 'Libya',
  'LI': 'Liechtenstein', 'LT': 'Lithuania', 'LU': 'Luxembourg', 'MO': 'Macao',
  'MK': 'Macedonia', 'MG': 'Madagascar', 'MW': 'Malawi', 'MY': 'Malaysia',
  'MV': 'Maldives', 'ML': 'Mali', 'MT': 'Malta', 'MH': 'Marshall Islands',
  'MQ': 'Martinique', 'MR': 'Mauritania', 'MU': 'Mauritius', 'YT': 'Mayotte',
  'MX': 'Mexico', 'FM': 'Micronesia', 'MD': 'Moldova', 'MC': 'Monaco',
  'MN': 'Mongolia', 'ME': 'Montenegro', 'MS': 'Montserrat', 'MA': 'Morocco',
  'MZ': 'Mozambique', 'MM': 'Myanmar', 'NA': 'Namibia', 'NR': 'Nauru',
  'NP': 'Nepal', 'NL': 'Netherlands', 'NC': 'New Caledonia', 'NZ': 'New Zealand',
  'NI': 'Nicaragua', 'NE': 'Niger', 'NG': 'Nigeria', 'NU': 'Niue',
  'NF': 'Norfolk Island', 'MP': 'Northern Mariana Islands', 'NO': 'Norway', 'OM': 'Oman',
  'PK': 'Pakistan', 'PW': 'Palau', 'PS': 'Palestine', 'PA': 'Panama',
  'PG': 'Papua New Guinea', 'PY': 'Paraguay', 'PE': 'Peru', 'PH': 'Philippines',
  'PL': 'Poland', 'PT': 'Portugal', 'PR': 'Puerto Rico', 'QA': 'Qatar',
  'RE': 'Réunion', 'RO': 'Romania', 'RU': 'Russia', 'RW': 'Rwanda',
  'WS': 'Samoa', 'SM': 'San Marino', 'ST': 'São Tomé and Príncipe', 'SA': 'Saudi Arabia',
  'SN': 'Senegal', 'RS': 'Serbia', 'SC': 'Seychelles', 'SL': 'Sierra Leone',
  'SG': 'Singapore', 'SX': 'Sint Maarten', 'SK': 'Slovakia', 'SI': 'Slovenia',
  'SB': 'Solomon Islands', 'SO': 'Somalia', 'ZA': 'South Africa', 'SS': 'South Sudan',
  'ES': 'Spain', 'LK': 'Sri Lanka', 'SD': 'Sudan', 'SR': 'Suriname',
  'SZ': 'Swaziland', 'SE': 'Sweden', 'CH': 'Switzerland', 'SY': 'Syria',
  'TW': 'Taiwan', 'TJ': 'Tajikistan', 'TZ': 'Tanzania', 'TH': 'Thailand',
  'TL': 'Timor-Leste', 'TG': 'Togo', 'TO': 'Tonga', 'TT': 'Trinidad and Tobago',
  'TN': 'Tunisia', 'TR': 'Turkey', 'TM': 'Turkmenistan', 'TC': 'Turks and Caicos Islands',
  'TV': 'Tuvalu', 'UG': 'Uganda', 'UA': 'Ukraine', 'AE': 'United Arab Emirates',
  'GB': 'United Kingdom', 'US': 'United States', 'UY': 'Uruguay', 'UZ': 'Uzbekistan',
  'VU': 'Vanuatu', 'VA': 'Vatican City', 'VE': 'Venezuela', 'VN': 'Vietnam',
  'VG': 'Virgin Islands (British)', 'VI': 'Virgin Islands (US)', 'WF': 'Wallis and Futuna', 'YE': 'Yemen',
  'ZM': 'Zambia', 'ZW': 'Zimbabwe',
};

interface Country {
  code: string;
  name: string;
  flag: string;
}

export default function CountriesPage() {
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [availableCountries, setAvailableCountries] = useState<Country[]>([]);
  const [loadingCountries, setLoadingCountries] = useState(false);
  const [showOnlyEnabled, setShowOnlyEnabled] = useState(false);

  useEffect(() => {
    fetchSettings();
    fetchAvailableCountries();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/v1/storefront/settings');
      if (response.ok) {
        const data = await response.json();
        setSettings(data.settings);
      }
    } catch (_error) {
      console.error('Failed to fetch settings:', _error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableCountries = async () => {
    setLoadingCountries(true);
    try {
      // Fetch all providers to get unique country list
      const response = await fetch('/api/v1/integrations/providers');
      if (response.ok) {
        const data = await response.json();

        // Extract unique countries from providers
        const countryCodes = new Set<string>();
        if (data.providers && Array.isArray(data.providers)) {
          data.providers.forEach((provider: any) => {
            if (provider.CountryIso) {
              countryCodes.add(provider.CountryIso);
            }
          });
        }

        // Map country codes to full country objects
        const countries: Country[] = Array.from(countryCodes)
          .map(code => ({
            code,
            name: COUNTRY_NAMES[code] || code,
            flag: getCountryFlag(code),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

        setAvailableCountries(countries);
      } else {
        // Fallback to using all countries from COUNTRY_NAMES if API fails
        const fallbackCountries: Country[] = Object.entries(COUNTRY_NAMES)
          .map(([code, name]) => ({
            code,
            name,
            flag: getCountryFlag(code),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

        setAvailableCountries(fallbackCountries);
      }
    } catch (_error) {
      console.error('Failed to fetch countries:', _error);

      // Fallback to using all countries from COUNTRY_NAMES
      const fallbackCountries: Country[] = Object.entries(COUNTRY_NAMES)
        .map(([code, name]) => ({
          code,
          name,
          flag: getCountryFlag(code),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      setAvailableCountries(fallbackCountries);
    } finally {
      setLoadingCountries(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/v1/storefront/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      if (response.ok) {
        toast({
          title: 'Success',
          description: 'Country settings saved successfully!',
          variant: 'success',
        });
      } else {
        toast({
          title: 'Error',
          description: 'Failed to save country settings. Please try again.',
          variant: 'error',
        });
      }
    } catch (_error) {
      console.error('Failed to save settings:', _error);
      toast({
        title: 'Error',
        description: 'An unexpected error occurred. Please try again.',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleCountry = (countryCode: string) => {
    const enabled = [...(settings?.countries?.enabled || [])];
    const index = enabled.indexOf(countryCode);

    if (index > -1) {
      enabled.splice(index, 1);
    } else {
      enabled.push(countryCode);
    }

    setSettings({
      ...settings,
      countries: {
        ...settings?.countries,
        enabled,
        allEnabled: false, // Disable "all countries" when manually selecting
      },
    });
  };

  const toggleAllCountries = () => {
    setSettings({
      ...settings,
      countries: {
        ...settings?.countries,
        allEnabled: !settings?.countries?.allEnabled,
        enabled: settings?.countries?.allEnabled ? [] : availableCountries.map(c => c.code),
      },
    });
  };

  const isCountryEnabled = (countryCode: string) => {
    return settings?.countries?.allEnabled || settings?.countries?.enabled?.includes(countryCode);
  };

  const filteredCountries = availableCountries.filter(country => {
    const matchesSearch = country.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      country.code.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesFilter = !showOnlyEnabled || isCountryEnabled(country.code);

    return matchesSearch && matchesFilter;
  });

  const enabledCount = settings?.countries?.allEnabled
    ? availableCountries.length
    : (settings?.countries?.enabled?.length || 0);

  if (loading || loadingCountries) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">
              {loadingCountries ? 'Loading available countries...' : 'Loading country settings...'}
            </p>
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
            <h1 className="text-3xl font-bold tracking-tight">Country Settings</h1>
            <p className="text-muted-foreground mt-1">
              Choose which countries you want to serve on your storefront
            </p>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>

        {/* Summary Card */}
        <Card className="border-primary/50 shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Countries Overview
            </CardTitle>
            <CardDescription>
              Manage which countries can access your storefront
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Statistics */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-600 font-medium mb-1">Total Available</p>
                <p className="text-3xl font-bold text-blue-900">{availableCountries.length}</p>
                <p className="text-xs text-blue-600 mt-1">countries with support</p>
              </div>
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-600 font-medium mb-1">Currently Enabled</p>
                <p className="text-3xl font-bold text-green-900">{enabledCount}</p>
                <p className="text-xs text-green-600 mt-1">
                  {enabledCount === availableCountries.length
                    ? 'all countries enabled'
                    : `${Math.round((enabledCount / availableCountries.length) * 100)}% of available`}
                </p>
              </div>
            </div>

            {/* Enable All Toggle */}
            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
              <div>
                <p className="font-medium">Enable All Countries</p>
                <p className="text-sm text-muted-foreground">
                  Automatically accept top-ups for all available countries
                </p>
              </div>
              <Button
                variant={settings?.countries?.allEnabled ? 'default' : 'outline'}
                onClick={toggleAllCountries}
              >
                {settings?.countries?.allEnabled ? 'All Enabled' : 'Enable All'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Search and Country Selection */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Select Countries</CardTitle>
                <CardDescription>
                  Choose specific countries you want to serve
                </CardDescription>
              </div>
              {searchQuery && (
                <div className="text-sm text-muted-foreground">
                  Showing {filteredCountries.length} of {availableCountries.length} countries
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Search Bar and Filter */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <input
                  type="text"
                  className="w-full pl-10 pr-4 py-2 border rounded-lg"
                  placeholder="Search countries..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Button
                variant={showOnlyEnabled ? 'default' : 'outline'}
                onClick={() => setShowOnlyEnabled(!showOnlyEnabled)}
                className="whitespace-nowrap"
              >
                <Filter className="h-4 w-4 mr-2" />
                {showOnlyEnabled ? 'Enabled Only' : 'All Countries'}
              </Button>
            </div>

            {/* Country Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[600px] overflow-y-auto">
              {filteredCountries.map((country) => {
                const enabled = isCountryEnabled(country.code);
                return (
                  <button
                    key={country.code}
                    onClick={() => toggleCountry(country.code)}
                    disabled={settings?.countries?.allEnabled}
                    className={cn(
                      'flex items-center gap-3 p-4 border-2 rounded-lg transition-all text-left',
                      enabled
                        ? 'border-primary bg-primary/5'
                        : 'border-gray-200 hover:border-gray-300',
                      settings?.countries?.allEnabled && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    <span className="text-3xl">{country.flag}</span>
                    <div className="flex-1">
                      <p className="font-medium">{country.name}</p>
                      <p className="text-xs text-muted-foreground">{country.code}</p>
                    </div>
                    {enabled && (
                      <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                        <svg
                          className="h-3 w-3 text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={3}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {filteredCountries.length === 0 && (
              <div className="text-center py-12">
                <Globe className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <p className="text-muted-foreground">No countries found matching "{searchQuery}"</p>
              </div>
            )}

            {settings?.countries?.allEnabled && (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800">
                  ℹ️ All countries are currently enabled. Disable "Enable All Countries" above to select specific countries.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Save Button at Bottom */}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving} size="lg">
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Saving...' : 'Save Country Settings'}
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
