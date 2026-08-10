# CLAUDE.md

KmCrLGmEfVJ6LcSgMMA2pS

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a prepaid minutes/mobile top-up platform built with Next.js 15 and MongoDB. The application allows organizations to manage prepaid mobile services, process transactions, and integrate with payment providers and mobile top-up services (like DingConnect).

## Development Commands

### Essential Commands

- `yarn dev` - Start the development server with Turbopack
- `yarn build` - Build the production application with Turbopack
- `yarn start` - Start the production server
- `yarn lint` - Run ESLint
- `yarn typecheck` - Run TypeScript type checking across all packages

### Package Manager

This project uses **Yarn 1.22.22**. Always use `yarn` commands, not `npm`.

## Architecture Overview

### Monorepo Structure

This is a Yarn workspaces monorepo with the following organization:

```
apps/
  web/          # Main Next.js application (currently at root level)
packages/
  db/           # Database models and connection (@topupsend/db)
  types/        # Shared TypeScript types and enums (@topupsend/types)
  ui/           # Shared UI components (@topupsend/ui)
```

### TypeScript Path Aliases

Configured in root `tsconfig.json`:

- `@/*` - Root src directory
- `@topupsend/db` - Database package
- `@topupsend/types` - Types package
- `@topupsend/ui` - UI components package

### Application Structure

**Next.js App Router** (located in `src/`):

- `src/app/` - App Router pages and layouts
  - `api/` - API routes with versioning (currently v1)
  - `dashboard/` - Dashboard pages
  - `login/`, `signup/` - Authentication pages
- `src/lib/` - Utility libraries
  - `auth.ts` - JWT token management using jose library
  - `auth-middleware.ts` - Authentication middleware for API routes
  - `api-error.ts`, `api-response.ts` - Standardized API patterns
  - `logger.ts` - Logging utilities
- `src/middleware.ts` - Next.js middleware for request handling, CORS, and request IDs
- `src/components/` - React components

### Database Package (`packages/db/`)

**Connection Management:**

- Uses singleton pattern (`DatabaseConnection` class)
- Mongoose with connection pooling (default: 10 max, 2 min)
- Environment variables: `MONGODB_URI` and `MONGODB_DB_NAME`

**Models:** (all exported from `packages/db/src/index.ts`)

- `User` - User authentication and roles
- `Org` - Organization/tenant data (legacy model)
- `Organization` - Extended organization model with settings and subscription
- `UserOrganization` - Junction table for multi-tenant support (users can belong to multiple orgs)
- `Customer` - Customer information
- `Product` - Product catalog with resale settings (discounts, country restrictions, pricing)
- `Transaction` - Transaction records for customer orders
- `Integration` - Third-party integrations (DingConnect, Reloadly)
- `Wallet` - Organization wallet for balance management
- `WalletTransaction` - Wallet transaction history (deposits, purchases, refunds)
- `PaymentProvider` - Payment provider configurations (Stripe, PayPal, PGPay)

### Types Package (`packages/types/`)

**Enums exported:**

- `UserRole` - admin, operator, viewer
- `TransactionStatus` - created, payment_pending, confirmed, failed, refunded, etc.
- `PaymentProvider` - stripe, paypal, pgpay
- `PaymentStatus` - pending, authorized, captured, failed, refunded
- `WebhookEventStatus` - pending, processing, processed, failed
- `AuditAction` - create, update, delete, login, topup_request, etc.

### API Structure

**Version:** v1 (located in `src/app/api/v1/`)

**Endpoints:**

**Authentication & Organizations:**
- `/api/v1/auth` - Authentication (login, signup, logout, me)
- `/api/v1/organizations` - List user's organizations (multi-tenant)
- `/api/v1/organizations/create` - Create a new organization
- `/api/v1/organizations/switch` - Switch active organization context
- `/api/v1/organizations/invite` - Invite users to an organization (admin only)
- `/api/v1/organizations/members` - List members of an organization
- `/api/v1/organization` - Organization settings

**Products & Catalog:**
- `/api/v1/products` - Product catalog management (CRUD)
- `/api/v1/products/[id]` - Get, update, delete specific product
- `/api/v1/products/sync` - Sync products from DingConnect or Reloadly

**Wallet & Payments:**
- `/api/v1/wallet` - Get wallet details, update settings
- `/api/v1/wallet/deposit` - Add funds to wallet
- `/api/v1/wallet/transactions` - Wallet transaction history

