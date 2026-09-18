/**
 * Allocation of human-facing party codes.
 *
 * The counter is a Postgres sequence (see the `add_party_code_sequences` migration), not
 * `MAX(code) + 1`: two staff creating a customer in the same moment would both read the
 * same maximum, and the loser would hit the unique constraint having done nothing wrong.
 *
 * Deliberately takes no transaction client. `nextval` is non-transactional — it does not
 * roll back with the statement that called it — so accepting one would imply a guarantee
 * this cannot give. The consequence is gaps in the numbering when a create is abandoned,
 * which is the trade we want: a missing CUS-00042 is harmless, a duplicate is not.
 */

import { formatPartyCode } from "@drivenx/core";

import { prisma } from "../index";

function sequenceValue(rows: Array<{ nextval: bigint }>): number {
  const value = rows[0]?.nextval;
  if (value === undefined) {
    throw new Error("Party code sequence returned no row");
  }
  return Number(value);
}

export async function nextCustomerCode(): Promise<string> {
  const rows = await prisma.$queryRaw<
    Array<{ nextval: bigint }>
  >`SELECT nextval('customer_code_seq')`;
  return formatPartyCode("customer", sequenceValue(rows));
}

export async function nextVehicleCode(): Promise<string> {
  const rows = await prisma.$queryRaw<
    Array<{ nextval: bigint }>
  >`SELECT nextval('vehicle_code_seq')`;
  return formatPartyCode("vehicle", sequenceValue(rows));
}

export async function nextSupplierCode(): Promise<string> {
  const rows = await prisma.$queryRaw<
    Array<{ nextval: bigint }>
  >`SELECT nextval('supplier_code_seq')`;
  return formatPartyCode("supplier", sequenceValue(rows));
}
