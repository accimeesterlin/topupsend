/**
 * DingConnect API Service
 * Handles all interactions with the DingConnect API
 * Documentation: https://www.dingconnect.com/Api
 */

interface DingConnectConfig {
  apiKey: string;
  baseUrl?: string;
}

/** Default (and only) production DingConnect API base URL. */
export const DINGCONNECT_DEFAULT_BASE_URL = "https://api.dingconnect.com";

/**
 * Hosts a DingConnect base URL may point at. DingConnect publishes a single
 * API host; anything else would receive the org's API key with every
 * request, so stored/integration-supplied base URLs are pinned to it
 * (F-M8: stored SSRF / key exfiltration via a tampered `baseUrl`).
 */
const DINGCONNECT_ALLOWED_HOSTS = new Set(["api.dingconnect.com"]);

/**
 * Resolve a configured DingConnect base URL to the exact origin that will
 * be used for outbound calls. Unset/blank means the default. Any value that
 * is not an https URL on an allowlisted DingConnect host throws, so a
 * tampered integration setting fails closed instead of redirecting API
 * keys to an arbitrary (possibly internal) host.
 */
export function resolveDingConnectBaseUrl(baseUrl?: string | null): string {
  if (!baseUrl || !baseUrl.trim()) {
    return DINGCONNECT_DEFAULT_BASE_URL;
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl.trim());
  } catch {
    throw new Error(`Invalid DingConnect base URL: ${baseUrl}`);
  }

  if (
    parsed.protocol !== "https:" ||
    !DINGCONNECT_ALLOWED_HOSTS.has(parsed.hostname)
  ) {
    throw new Error(
      `Invalid DingConnect base URL: ${baseUrl}. Must be ${DINGCONNECT_DEFAULT_BASE_URL}`,
    );
  }

  return `${parsed.protocol}//${parsed.host}`;
}

interface DingConnectBenefitValue {
  CurrencyCode?: string;
  CurrencySymbol?: string;
  Amount: number;
  Unit?: string;
}

interface DingConnectPrice {
  CurrencyCode: string;
  CurrencySymbol: string;
  Amount: number;
}

interface DingConnectMinMax {
  SendValue: number;
  SendCurrencyIso: string;
  ReceiveValue: number;
  ReceiveCurrencyIso: string;
}

export interface DingConnectProduct {
  SkuCode: string;
  ProductId: number;
  ProviderCode: string;
  CountryIso: string;
  RegionCode: string;
  LocalizationKey: string;
  DefaultDisplayText: string;

  // Benefit Types (for fixed-value products)
  BenefitTypes?: {
    Airtime?: DingConnectBenefitValue;
    Data?: DingConnectBenefitValue;
    Voice?: DingConnectBenefitValue;
    SMS?: DingConnectBenefitValue;
  };

  // Benefits array (for variable-value products)
  Benefits?: string[];

  ValidityPeriodIso?: string;

  // Pricing (for fixed-value products)
  Price?: DingConnectPrice;
  ReceiveValue?: DingConnectPrice;

  // Min/Max (for variable-value products)
  Minimum?: DingConnectMinMax;
  Maximum?: DingConnectMinMax;
}

export interface DingConnectProvider {
  ProviderCode: string;
  ProviderName: string;
  CountryIso: string;
  RegionCode: string;
  LogoUrl?: string;
  CurrencyCode: string;
}

/**
 * Raw envelope returned by DingConnect's GET /api/V1/GetBalance.
 * Actual field names are Balance and CurrencyIso (not AccountBalance / CurrencyCode).
 * ResultCode 1 = success; any other value indicates an error.
 */
interface DingConnectBalanceEnvelope {
  Balance: number;
  CurrencyIso: string;
  ResultCode: number;
  ErrorCodes: Array<{ Code: string }>;
}

/** Normalised balance object consumed by the rest of the app. */
export interface DingConnectBalance {
  AccountBalance: number;
  CurrencyCode: string;
}

export interface SendTransferRequest {
  SkuCode: string;
  SendValue?: number;
  SendCurrencyIso?: string; // For variable-value products
  ReceiveValue?: number;
  ReceiveCurrencyIso?: string; // For fixed-value products
  AccountNumber: string;
  ValidateOnly?: boolean;
  DistributorRef?: string;
}

export interface SendTransferResponse {
  TransferId: number;
  Status: 'Completed' | 'Processing' | 'Failed';
  ProviderTransactionId?: string;
  ErrorMessage?: string;
  ErrorCode?: string;
}