**Integrations:**
- `/api/v1/integrations` - Integration management (DingConnect, Reloadly)
- `/api/v1/integrations/test` - Test integration connection

**Customers & Transactions:**
- `/api/v1/customers` - Customer management
- `/api/v1/dashboard` - Dashboard metrics and analytics

**Health Checks:**
- `/api/health`, `/api/live`, `/api/ready` - Health check endpoints

**API Patterns:**

- All API routes return standardized responses using `api-response.ts`
- Errors use `ApiError` class with status codes
- Authentication via JWT stored in HttpOnly cookies
- Request IDs automatically added for tracing (via middleware)

### Authentication Flow

1. **Password hashing:** bcrypt with salt rounds = 10
2. **Token generation:** JWT using `jose` library (HS256 algorithm)
3. **Session storage:** HttpOnly cookies with 7-day expiration
4. **Token verification:** `verifyToken()` from `src/lib/auth.ts`
5. **Protected routes:** Use `auth-middleware.ts` in API route handlers

**Session Payload Structure:**

```typescript
{
  userId: string;
  email: string;
  roles: UserRole[];
  orgId: string;
}
```

## Environment Configuration

See `.env.example` for all required environment variables:

**Required:**

- `MONGODB_URI` - MongoDB connection string
- `MONGODB_DB_NAME` - Database name (default: topupsend)
- `JWT_SECRET` - Secret for JWT signing
- `JWT_EXPIRES_IN` - Token expiration (default: 7d)
- `NODE_ENV` - development/production
- `ALLOWED_ORIGIN` - CORS origin

**Future Integration Variables** (commented in .env.example):

- DingConnect API credentials (Phase 2)
- Payment provider credentials: Stripe, PayPal, PGPay (Phase 3)

## Development Workflow

### Database Connection

Database connection must be established before accessing models. The singleton pattern ensures only one connection:

```typescript
import { dbConnection } from "@topupsend/db";
await dbConnection.connect();
```

### Adding New API Routes

1. Create route handler in `src/app/api/v1/{endpoint}/route.ts`
2. Use `auth-middleware.ts` for protected routes
3. Return responses using `api-response.ts` helpers
4. Handle errors with `ApiError` class

### Adding New Models

1. Create model in `packages/db/src/models/`
2. Export from `packages/db/src/index.ts`
3. Define TypeScript interfaces
4. Use Mongoose schemas with timestamps

### Working with Types

Import shared types from `@topupsend/types`:

```typescript
import { UserRole, TransactionStatus } from "@topupsend/types";
```

## Code Quality

### Pre-commit Hooks

Husky is configured for git hooks (check `.husky/` directory)

### Linting & Type Checking

- Run `yarn lint` before committing
- Run `yarn typecheck` to catch TypeScript errors across all packages
- ESLint configured with Next.js rules

### TypeScript Best Practices

**ALWAYS prioritize strong typing for better autocomplete, type safety, and developer experience.**

#### 1. Export All Interfaces and Types

Always export interfaces and types from their source files, even if they're only used internally at first. This enables reuse and prevents duplication.

**Good:**
```typescript
// src/lib/services/dingconnect.service.ts
export interface DingConnectProduct {
  SkuCode: string;
  ProductId: number;
  ProviderCode: string;
  CountryIso: string;
  // ... more fields
}

export interface DingConnectProvider {
  ProviderCode: string;
  ProviderName: string;
  LogoUrl?: string;
}
```

**Bad:**
```typescript
// Inline types that can't be reused
function getProducts(): Promise<{
  SkuCode: string;
  ProductId: number;
  // ...
}[]> {
  // ...
}
```

#### 2. Create Centralized Type Files for API Responses

When an API endpoint has complex request/response shapes, create a dedicated type file in `src/types/`:

**Example:** `src/types/phone-lookup.ts`
```typescript
export interface PhoneLookupRequest {
  phoneNumber: string;
  orgSlug: string;
}

export interface PhoneLookupResponse {
  phoneNumber: string;
  country: CountryInfo;
  detectedOperator: OperatorInfo | null;
  operators: OperatorInfo[];
  products: ProductInfo[];
  totalProducts: number;
  branding: BrandingInfo;
  discount: DiscountInfo | null;
}

export interface ProductInfo {
  skuCode: string;
  name: string;
  providerCode: string;
  providerName: string;
  benefitType: 'airtime' | 'data' | 'voice' | 'sms' | 'bundle';
  // ... more fields
}
```

