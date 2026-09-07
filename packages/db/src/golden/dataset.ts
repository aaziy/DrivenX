/**
 * The golden dataset (IMPLEMENTATION_PLAN.md §2.4).
 *
 * Fixed ids, fixed dates, no randomness. Reconciliation tests assert against these
 * values, so when a report disagrees with a fixture the report is wrong — that is only
 * true if the fixture never moves.
 *
 * Scope note: §2.4 also specifies 3 suppliers, 25 vehicles, 20 customers and 12
 * contracts. Those models do not exist until milestones 1A–1D, so the dataset covers
 * staff accounts today and grows with each milestone. The identifier generators and
 * the reference clock below are already sized for the full set.
 */

import { goldenId, mobileNumber } from "./identifiers";

/**
 * The dataset's "today".
 *
 * Every relative date — a document expiring in exactly 30 days, an overdue instalment,
 * a leap-year February — is computed from this constant rather than the wall clock.
 * Anchoring to `new Date()` would make the fixtures mean something different tomorrow,
 * and the tests that depend on them would rot silently.
 */
export const GOLDEN_TODAY = new Date("2026-06-15T08:00:00.000Z");

/** Days relative to GOLDEN_TODAY, as a UTC date. */
export function goldenDate(offsetDays: number): Date {
  const date = new Date(GOLDEN_TODAY);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date;
}

export const GOLDEN_PASSWORD = "GoldenDataset2026";

export interface GoldenUser {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  roleKey: string;
  isActive: boolean;
  note: string;
}

/**
 * One account per SOW §2 role, plus deliberate edge cases.
 *
 * QA needs to sign in as each persona from milestone 1A onward — the two-track cadence
 * in §2.1 depends on being able to check what each role can actually see, and creating
 * those accounts by hand before every test session is how that step gets skipped.
 */
export const GOLDEN_USERS: readonly GoldenUser[] = [
  {
    id: goldenId("user", 1),
    email: "sara.admin@drivenx.ae",
    fullName: "Sara Al Mansoori",
    phone: mobileNumber(1),
    roleKey: "super_admin",
    isActive: true,
    note: "Super Admin — full access",
  },
  {
    id: goldenId("user", 2),
    email: "omar.management@drivenx.ae",
    fullName: "Omar Haddad",
    phone: mobileNumber(2),
    roleKey: "admin",
    isActive: true,
    note: "Admin/Management — no user or role administration",
  },
  {
    id: goldenId("user", 3),
    email: "layla.sales@drivenx.ae",
    fullName: "Layla Rahman",
    phone: mobileNumber(3),
    roleKey: "sales",
    isActive: true,
    note: "Sales — scoped to own leads, cannot activate contracts",
  },
  {
    id: goldenId("user", 4),
    email: "imran.finance@drivenx.ae",
    fullName: "Imran Sheikh",
    phone: mobileNumber(4),
    roleKey: "finance",
    isActive: true,
    note: "Finance — payments and financial reporting",
  },
  {
    id: goldenId("user", 5),
    email: "yusuf.ops@drivenx.ae",
    fullName: "Yusuf Karim",
    phone: mobileNumber(5),
    roleKey: "operations",
    isActive: true,
    note: "Operations — fleet, maintenance, handover",
  },
  {
    id: goldenId("user", 6),
    email: "hana.sales@drivenx.ae",
    fullName: "Hana Aziz",
    phone: mobileNumber(6),
    roleKey: "sales",
    isActive: true,
    note: "Second salesperson — proves lead scoping is per user, not per role",
  },
  {
    id: goldenId("user", 7),
    email: "deactivated@drivenx.ae",
    fullName: "Faisal Noor",
    phone: mobileNumber(7),
    roleKey: "operations",
    isActive: false,
    note: "Deactivated — must be refused at login with the correct password",
  },
  {
    id: goldenId("user", 8),
    email: "noroles@drivenx.ae",
    fullName: "Nadia Farouk",
    phone: mobileNumber(8),
    roleKey: "",
    isActive: true,
    note: "No roles — signs in successfully but can reach nothing",
  },
];
