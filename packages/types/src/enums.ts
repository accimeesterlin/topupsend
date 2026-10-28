export enum UserRole {
  ADMIN = "admin",
  OPERATOR = "operator",
  VIEWER = "viewer",
  CUSTOMER = "customer",
}

export enum Permission {
  // Dashboard & Analytics
  VIEW_DASHBOARD = "view_dashboard",
  VIEW_ANALYTICS = "view_analytics",

  // Storefront
  VIEW_STOREFRONT_SETTINGS = "view_storefront_settings",
  EDIT_STOREFRONT_SETTINGS = "edit_storefront_settings",

  // Products & Pricing
  VIEW_PRODUCTS = "view_products",
  EDIT_PRODUCTS = "edit_products",
  SYNC_PRODUCTS = "sync_products",
  VIEW_PRICING = "view_pricing",
  EDIT_PRICING = "edit_pricing",

  // Discounts
  VIEW_DISCOUNTS = "view_discounts",
  CREATE_DISCOUNTS = "create_discounts",
  EDIT_DISCOUNTS = "edit_discounts",
  DELETE_DISCOUNTS = "delete_discounts",

  // Countries
  VIEW_COUNTRIES = "view_countries",
  EDIT_COUNTRIES = "edit_countries",

  // Transactions
  VIEW_TRANSACTIONS = "view_transactions",
  PROCESS_TRANSACTIONS = "process_transactions",
  UPDATE_TRANSACTION_STATUS = "update_transaction_status",
  REFUND_TRANSACTIONS = "refund_transactions",

  // Manual Payments (offline payments recorded by staff)
  RECORD_MANUAL_PAYMENT = "record_manual_payment",
  VOID_MANUAL_PAYMENT = "void_manual_payment",

  // Customers
  VIEW_CUSTOMERS = "view_customers",
  EDIT_CUSTOMERS = "edit_customers",

  // Team
  VIEW_TEAM = "view_team",
  INVITE_TEAM = "invite_team",
  EDIT_TEAM = "edit_team",
  REMOVE_TEAM = "remove_team",

  // Integrations
  VIEW_INTEGRATIONS = "view_integrations",
  EDIT_INTEGRATIONS = "edit_integrations",

  // Payment Settings
  VIEW_PAYMENT_SETTINGS = "view_payment_settings",
  EDIT_PAYMENT_SETTINGS = "edit_payment_settings",

  // Wallet
  VIEW_WALLET = "view_wallet",
  DEPOSIT_WALLET = "deposit_wallet",
  EDIT_WALLET_SETTINGS = "edit_wallet_settings",

  // Organization Settings
  VIEW_ORG_SETTINGS = "view_org_settings",
  EDIT_ORG_SETTINGS = "edit_org_settings",

  // Customer Balance Management
  VIEW_CUSTOMER_BALANCE = "view_customer_balance",
  ASSIGN_CUSTOMER_BALANCE = "assign_customer_balance",
  ADJUST_CUSTOMER_BALANCE = "adjust_customer_balance",

  // API Keys
  VIEW_API_KEYS = "view_api_keys",
  CREATE_API_KEYS = "create_api_keys",
  REVOKE_API_KEYS = "revoke_api_keys",
  MANAGE_API_KEYS = "manage_api_keys",
  ADJUST_RATE_LIMITS = "adjust_rate_limits",

  // Webhooks
  VIEW_WEBHOOK_LOGS = "view_webhook_logs",
  REPLAY_WEBHOOKS = "replay_webhooks",

  // Staff Self-Service
  VIEW_OWN_TRANSACTIONS = "view_own_transactions",
  VIEW_OWN_BALANCE = "view_own_balance",
  MANAGE_OWN_API_KEYS = "manage_own_api_keys",
}

export enum TransactionStatus {
  PENDING = "pending",
  PAID = "paid",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
  REFUNDED = "refunded",
}

export enum PaymentProvider {
  STRIPE = "stripe",
  PAYPAL = "paypal",
  PGPAY = "pgpay",
}

export enum PaymentStatus {
  PENDING = "pending",
  AUTHORIZED = "authorized",
  CAPTURED = "captured",
  FAILED = "failed",
  REFUNDED = "refunded",
  PARTIALLY_REFUNDED = "partially_refunded",
}

export enum WebhookEventStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  PROCESSED = "processed",
  FAILED = "failed",
}

export enum AuditAction {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LOGIN = "login",
  LOGOUT = "logout",
  TOPUP_REQUEST = "topup_request",
  TOPUP_SUCCESS = "topup_success",
  TOPUP_FAILURE = "topup_failure",
  PAYMENT_INITIATED = "payment_initiated",
  PAYMENT_COMPLETED = "payment_completed",
  REFUND_INITIATED = "refund_initiated",
  REFUND_COMPLETED = "refund_completed",
}