This enables both frontend and backend to share the same types:
```typescript
// Backend
import type { PhoneLookupRequest, PhoneLookupResponse } from '@/types/phone-lookup';

export async function POST(request: NextRequest) {
  const body: PhoneLookupRequest = await request.json();
  // TypeScript knows exactly what fields are available
  const { phoneNumber, orgSlug } = body;

  // Return typed response
  return createSuccessResponse<PhoneLookupResponse>({
    phoneNumber,
    country: { code: 'HT', name: 'Haiti' },
    // ... autocomplete works perfectly
  });
}

// Frontend
import type { PhoneLookupResponse } from '@/types/phone-lookup';

const response = await fetch('/api/v1/lookup/phone', {
  method: 'POST',
  body: JSON.stringify({ phoneNumber, orgSlug }),
});

const data: PhoneLookupResponse = await response.json();
// Full autocomplete for data.country, data.operators, etc.
```

#### 3. Use Typed Parameters Instead of Inline Objects

Define parameter interfaces for functions with complex options:

**Good:**
```typescript
export interface GetProvidersParams {
  countryIso?: string;
  regionCode?: string;
  accountNumber?: string;
}

async getProviders(params?: GetProvidersParams): Promise<DingConnectProvider[]> {
  // Implementation
}
```

**Bad:**
```typescript
async getProviders(params?: {
  countryIso?: string;
  regionCode?: string;
  accountNumber?: string;
}): Promise<DingConnectProvider[]> {
  // Inline type makes it harder to reuse and document
}
```

#### 4. Leverage Type Inference but Add Explicit Types for Public APIs

Let TypeScript infer types for local variables, but always add explicit types for:
- Function parameters
- Function return types
- Exported constants
- API request/response bodies

**Good:**
```typescript
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body: PhoneLookupRequest = await request.json();

  // Local variable - inference is fine
  const parsedPhone = parsePhoneNumber(phoneNumber);
  const detectedCountry = parsedPhone.regionCode || '';

  return createSuccessResponse<PhoneLookupResponse>({
    phoneNumber: cleanPhone,
    country: { code: detectedCountry, name: countryName },
  });
}
```

#### 5. Use Union Types for String Literals

Instead of accepting `string` for fields with known values, use union types:

**Good:**
```typescript
export interface ProductInfo {
  benefitType: 'airtime' | 'data' | 'voice' | 'sms' | 'bundle';
}

// TypeScript will autocomplete and validate
const product: ProductInfo = {
  benefitType: 'airtime', // ✓ Valid
  // benefitType: 'invalid', // ✗ Type error
};
```

**Bad:**
```typescript
export interface ProductInfo {
  benefitType: string; // Too loose, no autocomplete
}
```

#### 6. Optional vs Required Fields

Be explicit about what's optional vs required:

```typescript
export interface OperatorInfo {
  code: string;        // Required
  name: string;        // Required
  logo?: string;       // Optional - use ? for optional fields
}

// When all providers might not have logos
const operator: OperatorInfo = {
  code: 'DIGICEL',
  name: 'Digicel Haiti',
  // logo is optional, so this is valid
};
```

#### 7. Type Third-Party API Responses

Always create comprehensive types for third-party API responses (DingConnect, payment providers, etc.):

```typescript
// src/lib/services/dingconnect.service.ts

// Support both old and new API response formats
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

  // Old format - fixed-value products
  Price?: DingConnectPrice;
  BenefitTypes?: {
    Airtime?: DingConnectBenefitValue;
    Data?: DingConnectBenefitValue;
  };

  // New format - variable-value products
  Minimum?: DingConnectMinMax;
  Maximum?: DingConnectMinMax;
  Benefits?: string[];
}
```

#### 8. Use Strict TypeScript Configuration

Ensure `tsconfig.json` has strict mode enabled:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

#### 9. Avoid `any` Type

Use `unknown` instead of `any` when the type is truly unknown, then narrow it with type guards:

**Good:**
```typescript
try {
  const data = await response.json();
  // Validate the structure before using
  if (isValidProduct(data)) {
    const product: DingConnectProduct = data;
  }
} catch (error: unknown) {
  // Narrow the type before using
  if (error instanceof Error) {
    logger.error('Error message:', error.message);
  }
}
```

**Bad:**
```typescript
catch (error: any) {
  // Can call any property without type checking
  logger.error(error.message);
}
```

#### 10. Document Complex Types

Add JSDoc comments for complex types to provide context:

