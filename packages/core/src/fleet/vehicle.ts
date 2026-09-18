/**
 * Vehicle identifiers as they are typed into the fleet form.
 *
 * Deliberately NOT `isValidVin` from identifiers.ts. That enforces the check digit in
 * position 9, which is only mandatory in North America: European and Asian VINs often do
 * not carry one, and grey-import Japanese cars — common in the UAE — carry a chassis
 * number such as `GRS200-1234567` that is not a 17-character VIN at all. Enforcing the
 * check digit here would refuse genuine cars standing on the client's lot.
 */

export const UAE_EMIRATES = [
  "ABU_DHABI",
  "DUBAI",
  "SHARJAH",
  "AJMAN",
  "UMM_AL_QUWAIN",
  "RAS_AL_KHAIMAH",
  "FUJAIRAH",
] as const;

export type UaeEmirate = (typeof UAE_EMIRATES)[number];

export function isUaeEmirate(value: string): value is UaeEmirate {
  return (UAE_EMIRATES as readonly string[]).includes(value);
}

/**
 * A VIN or chassis number in its stored form, or null if it is neither.
 *
 * A 17-character value must use the VIN alphabet — I, O and Q never appear in a VIN, so a
 * 17-character value containing one is a mistyped 1 or 0 rather than a chassis number.
 */
export function normaliseChassisNumber(value: string): string | null {
  const compact = value.replace(/\s+/g, "").toUpperCase();

  if (compact.length === 17) {
    return /^[A-HJ-NPR-Z0-9]{17}$/.test(compact) ? compact : null;
  }

  // Japanese domestic-market chassis numbers: a model prefix, an optional dash, a serial.
  return /^[A-Z0-9]{2,10}-?\d{4,10}$/.test(compact) && compact.length <= 20 ? compact : null;
}

/**
 * A plate in its stored form, or null.
 *
 * The code is the letter (Dubai, "A") or number (Abu Dhabi, "1") printed beside the plate
 * number; the number itself is at most five digits.
 */
export function normalisePlate(
  code: string,
  number: string,
): { plateCode: string; plateNumber: string } | null {
  const plateCode = code.replace(/\s+/g, "").toUpperCase();
  const plateNumber = number.replace(/\s+/g, "");

  if (!/^[A-Z0-9]{1,3}$/.test(plateCode)) return null;
  if (!/^\d{1,5}$/.test(plateNumber)) return null;

  return { plateCode, plateNumber };
}

/** The model years a fleet form accepts: nothing older than 1980, nothing past next year. */
export function isPlausibleModelYear(year: number, now: Date = new Date()): boolean {
  return Number.isInteger(year) && year >= 1980 && year <= now.getUTCFullYear() + 1;
}
