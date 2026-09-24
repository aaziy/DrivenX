import { describe, expect, it } from "vitest";

import { DEFAULT_ROLES, PERMISSIONS } from "@drivenx/auth/permissions";
import { categoryLabelKey, CHARGE_TYPES, LEDGER_CATEGORIES } from "@drivenx/core";

import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import { permissionGroupMessageKey, permissionMessageKey } from "./labels";

/**
 * The catalogues are two files that must stay in step. A key added to one and forgotten
 * in the other shows up to a reader as the raw key path in the middle of a page, which
 * is the sort of thing nobody notices until a customer does.
 */

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const flat = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") flat.set(path, value);
    else for (const [nested, message] of flatten(value, path)) flat.set(nested, message);
  }
  return flat;
}

/** Placeholder names in a message: `name` in "Created {name}.". Plural branches have none. */
function placeholders(message: string): string[] {
  const names = [...message.matchAll(/\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,}]/g)].map(
    (match) => match[1]!,
  );
  return [...new Set(names)].sort();
}

const english = flatten(en as Tree);
const arabic = flatten(ar as Tree);

describe("message catalogues", () => {
  it("cover exactly the same keys", () => {
    const missingFromArabic = [...english.keys()].filter((key) => !arabic.has(key));
    const missingFromEnglish = [...arabic.keys()].filter((key) => !english.has(key));

    expect({ missingFromArabic, missingFromEnglish }).toEqual({
      missingFromArabic: [],
      missingFromEnglish: [],
    });
  });

  it("have no empty messages", () => {
    const empty = [...english, ...arabic].filter(([, message]) => message.trim() === "");
    expect(empty).toEqual([]);
  });

  it("use the same placeholders in both languages", () => {
    const mismatched = [...english].filter(([key, message]) => {
      const translated = arabic.get(key);
      return translated !== undefined && placeholders(message).join() !== placeholders(translated).join();
    });

    expect(mismatched.map(([key]) => key)).toEqual([]);
  });

  it("give every Arabic plural an `other` branch", () => {
    // Arabic has six plural categories. ICU falls back to `other`, so a message without
    // one throws at render time rather than merely reading oddly.
    const broken = [...arabic].filter(
      ([, message]) => message.includes(", plural,") && !message.includes("other {"),
    );
    expect(broken.map(([key]) => key)).toEqual([]);
  });
});

describe("database text that is shown translated", () => {
  it("has a message for every permission in the catalogue", () => {
    const missing = PERMISSIONS.map((permission) => permissionMessageKey(permission.key)).filter(
      (key) => !english.has(key) || !arabic.has(key),
    );
    expect(missing).toEqual([]);
  });

  it("has a message for every charge type", () => {
    // A charge type added to the enum without a label renders as a raw key path in the
    // middle of a payment schedule, which is how FINE_RECOVERY first shipped.
    const missing = CHARGE_TYPES.map((type) => `contracts.charges.${type}`).filter(
      (key) => !english.has(key) || !arabic.has(key),
    );
    expect(missing).toEqual([]);
  });

  it("has a message for every ledger category", () => {
    // The ledger's category is a string, so nothing stops a new one reaching a report
    // with no name. This is what stops it reaching a screen as a raw key.
    const missing = LEDGER_CATEGORIES.map(
      (category) => `reports.ledgerCategories.${categoryLabelKey(category)}`,
    ).filter((key) => !english.has(key) || !arabic.has(key));
    expect(missing).toEqual([]);
  });

  it("has a message for every permission group", () => {
    const groups = [...new Set(PERMISSIONS.map((permission) => permission.group))];
    const missing = groups
      .map((group) => permissionGroupMessageKey(group))
      .filter((key) => !english.has(key) || !arabic.has(key));
    expect(missing).toEqual([]);
  });

  it("has a name and description for every seeded role", () => {
    const missing = DEFAULT_ROLES.flatMap((role) =>
      [`roles.defaultNames.${role.key}`, `roles.defaultDescriptions.${role.key}`].filter(
        (key) => !english.has(key) || !arabic.has(key),
      ),
    );
    expect(missing).toEqual([]);
  });

  it("keeps the English role text identical to what was seeded", () => {
    // Otherwise the English UI would quietly start disagreeing with the database.
    for (const role of DEFAULT_ROLES) {
      expect(english.get(`roles.defaultNames.${role.key}`)).toBe(role.name);
      expect(english.get(`roles.defaultDescriptions.${role.key}`)).toBe(role.description);
    }
  });
});