```typescript
/**
 * Product information returned from phone lookup API.
 * Includes pricing breakdown and availability details.
 */
export interface ProductInfo {
  skuCode: string;

  /** Display name of the product */
  name: string;

  /** Type of benefit: airtime, data, voice, sms, or bundle */
  benefitType: 'airtime' | 'data' | 'voice' | 'sms' | 'bundle';

  /** Detailed pricing breakdown including markup and discounts */
  pricing: PricingBreakdown;

  /** True if this is a variable-value product (custom amounts) */
  isVariableValue: boolean;
}
```

#### Type Organization Guidelines

1. **Shared domain types** → `packages/types/src/` (UserRole, TransactionStatus, etc.)
2. **API request/response types** → `src/types/` (phone-lookup.ts, wallet.ts, etc.)
3. **Service-specific types** → Co-located with service (`dingconnect.service.ts`)
4. **Component prop types** → Co-located with component or in `src/types/` if reused
5. **Database model types** → Co-located with Mongoose schemas in `packages/db/src/models/`

#### Benefits of Strong Typing

- **Autocomplete:** IDEs provide accurate suggestions
- **Refactoring:** Rename and restructure with confidence
- **Documentation:** Types serve as inline documentation
- **Bug Prevention:** Catch errors at compile time, not runtime
- **API Contracts:** Frontend and backend stay in sync

### Code Reusability & DRY Principles

**ALWAYS prioritize reusable, maintainable code. Avoid duplication at all costs.**

#### 1. Eliminate Duplicate Logic

When you find yourself writing similar code twice, refactor immediately.

**Bad - Duplicate API Calls:**
```typescript
// First call
let providers;
try {
  providers = await dingService.getProviders({
    countryIso: detectedCountry,
  });
} catch (error: any) {
  logger.error('Failed to fetch providers', { error: error.message });
  throw error;
}

// Later in the code - DUPLICATE!
let detectedProviders;
try {
  detectedProviders = await dingService.getProviders({
    countryIso: detectedCountry,
    accountNumber: cleanPhone,
  });
} catch (error: any) {
  logger.error('Failed to detect provider', { error: error.message });
}
```

**Good - Parallel Execution, Single Source:**
```typescript
// Fetch both in parallel - no duplication
const [allProviders, detectedProviders] = await Promise.all([
  // Get all providers for this country
  dingService.getProviders({ countryIso: detectedCountry }),
  // Attempt to detect operator from phone number
  dingService.getProviders({
    countryIso: detectedCountry,
    accountNumber: cleanPhone
  }).catch(error => {
    logger.warn('Operator detection failed', { error: error.message });
    return []; // Graceful degradation
  })
]);
```

#### 2. Use Promise.all() for Parallel Operations

When operations are independent, run them in parallel for better performance.

**Bad - Sequential (Slower):**
```typescript
const providers = await dingService.getProviders({ countryIso });
const products = await dingService.getProducts({ countryIso });
const balance = await dingService.getBalance();
// Total time: sum of all requests
```

**Good - Parallel (Faster):**
```typescript
const [providers, products, balance] = await Promise.all([
  dingService.getProviders({ countryIso }),
  dingService.getProducts({ countryIso }),
  dingService.getBalance(),
]);
// Total time: longest request duration
```

#### 3. Extract Reusable Helper Functions

If a piece of logic is used more than once, extract it.

**Bad - Repeated Logic:**
```typescript
// In multiple places
const providerCodes1 = providers1.map(p => p.ProviderCode).join(',');
// Later...
const providerCodes2 = providers2.map(p => p.ProviderCode).join(',');
```

**Good - Extracted Helper:**
```typescript
// Helper function
function joinProviderCodes(providers: DingConnectProvider[]): string {
  return providers.map(p => p.ProviderCode).join(',');
}

// Usage
const providerCodes1 = joinProviderCodes(providers1);
const providerCodes2 = joinProviderCodes(providers2);
```

#### 4. Graceful Error Handling

Use `.catch()` inline for non-critical operations instead of try/catch blocks.

**Bad - Verbose Try/Catch:**
```typescript
let detectedProvider = null;
try {
  const result = await optionalOperation();
  detectedProvider = result;
} catch (error) {
  logger.warn('Optional operation failed');
  // Continue without it
}
```

**Good - Inline Catch:**
```typescript
const detectedProvider = await optionalOperation().catch(error => {
  logger.warn('Optional operation failed', { error: error.message });
  return null; // Default value
});
```

