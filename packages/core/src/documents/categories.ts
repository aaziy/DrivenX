/**
 * The document types DrivenX starts with (SOW §5, §6, §11, §13).
 *
 * Seeded, then owned by the client: §17 requires the Super Admin to add and edit
 * document categories without a release, so this list is a starting point rather than
 * the authority. The seed creates what is missing and never overwrites what the client
 * has changed, exactly as the role seed behaves.
 *
 * Labels here are English. The interface shows a translated label for a seeded category
 * still carrying its seeded name, and the client's own wording once they edit it —
 * the same rule the roles follow.
 */

/** Mirrors the `DocumentOwnerType` enum in the Prisma schema. */
export type DocumentOwner =
  | "CUSTOMER"
  | "SUPPLIER"
  | "VEHICLE"
  | "CONTRACT"
  | "INSURANCE_POLICY"
  | "MAINTENANCE"
  | "HANDOVER"
  | "DAMAGE_POINT"
  | "ACCIDENT";

export interface DocumentCategoryDefinition {
  key: string;
  label: string;
  appliesTo: readonly DocumentOwner[];
  /** Whether an expiry date must be entered — and therefore whether it is ever chased. */
  requiresExpiry: boolean;
  /** Days before expiry to warn. Overridable per document. */
  defaultReminderOffsets: readonly number[];
}

const STANDARD = [60, 30, 15, 7] as const;

export const DOCUMENT_CATEGORIES = [
  // -- Customer (§6) --
  {
    key: "emirates_id",
    label: "Emirates ID",
    appliesTo: ["CUSTOMER"],
    requiresExpiry: true,
    defaultReminderOffsets: STANDARD,
  },
  {
    key: "driving_licence",
    label: "Driving licence",
    appliesTo: ["CUSTOMER"],
    requiresExpiry: true,
    defaultReminderOffsets: STANDARD,
  },
  {
    key: "passport",
    label: "Passport",
    appliesTo: ["CUSTOMER"],
    requiresExpiry: true,
    // Renewing a passport takes longer than renewing a licence, so the warning starts
    // earlier and the short-notice reminders are pointless.
    defaultReminderOffsets: [90, 60, 30],
  },
  {
    key: "visa",
    label: "Residence visa",
    appliesTo: ["CUSTOMER"],
    requiresExpiry: true,
    defaultReminderOffsets: STANDARD,
  },
  {
    key: "customer_other",
    label: "Other customer document",
    appliesTo: ["CUSTOMER"],
    requiresExpiry: false,
    defaultReminderOffsets: [],
  },

  // -- Supplier (§5) --
  {
    key: "trade_licence",
    label: "Trade licence",
    appliesTo: ["SUPPLIER"],
    requiresExpiry: true,
    defaultReminderOffsets: STANDARD,
  },
  {
    key: "vat_certificate",
    label: "VAT certificate",
    appliesTo: ["SUPPLIER"],
    requiresExpiry: false,
    defaultReminderOffsets: [],
  },
  {
    key: "supplier_agreement",
    label: "Supplier agreement",
    appliesTo: ["SUPPLIER"],
    requiresExpiry: false,
    defaultReminderOffsets: [],
  },

  // -- Vehicle (§4, §13) — the owner type exists now; vehicles arrive in 1B --
  {
    key: "mulkiya",
    label: "Vehicle registration (mulkiya)",
    appliesTo: ["VEHICLE"],
    requiresExpiry: true,
    defaultReminderOffsets: STANDARD,
  },
  {
    key: "vehicle_photo",
    label: "Vehicle photo",
    appliesTo: ["VEHICLE"],
    requiresExpiry: false,
    defaultReminderOffsets: [],
  },
  {
    key: "vehicle_other",
    label: "Other vehicle document",
    appliesTo: ["VEHICLE"],
    requiresExpiry: false,
    defaultReminderOffsets: [],
  },

  // -- Insurance (§11) — renewal alerts at 30, 15 and 7 days --
  {
    key: "insurance_policy",
    label: "Insurance policy",
    appliesTo: ["INSURANCE_POLICY", "VEHICLE"],
    requiresExpiry: true,
    defaultReminderOffsets: [30, 15, 7],
  },

  // -- Handover and return (§12) — photographs taken at the counter --
  {
    key: "handover_photo",
    label: "Handover photo",
    appliesTo: ["HANDOVER"],
    requiresExpiry: false,
    defaultReminderOffsets: [],
  },
  {
    key: "damage_photo",
    label: "Damage photo",
    appliesTo: ["DAMAGE_POINT"],
    requiresExpiry: false,
    defaultReminderOffsets: [],
  },

  // -- Accidents (§13) --
  {
    key: "accident_photo",
    label: "Accident photo",
    appliesTo: ["ACCIDENT"],
    requiresExpiry: false,
    defaultReminderOffsets: [],
  },
  {
    key: "police_report",
    label: "Police report",
    appliesTo: ["ACCIDENT"],
    requiresExpiry: false,
    defaultReminderOffsets: [],
  },

  // -- Contract (§9, §12) --
  {
    key: "signed_contract",
    label: "Signed contract",
    appliesTo: ["CONTRACT"],
    requiresExpiry: false,
    defaultReminderOffsets: [],
  },
  {
    key: "handover_report",
    label: "Handover or return report",
    appliesTo: ["CONTRACT", "HANDOVER"],
    requiresExpiry: false,
    defaultReminderOffsets: [],
  },
] as const satisfies readonly DocumentCategoryDefinition[];

export type DocumentCategoryKey = (typeof DOCUMENT_CATEGORIES)[number]["key"];

/** The categories offered when uploading against a particular kind of record. */
export function categoriesFor(owner: DocumentOwner): readonly DocumentCategoryDefinition[] {
  return DOCUMENT_CATEGORIES.filter((category) =>
    (category.appliesTo as readonly DocumentOwner[]).includes(owner),
  );
}
