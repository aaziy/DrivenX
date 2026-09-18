/**
 * The nightly contract run, end to end: activate a contract, let a month pass, run the
 * job, and find next month's instalment issued and last month's marked overdue.
 */

import { describe, expect, it } from "vitest";

import { Money } from "@drivenx/core";
import { activateContract, createContract, createVehicle, prisma } from "@drivenx/db";

import { runContractsDaily } from "./contracts-daily";

describe("runContractsDaily", () => {
  it("issues what fell due, then marks what is late", async () => {
    const customer = await prisma.customer.create({
      data: { code: "CUS-NIGHT-1", fullName: "Night", mobile: "+971501234567" },
    });
    const vehicle = await createVehicle(
      {
        make: "Kia",
        model: "K5",
        year: 2025,
        plateEmirate: "DUBAI",
        plateCode: "N",
        plateNumber: "11111",
        vin: "KNAGT4LE0S5123456",
        currentMileageKm: 0,
        ownershipType: "COMPANY_OWNED",
      },
      null,
    );
    const contract = await createContract(
      {
        customerId: customer.id,
        vehicleId: vehicle.id,
        type: "LONG_TERM_RENTAL",
        startDate: "2026-01-01",
        durationMonths: 12,
        monthlyRentalFils: Money.parse("3400"),
      },
      null,
    );
    await activateContract(contract.id, { actorId: null, today: "2026-01-01" });

    const result = await runContractsDaily("2026-02-01");

    // February's instalment issued; January's, unpaid, now overdue — and so the contract.
    expect(result.issued.issued).toBe(1);
    const [january, february] = await prisma.installment.findMany({
      where: { contractId: contract.id },
      orderBy: { dueDate: "asc" },
      take: 2,
    });
    expect(january!.status).toBe("OVERDUE");
    expect(february!.invoiceNumber).not.toBeNull();
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe("OVERDUE");

    // Run again the same night: nothing more to do.
    const again = await runContractsDaily("2026-02-01");
    expect(again.issued.issued).toBe(0);
  });
});