#### 5. Avoid Magic Numbers and Strings

Use constants with meaningful names.

**Bad:**
```typescript
const limitedProducts = products.slice(0, 100);
if (retryCount > 3) return;
```

**Good:**
```typescript
const MAX_PRODUCTS_PER_PAGE = 100;
const MAX_RETRY_ATTEMPTS = 3;

const limitedProducts = products.slice(0, MAX_PRODUCTS_PER_PAGE);
if (retryCount > MAX_RETRY_ATTEMPTS) return;
```

#### 6. Single Responsibility Principle

Each function should do one thing well.

**Bad - Function Doing Too Much:**
```typescript
async function processLookup(phone: string) {
  // Validates phone
  if (!phone) throw new Error('Invalid');

  // Fetches providers
  const providers = await getProviders();

  // Fetches products
  const products = await getProducts();

  // Calculates pricing
  const withPricing = products.map(p => calculatePrice(p));

  // Filters results
  return withPricing.filter(p => p.price > 0);
}
```

**Good - Separated Concerns:**
```typescript
async function validatePhoneNumber(phone: string): void {
  if (!phone) throw new Error('Invalid phone number');
}

async function fetchProvidersAndProducts(countryIso: string) {
  return Promise.all([
    getProviders({ countryIso }),
    getProducts({ countryIso }),
  ]);
}

function applyPricingToProducts(products: Product[]): ProductWithPricing[] {
  return products.map(calculatePrice);
}

// Main function orchestrates
async function processLookup(phone: string) {
  validatePhoneNumber(phone);
  const [providers, products] = await fetchProvidersAndProducts(countryIso);
  return applyPricingToProducts(products).filter(p => p.price > 0);
}
```

#### 7. Early Returns to Reduce Nesting

**Bad - Deep Nesting:**
```typescript
if (data) {
  if (data.items) {
    if (data.items.length > 0) {
      return data.items[0];
    } else {
      return null;
    }
  } else {
    return null;
  }
} else {
  return null;
}
```

**Good - Early Returns:**
```typescript
if (!data) return null;
if (!data.items) return null;
if (data.items.length === 0) return null;

return data.items[0];
```

#### 8. Use Array Methods Wisely

Chain array methods for clarity, but don't overdo it.

**Good - Clear Intent:**
```typescript
const detectedProducts = products
  .filter(p => detectedProviderCodes.includes(p.providerCode))
  .sort((a, b) => a.price - b.price)
  .slice(0, 10);
```

**Bad - Inefficient:**
```typescript
// Filtering twice when once would suffice
const filtered = products.filter(p => p.active);
const detectedOnly = filtered.filter(p => detectedProviderCodes.includes(p.providerCode));
```

**Better:**
```typescript
const detectedProducts = products.filter(p =>
  p.active && detectedProviderCodes.includes(p.providerCode)
);
```

#### Code Quality Checklist

Before committing code, ask yourself:

- ✅ **DRY:** Am I repeating any logic that could be extracted?
- ✅ **Readability:** Would another developer understand this in 6 months?
- ✅ **Performance:** Can any operations run in parallel?
- ✅ **Error Handling:** Are errors handled gracefully?
- ✅ **Types:** Are all types explicit and reusable?
- ✅ **Constants:** Are magic numbers/strings extracted?
- ✅ **Single Responsibility:** Does each function do one thing?
- ✅ **Early Returns:** Can I reduce nesting with early returns?

### User Notifications

**NEVER use `alert()`, `confirm()`, or `prompt()` - Use Toast Notifications Instead**

The application uses a custom toast notification system for all user feedback:

**Import:**
```typescript
import { toast } from '@topupsend/ui';
```

**Usage:**
```typescript
// Success notification
toast({
  title: 'Success',
  description: 'Operation completed successfully!',
  variant: 'success',
});

// Error notification
toast({
  title: 'Error',
  description: 'Something went wrong. Please try again.',
  variant: 'error',
});

// Warning notification
toast({
  title: 'Warning',
  description: 'This action requires confirmation.',
  variant: 'warning',
});

// Default notification
toast({
  title: 'Info',
  description: 'Here is some information.',
  variant: 'default',
});

// Custom duration (default is 4000ms, 0 means no auto-dismiss)
toast({
  title: 'Persistent',
  description: 'This will stay until manually closed.',
  duration: 0,
});
```