export interface DingConnectProductDescription {
  /** Short description of the product */
  DisplayText: string;
  /** Longer markdown description of the product */
  DescriptionMarkdown?: string;
  /** More detailed information about the product */
  ReadMoreMarkdown?: string;
  LocalizationKey: string;
  LanguageCode: string;
}

export interface GetProductDescriptionsParams {
  skuCodes?: string[];
  languageCodes?: string[];
}

export interface GetProvidersParams {
  countryIso?: string;
  regionCode?: string;
  accountNumber?: string;
}

export interface GetProductsParams {
  providerCode?: string;
  countryIso?: string;
  regionCode?: string;
  accountNumber?: string;
}

export interface LookupAccountParams {
  accountNumber: string;
  countryIso?: string;
  providerCode?: string;
}

export interface AccountLookupResponse {
  AccountNumber: string;
  CountryIso: string;
  ProviderCode: string;
  ProviderName?: string;
}

export class DingConnectService {
  private config: DingConnectConfig;
  private baseUrl: string;

  constructor(config: DingConnectConfig) {
    this.config = config;
    // Allowlist-validated: a stored baseUrl can never redirect the API key
    // to a non-DingConnect host (F-M8).
    this.baseUrl = resolveDingConnectBaseUrl(config.baseUrl);
  }

  /**
   * Make authenticated request to DingConnect API
   * @param raw - When true, returns the full response envelope without extracting Items.
   *              Use this for endpoints like GetBalance where important fields (e.g.
   *              AccountBalance) live at the root alongside Items.
   */
  private async request<T>(endpoint: string, options: RequestInit = {}, raw = false): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const requestBody = options.body;

    // Hard 30s timeout on every provider call (Cluster 1e): without it
    // a hung connection blocks fulfillment indefinitely and callers
    // cannot distinguish "slow" from "stuck". A timeout surfaces as a
    // fetch abort error — which callers must treat as an UNKNOWN
    // outcome, never as a definite rejection.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'api_key': this.config.apiKey,
          ...options.headers,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      let errorDetails: any = { message: 'Unknown error' };
      let responseText = '';

      try {
        responseText = await response.text();
        errorDetails = JSON.parse(responseText);
      } catch (_e) {
        errorDetails = { message: responseText || response.statusText };
      }

      // Enhanced error with full details
      const errorMessage = [
        `DingConnect API Error: ${response.status} ${response.statusText}`,
        `URL: ${endpoint}`,
        `Request: ${requestBody || 'none'}`,
        `Response: ${JSON.stringify(errorDetails)}`,
        `Message: ${errorDetails.message || errorDetails.ErrorMessage || 'Unknown error'}`,
        errorDetails.ErrorCodes ? `Error Codes: ${JSON.stringify(errorDetails.ErrorCodes)}` : '',
      ].filter(Boolean).join(' | ');

