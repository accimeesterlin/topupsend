import { Permission, UserRole } from "@topupsend/types";
import { hasPermission } from "../permissions";

/**
 * Permission mapping tests for the manual payments feature.
 * Locked policy: admin + operator can record manual payments;
 * only admins can void them; viewers can do neither.
 */
describe("manual payment permissions", () => {
  it("allows admins to record and void", () => {
    expect(
      hasPermission([UserRole.ADMIN], Permission.RECORD_MANUAL_PAYMENT),
    ).toBe(true);
    expect(
      hasPermission([UserRole.ADMIN], Permission.VOID_MANUAL_PAYMENT),
    ).toBe(true);
  });

  it("allows operators to record but not void", () => {
    expect(
      hasPermission([UserRole.OPERATOR], Permission.RECORD_MANUAL_PAYMENT),
    ).toBe(true);
    expect(
      hasPermission([UserRole.OPERATOR], Permission.VOID_MANUAL_PAYMENT),
    ).toBe(false);
  });

  it("allows viewers neither to record nor void", () => {
    expect(
      hasPermission([UserRole.VIEWER], Permission.RECORD_MANUAL_PAYMENT),
    ).toBe(false);
    expect(
      hasPermission([UserRole.VIEWER], Permission.VOID_MANUAL_PAYMENT),
    ).toBe(false);
  });

  it("allows customers neither to record nor void", () => {
    expect(
      hasPermission([UserRole.CUSTOMER], Permission.RECORD_MANUAL_PAYMENT),
    ).toBe(false);
    expect(
      hasPermission([UserRole.CUSTOMER], Permission.VOID_MANUAL_PAYMENT),
    ).toBe(false);
  });
});