**Toast Component Location:**
- Component: `packages/ui/src/components/toast.tsx`
- Hook: `packages/ui/src/hooks/use-toast.tsx`
- Provider: `src/components/toast-provider.tsx` (already added to root layout)

**Available Variants:**
- `success` - Green toast for successful operations
- `error` - Red toast for errors and failures
- `warning` - Yellow toast for warnings
- `default` - Default styling for general information

**Best Practices:**
- Always provide both `title` and `description` for clarity
- Use appropriate variants for different types of feedback
- Keep descriptions concise and actionable
- Toast notifications auto-dismiss after 4 seconds (customizable)
- Multiple toasts can be shown simultaneously (max 5)
- Toasts appear in the top-right corner of the screen

### Analytics & Session Replay (PostHog)

**PostHog Integration** for product analytics, error tracking, and session replay

The application uses PostHog for:
- **Session Replay** - Watch user sessions to understand behavior and debug issues
- **Error Tracking** - Automatically capture JavaScript errors and exceptions
- **Event Tracking** - Track custom events throughout the application
- **Feature Flags** - A/B testing and feature rollouts
- **User Analytics** - Understand user behavior and product usage

**Configuration:**

Environment variables required:
```bash
NEXT_PUBLIC_POSTHOG_KEY=your-posthog-project-api-key
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com
```

**Import:**
```typescript
import { analytics } from '@/lib/analytics';
```

**Basic Usage:**

```typescript
// Track custom events
analytics.track('button_clicked', {
  button_name: 'signup',
  page: '/landing'
});

// Identify users (call after login)
analytics.identify(user.id, {
  email: user.email,
  role: user.role,
  organizationId: user.orgId,
});

// Reset on logout
analytics.reset();

// Capture errors manually
try {
  // risky operation
} catch (error) {
  analytics.captureError(error, {
    context: 'checkout_flow',
    userId: user.id
  });
  throw error;
}
```

**Convenience Event Methods:**

```typescript
// Authentication events
analytics.events.userSignedUp(userId, { plan: 'free' });
analytics.events.userLoggedIn(userId, { method: 'email' });
analytics.events.userLoggedOut();

// Transaction events
analytics.events.transactionStarted(transactionId, amount, currency);
analytics.events.transactionCompleted(transactionId, amount, currency);
analytics.events.transactionFailed(transactionId, 'insufficient_balance');

// Product events
analytics.events.productViewed(productId, { category: 'mobile-topup' });
analytics.events.productSelected(productId, { provider: 'Digicel' });

// Wallet events
analytics.events.walletDeposit(amount, currency);
analytics.events.walletWithdrawal(amount, currency);

// Organization events
analytics.events.organizationCreated(orgId, orgName);
analytics.events.organizationSwitched(orgId, orgName);

// Integration events
analytics.events.integrationConnected('dingconnect');
analytics.events.integrationDisconnected('stripe');

// API errors
analytics.events.apiError('/api/v1/products', 500, 'Internal server error');
```

**Advanced Features:**

```typescript
// Set properties sent with every event
analytics.setSuperProperties({
  app_version: '1.0.0',
  environment: 'production'
});

// Feature flags
if (analytics.isFeatureEnabled('new_checkout_flow')) {
  // Show new checkout UI
}

// Control session recording
analytics.setSessionRecording(false); // Pause recording
analytics.setSessionRecording(true);  // Resume recording
```

**Privacy & Security:**

PostHog is configured to:
- Mask all input fields by default (`maskAllInputs: true`)
- Mask elements with `data-private` attribute
- Sanitize sensitive properties (passwords, tokens, API keys)
- Only create user profiles for identified users
- Record console logs and network requests for debugging

**Integration Points:**

1. **Provider:** `src/components/posthog-provider.tsx` - Wraps the entire app
2. **Utility:** `src/lib/analytics.ts` - Clean API for tracking
3. **Auto-tracking:** Page views, errors, and unhandled promise rejections

**Best Practices:**
- Always call `analytics.identify()` after user login
- Always call `analytics.reset()` on logout
- Track meaningful user actions (not every click)
- Add context to error captures
- Use the convenience methods for common events
- Never track sensitive data (passwords, credit cards, etc.)

## Key Dependencies

- **Next.js 15.5.6** - App Router with Turbopack
- **React 19.1.0** - Latest React version
- **Mongoose 8.1.0** - MongoDB ODM
- **jose 5.2.0** - JWT implementation
- **bcryptjs 2.4.3** - Password hashing
- **Zod 3.22.4** - Schema validation
- **Tailwind CSS 4** - Styling
- **recharts** - Charts for dashboard
- **date-fns** - Date utilities
- **lucide-react** - Icons
- **posthog-js** - Analytics, session replay, and error tracking