      throw new Error(errorMessage);
    }

    const data = await response.json();

    // When raw is requested, return the full envelope (e.g. for GetBalance)
    if (raw) {
      return data as T;
    }

    // DingConnect wraps responses in { ResultCode, ErrorCodes, Items } structure
    // Extract the Items array if it exists
    if (data && typeof data === 'object' && 'Items' in data) {
      return data.Items as T;
    }

    return data;
  }

  /**
   * Get account balance
   * GET /api/V1/GetBalance
   *
   * The response envelope uses Balance / CurrencyIso (not AccountBalance /
   * CurrencyCode) and has no Items array, so we request the raw envelope and
   * map it to the normalised DingConnectBalance shape.
   */
  async getBalance(): Promise<DingConnectBalance> {
    const envelope = await this.request<DingConnectBalanceEnvelope>('/api/V1/GetBalance', {}, true);

    // ResultCode !== 1 means the API reported an error
    if (envelope.ResultCode !== 1) {
      const codes = envelope.ErrorCodes?.map(e => e.Code).join(', ') || 'Unknown';
      throw new Error(`DingConnect GetBalance failed (ResultCode ${envelope.ResultCode}): ${codes}`);
    }

    return {
      AccountBalance: Number(envelope.Balance) || 0,
      CurrencyCode: envelope.CurrencyIso || 'USD',
    };
  }

  /**
   * Get list of available products
   * GET /api/V1/GetProducts
   * When accountNumber is provided, DingConnect will return products for the detected operator
   */
  async getProducts(params?: GetProductsParams): Promise<DingConnectProduct[]> {
    const query = new URLSearchParams();
    if (params?.providerCode) query.append('ProviderCode', params.providerCode);
    if (params?.countryIso) query.append('CountryIso', params.countryIso);
    if (params?.regionCode) query.append('RegionCode', params.regionCode);
    if (params?.accountNumber) query.append('AccountNumber', params.accountNumber);

    const queryString = query.toString();
    const endpoint = queryString ? `/api/V1/GetProducts?${queryString}` : '/api/V1/GetProducts';

    return this.request<DingConnectProduct[]>(endpoint);
  }

  /**
   * Get list of available providers/operators
   * GET /api/V1/GetProviders
   * When accountNumber is provided, DingConnect will return only the matching provider
   */
  async getProviders(params?: GetProvidersParams): Promise<DingConnectProvider[]> {
    const query = new URLSearchParams();
    if (params?.countryIso) query.append('CountryIso', params.countryIso);
    if (params?.regionCode) query.append('RegionCode', params.regionCode);
    if (params?.accountNumber) query.append('AccountNumber', params.accountNumber);

    const queryString = query.toString();
    const endpoint = queryString ? `/api/V1/GetProviders?${queryString}` : '/api/V1/GetProviders';

    return this.request<DingConnectProvider[]>(endpoint);
  }

  /**
   * Estimate prices for send or receive values
   * POST /api/V1/EstimatePrices
   * Accepts array of estimation requests
   */
  async estimatePrices(params: Array<{
    SkuCode: string;
    SendValue?: number;
    SendCurrencyIso?: string;
    ReceiveValue?: number;
    ReceiveCurrencyIso?: string;
    BatchItemRef?: string;
  }>): Promise<Array<{
    SkuCode: string;
    SendValue: number;
    SendCurrencyIso: string;
    ReceiveValue: number;
    ReceiveCurrencyIso: string;
    Fee: number;
    BatchItemRef?: string;
    Price?: {
      CustomerFee: number;
      DistributorFee: number;
      ReceiveValue: number;
      ReceiveCurrencyIso: string;
      ReceiveValueExcludingTax: number;
      TaxRate: number;
      SendValue: number;
      SendCurrencyIso: string;
    };
  }>> {
    return this.request('/api/V1/EstimatePrices', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Send a transfer/top-up
   * POST /api/V1/SendTransfer
   */
  async sendTransfer(params: SendTransferRequest): Promise<SendTransferResponse> {
    return this.request<SendTransferResponse>('/api/V1/SendTransfer', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Get transfer status
   * GET /api/V1/GetTransferStatus
   */
  async getTransferStatus(transferId: number): Promise<SendTransferResponse> {
    return this.request<SendTransferResponse>(`/api/V1/GetTransferStatus?TransferId=${transferId}`);
  }

  /**
   * Validate a transfer without actually sending it
   */
  async validateTransfer(params: Omit<SendTransferRequest, 'ValidateOnly'>): Promise<{
    valid: boolean;
    error?: string;
  }> {
    try {
      await this.sendTransfer({
        ...params,
        ValidateOnly: true,
      });
      return { valid: true };
    } catch (error: any) {
      return {
        valid: false,
        error: error.message,
      };
    }
  }

  /**
   * Lookup account/operator for a phone number
   * GET /api/V1/GetAccountLookup
   */
  async lookupAccount(params: LookupAccountParams): Promise<AccountLookupResponse> {
    const query = new URLSearchParams();
    query.append('AccountNumber', params.accountNumber);
    if (params.countryIso) query.append('CountryIso', params.countryIso);
    if (params.providerCode) query.append('ProviderCode', params.providerCode);

    return this.request<AccountLookupResponse>(`/api/V1/GetAccountLookup?${query.toString()}`);
  }

  /**
   * Get localized product descriptions
   * GET /api/V1/GetProductDescriptions
   */
  async getProductDescriptions(params?: GetProductDescriptionsParams): Promise<DingConnectProductDescription[]> {
    const query = new URLSearchParams();
    if (params?.skuCodes) {
      for (const code of params.skuCodes) {
        query.append('skuCodes', code);
      }
    }
    if (params?.languageCodes) {
      for (const lang of params.languageCodes) {
        query.append('languageCodes', lang);
      }
    }

    const queryString = query.toString();
    const endpoint = queryString
      ? `/api/V1/GetProductDescriptions?${queryString}`
      : '/api/V1/GetProductDescriptions';

    return this.request<DingConnectProductDescription[]>(endpoint);
  }

  /**
   * Test the connection to DingConnect
   */
  async testConnection(): Promise<{
    success: boolean;
    balance?: number;
    currency?: string;
    error?: string;
  }> {
    try {
      const balance = await this.getBalance();
      return {
        success: true,
        balance: balance.AccountBalance,
        currency: balance.CurrencyCode,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

/**
 * Create a DingConnect service instance from integration credentials
 */
export function createDingConnectService(credentials: { apiKey: string }): DingConnectService {
  return new DingConnectService({
    apiKey: credentials.apiKey,
  });
}
