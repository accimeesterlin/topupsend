import { UserRole, Permission } from "@topupsend/types";

/**
 * Role-based permission mapping
 * Defines which permissions each role has
 */
const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.ADMIN]: [
    // Admins have all permissions
    ...Object.values(Permission),
  ],
  [UserRole.OPERATOR]: [
    // Dashboard & Analytics
    Permission.VIEW_DASHBOARD,
    Permission.VIEW_ANALYTICS,

    // Storefront
    Permission.VIEW_STOREFRONT_SETTINGS,

    // Products & Pricing
    Permission.VIEW_PRODUCTS,
    Permission.VIEW_PRICING,

    // Discounts
    Permission.VIEW_DISCOUNTS,

    // Countries
    Permission.VIEW_COUNTRIES,

    // Transactions
    Permission.VIEW_TRANSACTIONS,
    Permission.PROCESS_TRANSACTIONS,
    Permission.UPDATE_TRANSACTION_STATUS,
    Permission.REFUND_TRANSACTIONS,

    // Manual Payments (operators record; voiding stays admin-only)
    Permission.RECORD_MANUAL_PAYMENT,

    // Customers
    Permission.VIEW_CUSTOMERS,
    Permission.EDIT_CUSTOMERS,
    Permission.VIEW_CUSTOMER_BALANCE,

    // Integrations
    Permission.VIEW_INTEGRATIONS,

    // Payment Settings
    Permission.VIEW_PAYMENT_SETTINGS,

    // Wallet
    Permission.VIEW_WALLET,

    // Staff Self-Service
    Permission.VIEW_OWN_TRANSACTIONS,
    Permission.VIEW_OWN_BALANCE,
    Permission.MANAGE_OWN_API_KEYS,
  ],
  [UserRole.VIEWER]: [
    // Dashboard & Analytics
    Permission.VIEW_DASHBOARD,
    Permission.VIEW_ANALYTICS,

    // Storefront
    Permission.VIEW_STOREFRONT_SETTINGS,

    // Products & Pricing
    Permission.VIEW_PRODUCTS,
    Permission.VIEW_PRICING,

    // Discounts
    Permission.VIEW_DISCOUNTS,

    // Countries
    Permission.VIEW_COUNTRIES,

    // Transactions
    Permission.VIEW_TRANSACTIONS,

    // Customers
    Permission.VIEW_CUSTOMERS,

    // Integrations
    Permission.VIEW_INTEGRATIONS,

    // Payment Settings
    Permission.VIEW_PAYMENT_SETTINGS,

    // Wallet
    Permission.VIEW_WALLET,

    // Staff Self-Service
    Permission.VIEW_OWN_TRANSACTIONS,
    Permission.VIEW_OWN_BALANCE,
    Permission.MANAGE_OWN_API_KEYS,
  ],
  [UserRole.CUSTOMER]: [
    // Customers have limited permissions
    // They mostly interact through customer portal, not admin dashboard
  ],
};

/**
 * Check if a user has a specific permission based on their roles
 */
export function hasPermission(
  userRoles: UserRole[],
  permission: Permission,
): boolean {
  return userRoles.some((role) => {
    const rolePermissions = ROLE_PERMISSIONS[role];
    return rolePermissions.includes(permission);
  });
}

/**
 * Check if a user has any of the specified permissions
 */
export function hasAnyPermission(
  userRoles: UserRole[],
  permissions: Permission[],
): boolean {
  return permissions.some((permission) => hasPermission(userRoles, permission));
}

/**
 * Check if a user has all of the specified permissions
 */
export function hasAllPermissions(
  userRoles: UserRole[],
  permissions: Permission[],
): boolean {
  return permissions.every((permission) =>
    hasPermission(userRoles, permission),
  );
}

/**
 * Get all permissions for a user's roles
 */
export function getUserPermissions(userRoles: UserRole[]): Permission[] {
  const allPermissions = new Set<Permission>();

  userRoles.forEach((role) => {
    const rolePermissions = ROLE_PERMISSIONS[role];
    rolePermissions.forEach((permission) => allPermissions.add(permission));
  });

  return Array.from(allPermissions);
}

/**
 * Check if user is admin
 */
export function isAdmin(userRoles: UserRole[]): boolean {
  return userRoles.includes(UserRole.ADMIN);
}

/**
 * Check if user is operator or above
 */
export function isOperatorOrAbove(userRoles: UserRole[]): boolean {
  return (
    userRoles.includes(UserRole.ADMIN) || userRoles.includes(UserRole.OPERATOR)
  );
}