## Multi-Tenant Architecture

This application supports true multi-tenancy where users can belong to multiple organizations:

### Data Model

- **UserOrganization** junction table links users to organizations with specific roles
- Users can have different roles in different organizations
- Session tokens include the active `orgId` for the current context
- All data queries should be scoped by `orgId` from the session

### Creating Organizations

1. **Create New Org:** `POST /api/v1/organizations/create` with `{ name, switchToNew? }`
2. **Automatic Setup:** Creator becomes admin and `UserOrganization` record is created
3. **Optional Switch:** `switchToNew` parameter (default: true) switches to the new org immediately
4. **UI:** "Create New Organization" button in the `OrganizationSwitcher` dropdown opens a dialog

### Organization Switching

1. **List Organizations:** `GET /api/v1/organizations` returns all orgs the user belongs to
2. **Switch Context:** `POST /api/v1/organizations/switch` with `{ orgId }` updates the session
3. **UI Component:** `OrganizationSwitcher` component in sidebar shows dropdown of all user's organizations
4. **Session Updates:** Switching orgs creates a new JWT with updated `orgId` and organization-specific `roles`

### Inviting Users

1. **Invite API:** `POST /api/v1/organizations/invite` with `{ email, roles, orgId? }`
2. **Admin Only:** Only users with admin role can invite others to the organization
3. **Existing Users:** Users must already have an account (signup first)
4. **Member Management:** View members at `/dashboard/settings/members` or `GET /api/v1/organizations/members`
5. **Reactivation:** Inviting an inactive member reactivates their membership

### Implementation Notes

- On signup, a `UserOrganization` record is automatically created
- The session payload includes `orgId` which must be used to scope all database queries
- Users can create unlimited organizations and belong to multiple organizations
- Users can invite existing users to their organizations (admin role required)
- The `isCurrent` flag in the organizations list indicates the active organization
- Switching organizations triggers a page refresh to reload data in the new context
- Creating an organization and switching to it happens atomically with a new session token

## Prepaid Minutes Resale Platform Architecture

### Overview

This platform enables organizations to:
1. **Fund their account** via wallet deposits
2. **Sync products** from DingConnect or Reloadly (mobile operators worldwide)
3. **Configure resale settings** with custom pricing, discounts, and country restrictions
4. **Integrate payment providers** (PGPay, PayPal, Stripe) for customer payments
5. **Sell prepaid minutes** through a customer-facing portal
6. **Process top-ups** automatically via DingConnect/Reloadly APIs

### Wallet System

**Purpose:** Organizations must fund their account before they can process customer top-ups.

**Models:**
- `Wallet` - Tracks organization balance, reserved balance, and available balance
- `WalletTransaction` - Audit trail of all wallet activities (deposits, purchases, refunds)

**Balance Types:**
- `balance` - Total funds in wallet
- `reservedBalance` - Amount reserved for pending transactions
- `availableBalance` - `balance - reservedBalance` (what can be spent)

**Wallet Methods:**
- `hasAvailableBalance(amount)` - Check if sufficient funds
- `reserve(amount)` - Reserve funds for a pending transaction
- `releaseReservation(amount)` - Release reserved funds
- `deduct(amount, reserved)` - Deduct from balance (optionally from reserved)
- `deposit(amount)` - Add funds to wallet

**API Endpoints:**
- `GET /api/v1/wallet` - Get wallet details
- `PATCH /api/v1/wallet` - Update wallet settings (low balance threshold, auto-reload)
- `POST /api/v1/wallet/deposit` - Add funds (manual for now, payment provider integration coming)
- `GET /api/v1/wallet/transactions` - Transaction history with pagination

### Product Catalog & Resale Settings

**Product Sync:**

Organizations can sync products from DingConnect or Reloadly using:
```
POST /api/v1/products/sync
{
  "provider": "dingconnect" | "reloadly",
  "filters": {
    "countryIso": "PG",  // Optional
    "providerCode": "DIGICEL_PNG"  // Optional
  }
}
```

The sync process:
1. Fetches products from provider API
2. Creates or updates products in local catalog
3. Sets default 10% markup on cost price
4. Enables auto-sync for future updates

**Resale Configuration:**

