# TopUpSend

**International mobile top-up platform** — businesses and resellers sell airtime, data, and mobile credit to customers worldwide through branded storefronts and a self-serve API.

## What it is

TopUpSend is a multi-tenant SaaS for mobile top-ups (the product formerly developed as "PG Prepaid"). Each organization gets a dashboard to manage products, pricing, and customers; a public storefront under its own slug (`/storefront`, `/customer-portal/[orgSlug]`) where its customers buy top-ups; and API access with per-organization API docs. Top-ups are fulfilled through external provider integrations (DingConnect and Reloadly — see `AGENTS.md`), and platform subscriptions are billed through PG Pay. The platform supports scheduled/recurring top-ups, discounts, and tiered pricing plans (Starter / Growth / Scale / Enterprise, defined in `AGENTS.md`).

## Key features

- **Organization dashboard** — analytics, transactions, customers, products, and per-country availability
- **Pricing engine** — product pricing management, discounts/promotions, and subscription tiers with feature gating
- **Scheduled top-ups** — recurring top-ups with cron-driven execution (`/dashboard/scheduled-topups`, `SCHEDULED_TOPUPS_*`)
- **Branded storefront + customer portal** — per-organization public storefront and customer portal with its own auth
- **Payments** — checkout flow with success/cancel handling, billing via PG Pay
- **Developer API** — versioned API under `/api/v1`, per-org generated API docs (`/api-docs/[orgSlug]`), webhooks, and integrations pages
- **Team & roles** — team management, audit log views, and role-based permissions (`src/lib/permissions.ts`)
- **PWA** — installable app with offline page and service worker (see `PWA_TESTING_GUIDE.md`)
- **Internationalization** — UI strings in en / es / fr / ht (`src/lib/i18n`)

## Tech stack

- **Framework:** Next.js 15.5 (App Router) · React 19 · TypeScript
- **Data:** MongoDB with Mongoose
- **UI:** Tailwind CSS 4, Radix UI components, lucide-react
- **Email/notifications:** ZeptoMail, SendGrid, Mailgun, Mailchimp Transactional
- **Platform services:** Sentry (errors), PostHog (analytics), node-cron (scheduled jobs)
- **Tests:** Jest + Testing Library

## Getting started

Prerequisites: Node.js 20+ and a MongoDB instance (local or Atlas).

```bash
npm install
npm run dev        # http://localhost:3000
```

### Environment variables

Create `.env.local` with the variables the app reads (names only — supply your own values):

```
MONGODB_URI, MONGODB_DB_NAME (see packages/db),
JWT_SECRET, CUSTOMER_JWT_SECRET, JWT_EXPIRES_IN,
NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_BASE_URL, ALLOWED_ORIGIN,
PGPAY_USER_ID, PGPAY_ENVIRONMENT,
ZEPTOMAIL_API_KEY, ZEPTOMAIL_FROM_EMAIL, ZEPTOMAIL_FROM_NAME,
SCHEDULED_TOPUPS_ENABLED, SCHEDULED_TOPUPS_CRON,
NEXT_PUBLIC_POSTHOG_KEY, NEXT_PUBLIC_POSTHOG_HOST
```

Provider credentials (top-up providers, payment/email services) are configured per the integration settings in the dashboard and `AGENTS.md`.

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / run |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`) |
| `npm test` | Jest test suite |
| `npm run lint` | ESLint |

## Project structure

```
src/app/          App Router routes — landing/pricing, dashboard/*, storefront,
                  customer-portal/[orgSlug], api-docs/[orgSlug], api/v1
src/components/   UI components
src/lib/          Auth, pricing, permissions, services, i18n, scheduled-job logic
apps/web/         Web app workspace
packages/         Shared workspaces: db, types, ui
```

Further reading in-repo: `AGENTS.md` (pricing tiers + feature gating spec), `PRICING_IMPLEMENTATION.md`, `SCHEDULED_TOPUPS_IMPLEMENTATION_SUMMARY.md`, `PGPAY_SUBSCRIPTION.md`, `TESTING.md`.
