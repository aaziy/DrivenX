/**
 * Dashboard and report timings at fleet scale (P1E-11).
 *
 * Seeds the TEST database with N activated contracts — each 36 months with annual
 * insurance, half on cars leased from a supplier — runs the nightly issue for a year,
 * then times every dashboard figure and each profitability view. Target: p95 under
 * 500 ms. Empties the database afterwards, as the integration tests expect.
 *
 *   pnpm bench:dashboard [contracts]      (points DATABASE_URL at TEST_DATABASE_URL)
 */

import { Money } from "@drivenx/core";

import { activateContract, createContract, issueDueInstallments } from "../src/contracts";
import { createVehicle } from "../src/fleet";
import { prisma } from "../src/index";
import {
  contractCounts,
  expiringDocuments,
  fleetCounts,
  monthResult,
  overdueInstallments,
  payables,
  receivables,
} from "../src/kpis";
import { profitReport, REPORT_DIMENSIONS } from "../src/reports";
import { raiseDueSupplierInvoices } from "../src/supplier-invoices";
import { assertTestDatabase, truncateAll } from "../src/testing";

const CONTRACTS = Number(process.argv[2] ?? 1000);
const RUNS = 20;
const TODAY = "2027-01-15";

async function seed() {
  const supplier = await prisma.supplier.create({ data: { code: "SUP-BENCH", companyName: "Bench Leasing" } });
  const started = Date.now();
  for (let i = 0; i < CONTRACTS; i += 1) {
    const leased = i % 2 === 1;
    const customer = await prisma.customer.create({
      data: { code: `CUS-B${i}`, fullName: `Bench Customer ${i}`, mobile: `+97150${String(1000000 + i)}` },
    });
    const vehicle = await createVehicle(
      {
        make: "Toyota",
        model: "Camry",
        year: 2025,
        plateEmirate: "DUBAI",
        plateCode: "B",
        plateNumber: String(10000 + i),
        vin: `BENCH${String(i).padStart(12, "0")}`,
        currentMileageKm: 0,
        ownershipType: leased ? "B2B_SUPPLIER" : "COMPANY_OWNED",
        supplierId: leased ? supplier.id : null,
        supplierMonthlyCostFils: leased ? Money.parse("2000") : null,
      },
      null,
    );
    const draft = await createContract(
      {
        customerId: customer.id,
        vehicleId: vehicle.id,
        type: leased ? "LEASE_TO_OWN" : "LONG_TERM_RENTAL",
        // Spread over 2026 so every month has activity.
        startDate: `2026-${String((i % 12) + 1).padStart(2, "0")}-01`,
        durationMonths: 36,
        monthlyRentalFils: Money.parse("3400"),
        annualInsuranceFils: Money.parse("2400"),
      },
      null,
    );
    await activateContract(draft.id, { actorId: null, today: "2026-01-01" });
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1} contracts (${Math.round((Date.now() - started) / 1000)}s)`);
  }
  await issueDueInstallments(TODAY);
  await raiseDueSupplierInvoices(TODAY);
}

async function time(label: string, run: () => Promise<unknown>) {
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const start = performance.now();
    await run();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const p = (q: number) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))]!;
  console.log(`  ${label.padEnd(32)} p50 ${p(0.5).toFixed(1).padStart(7)} ms   p95 ${p(0.95).toFixed(1).padStart(7)} ms`);
  return p(0.95);
}

async function main() {
  assertTestDatabase();
  await truncateAll();
  console.log(`Seeding ${CONTRACTS} contracts…`);
  await seed();
  const [installments, ledger] = await Promise.all([prisma.installment.count(), prisma.ledgerEntry.count()]);
  console.log(`  ${installments} instalments, ${ledger} ledger entries\n`);

  // The dashboard runs its figures together, as the page does.
  const dashboard = await time("dashboard (all figures)", () =>
    Promise.all([
      fleetCounts(),
      contractCounts(TODAY),
      monthResult(TODAY),
      receivables(TODAY),
      payables(TODAY),
      overdueInstallments(TODAY),
      expiringDocuments(TODAY),
    ]),
  );
  await time("  monthResult", () => monthResult(TODAY));
  await time("  receivables", () => receivables(TODAY));
  await time("  contractCounts", () => contractCounts(TODAY));
  await time("  overdueInstallments", () => overdueInstallments(TODAY));
  const reports: number[] = [];
  for (const dimension of REPORT_DIMENSIONS) {
    reports.push(await time(`profitability by ${dimension}`, () => profitReport(dimension, 202601, 202612)));
  }

  const worst = Math.max(dashboard, ...reports);
  console.log(`\nWorst p95: ${worst.toFixed(1)} ms — ${worst < 500 ? "within" : "OVER"} the 500 ms target`);
  await truncateAll();
  await prisma.$disconnect();
  process.exit(worst < 500 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