Each product has a `resaleSettings` object that controls:

1. **Country Restrictions:**
   - `allowedCountries` - ISO codes of countries where product can be sold (empty = all)
   - `blockedCountries` - ISO codes of countries to block

2. **Custom Pricing:**
   - `customPricing.enabled` - Enable country-specific pricing
   - `customPricing.priceByCountry` - Map of country code to custom price

3. **Discounts:**
   - `discount.enabled` - Enable discount
   - `discount.type` - 'percentage' or 'fixed'
   - `discount.value` - Discount amount
   - `discount.startDate` / `endDate` - Optional time bounds
   - `discount.minPurchaseAmount` - Minimum purchase to qualify

4. **Purchase Limits:**
   - `limits.minQuantity` - Minimum purchase quantity
   - `limits.maxQuantity` - Maximum purchase quantity
   - `limits.maxPerCustomer` - Maximum per customer per day

**Product Methods:**
- `getEffectivePrice(countryCode?)` - Calculate final price with discounts and country pricing
- `isAvailableInCountry(countryCode)` - Check if product can be sold in country
- `validateQuantity(quantity)` - Validate quantity against limits

### DingConnect Integration

**Service Location:** `src/lib/services/dingconnect.service.ts`

**Configuration:** Only requires API key (simplified setup)

**Available Methods:**
- `getBalance()` - Check account balance
- `getProducts(filters?)` - Fetch available products
- `getProviders(filters?)` - Fetch operators/providers
- `estimatePrices(params)` - Estimate transfer costs
- `sendTransfer(params)` - Execute top-up
- `validateTransfer(params)` - Validate before sending
- `testConnection()` - Test API credentials

**Product Sync Flow:**
1. Fetch products from DingConnect API
2. Fetch operators for additional metadata
3. Map DingConnect products to internal Product model
4. Set cost price from DingConnect, calculate sell price with markup
5. Track sync status and errors

### Payment Provider Integration

**Model:** `PaymentProvider`

**Supported Providers:**
- Stripe - Credit/debit cards
- PayPal - PayPal accounts
- PGPay - Papua New Guinea payment gateway

**Configuration:**
- Each provider requires specific credentials (API keys, secrets, etc.)
- Supports sandbox and production environments
- Can set currency restrictions, min/max amounts
- Optional platform fees (percentage + fixed)

**Settings:**
- `acceptedCurrencies` - Which currencies to accept
- `feePercentage` - Platform fee as percentage
- `fixedFee` - Fixed fee per transaction
- `autoCapture` - Automatically capture authorized payments

### Transaction Processing Flow

**Customer Purchase Flow:**

1. **Customer selects product** from customer-facing portal
2. **Country validation** - Check if product available in customer's country
3. **Price calculation** - `product.getEffectivePrice(countryCode)` with discounts
4. **Payment processing** - Customer pays via configured payment provider
5. **Wallet reservation** - Reserve cost price from organization wallet
6. **Top-up execution** - Call DingConnect/Reloadly API to deliver top-up
7. **Transaction completion:**
   - Deduct reserved amount from wallet
   - Update product sales metrics
   - Create transaction record
8. **Error handling:**
   - Release wallet reservation on failure
   - Initiate refund if payment captured
   - Log failure reason

**Transaction Status Flow:**
```
pending -> paid -> processing -> completed
                              -> failed -> refunded
```

### Integration Testing

**DingConnect Test:**
```
POST /api/v1/integrations/test
{
  "provider": "dingconnect",
  "credentials": { "apiKey": "your-key" }
}
```

Returns balance and currency if successful.

### Data Isolation & Security

**Multi-Tenant Scoping:**
- All database queries MUST include `orgId: session.orgId`
- Wallets are per-organization
- Products are per-organization (different orgs can have different pricing)
- Payment providers are per-organization

**Wallet Security:**
- Only active wallets can process transactions
- Balance reservation prevents double-spending
- Audit trail in `WalletTransaction` for all operations
- Low balance warnings configurable

## Notes

- This is a multi-tenant application with full support for users belonging to multiple organizations
- Organizations fund their wallet, sync products, and resell prepaid minutes with custom pricing
- DingConnect integration simplified to only require API key
- Product sync imports operator products and allows customization for resale
- Payment providers can be configured per organization for customer payments
- All API routes are versioned (currently v1) for future compatibility
- The middleware adds request IDs to all requests for tracing
- Always scope database queries by `orgId` from the session to ensure proper data isolation
