/**
 * A made-up leasing business, for showing DrivenX to people.
 *
 *   DEMO_SEED=yes DEMO_STAFF_PASSWORD=... pnpm db:seed:demo
 *
 * Demo only. It refuses to run unless asked to explicitly, and it refuses any database that
 * already holds a single customer, so it cannot be pointed at real data by mistake. Before
 * a demo server becomes a real one, the database is emptied rather than "cleaned".
 *
 * Everything goes through the same functions the screens use. Contracts are activated,
 * invoices issued, payments allocated and costs posted by the real rules, so every figure
 * on the dashboard and in the reports is one the system computed rather than one typed in.
 *
 * The calendar is replayed day by day from the first contract to today. Invoices are
 * issued and paid on the days they would have been, one customer falls behind, and the
 * monthly reports show a history rather than one month with everything in it.
 *
 * People, phone numbers, plates and companies are invented. Email addresses use
 * example.com, which by standard never receives mail, so a configured mail server cannot
 * write to anyone by accident. Garages and insurers are fictional on purpose: a demo should
 * not imply a relationship with a real business.
 */

import { deflateSync } from "node:zlib";

import { hashPassword, validatePassword } from "@drivenx/auth/password";
import {
  addDays,
  addMonths,
  businessDate,
  compareIsoDates,
  expiryStatus,
  Money,
  type IsoDate,
} from "@drivenx/core";
import { buildObjectKey, s3StorageFromEnv, type StorageAdapter } from "@drivenx/storage";

import type { DocumentOwnerType, PaymentMethod } from "../generated/client";
import {
  activateContract,
  addSettlementLine,
  changeLeadStatus,
  changeVehicleStatus,
  convertLead,
  createContract,
  createLead,
  createPolicy,
  createVehicle,
  fromDbDate,
  issueDueInstallments,
  lodgeClaim,
  nextCustomerCode,
  nextSupplierCode,
  openSettlement,
  prisma,
  raiseDueSupplierInvoices,
  recordAccident,
  recordExpense,
  recordFine,
  recordHandover,
  recordMaintenance,
  recordMileage,
  recordPayment,
  recordRepair,
  recordSupplierPayment,
  recoverFine,
  refreshOverdue,
  refreshSupplierOverdue,
  saveQuote,
  settleSettlement,
  signHandover,
  terminateContract,
  toDbDate,
  transitionAccident,
  transitionClaim,
  transitionFine,
  withoutAudit,
} from "../src/index";

const aed = (value: string) => Money.parse(value);

const TODAY: IsoDate = businessDate(new Date());

/** A day relative to today: `on(-3, 5)` is three months ago plus five days. */
const on = (months: number, days = 0): IsoDate => addDays(addMonths(TODAY, months), days);

/** The first of the month `months` from now. */
const firstOf = (months: number): IsoDate => `${addMonths(TODAY, months).slice(0, 7)}-01`;

// ---------------------------------------------------------------------------
// Placeholder files
// ---------------------------------------------------------------------------

/**
 * A one-page PDF saying plainly that it is a sample. Scanned identity documents cannot be
 * invented, and a demo that downloaded a real-looking Emirates ID would be worse than one
 * that downloads a page reading "sample".
 */
function samplePdf(title: string, lines: readonly string[]): Uint8Array {
  const esc = (text: string) => text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const content = [
    "BT",
    "/F1 22 Tf 72 770 Td",
    "(SAMPLE DOCUMENT) Tj",
    "/F1 13 Tf 0 -34 Td",
    `(${esc(title)}) Tj`,
    ...lines.flatMap((line) => ["0 -20 Td", `(${esc(line)}) Tj`]),
    "/F1 10 Tf 0 -40 Td",
    "(Generated for a DrivenX demonstration. Not a real document.) Tj",
    "ET",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A drawn signature, so the signed handover report has something on its signature lines. */
function signaturePng(seed: number): Uint8Array {
  const width = 360;
  const height = 120;
  const rgba = new Uint8Array(width * height * 4);

  const ink = (x: number, y: number) => {
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const px = Math.round(x) + dx;
        const py = Math.round(y) + dy;
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const i = (py * width + px) * 4;
        rgba[i] = 0x16;
        rgba[i + 1] = 0x20;
        rgba[i + 2] = 0x2e;
        rgba[i + 3] = 255;
      }
    }
  };

  for (let t = 0; t <= 1; t += 0.0005) {
    const x = 24 + t * 300;
    const y =
      62 +
      26 * Math.sin(t * (9 + seed) * Math.PI) * Math.cos(t * (3 + seed / 2) * Math.PI) -
      10 * Math.sin(t * 40 + seed);
    ink(x, y);
  }
  for (let t = 0; t <= 1; t += 0.002) ink(40 + t * 260, 100 + 4 * Math.sin(t * 6 + seed));

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(raw, y * stride + 1);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA

  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", header),
      pngChunk("IDAT", deflateSync(raw)),
      pngChunk("IEND", new Uint8Array(0)),
    ]),
  );
}

// ---------------------------------------------------------------------------
// The business
// ---------------------------------------------------------------------------

const CUSTOMERS = [
  { key: "ahmed", fullName: "Ahmed Al Mansoori", nationality: "Emirati", dob: "1986-03-14", area: "Al Barsha" },
  { key: "fatima", fullName: "Fatima Al Marri", nationality: "Emirati", dob: "1991-07-22", area: "Jumeirah" },
  { key: "rajesh", fullName: "Rajesh Kumar", nationality: "Indian", dob: "1984-11-02", area: "Al Nahda" },
  { key: "sara", fullName: "Sara Haddad", nationality: "Jordanian", dob: "1990-01-30", area: "Dubai Marina" },
  { key: "omar", fullName: "Omar Khalil", nationality: "Egyptian", dob: "1988-05-18", area: "Al Qusais" },
  { key: "maria", fullName: "Maria Santos", nationality: "Filipino", dob: "1993-09-09", area: "JLT" },
  { key: "yousef", fullName: "Yousef Al Hashimi", nationality: "Emirati", dob: "1982-12-12", area: "Mirdif" },
  { key: "daniel", fullName: "Daniel Okafor", nationality: "Nigerian", dob: "1987-04-25", area: "Business Bay" },
] as const;

type CustomerKey = (typeof CUSTOMERS)[number]["key"];

const VEHICLES = [
  { key: "landcruiser", make: "Toyota", model: "Land Cruiser", year: 2025, variant: "GXR", colour: "White", plateCode: "Q", plateNumber: "41027", vin: "JTMHV05J804156721", km: 8400, price: "289000" },
  { key: "patrol", make: "Nissan", model: "Patrol", year: 2025, variant: "LE", colour: "Black", plateCode: "R", plateNumber: "77310", vin: "JN8AY2NY3S9301847", km: 5200, price: "312000" },
  { key: "camry", make: "Toyota", model: "Camry", year: 2024, variant: "GLE", colour: "Silver", plateCode: "K", plateNumber: "20984", vin: "4T1BZ1HK2RU041263", km: 21300, price: "112000" },
  { key: "prado", make: "Toyota", model: "Prado", year: 2025, variant: "VX", colour: "Grey", plateCode: "M", plateNumber: "63518", vin: "JTEBH9FJ4SK018832", km: 3900, supplierMonthly: "2400" },
  { key: "sonata", make: "Hyundai", model: "Sonata", year: 2025, variant: "Smart", colour: "Blue", plateCode: "D", plateNumber: "15422", vin: "KMHL14JA8SA305571", km: 6700, price: "96000" },
  { key: "hilux", make: "Toyota", model: "Hilux", year: 2025, variant: "Double Cab", colour: "White", plateCode: "J", plateNumber: "88140", vin: "MR0EB3CD9S0471126", km: 12800, price: "118000" },
  { key: "lexus", make: "Lexus", model: "ES 350", year: 2025, variant: "Premier", colour: "Pearl White", plateCode: "L", plateNumber: "30307", vin: "58ADZ1B14SU180944", km: 2100, supplierMonthly: "3100" },
  { key: "seltos", make: "Kia", model: "Seltos", year: 2025, variant: "EX", colour: "Red", plateCode: "F", plateNumber: "52671", vin: "KNDEU2AA6S7260893", km: 1400, price: "82000" },
  { key: "sunny", make: "Nissan", model: "Sunny", year: 2024, variant: "SV", colour: "Grey", plateCode: "G", plateNumber: "47905", vin: "MDHBN7AD2RG118734", km: 24600, price: "58000" },
  { key: "pajero", make: "Mitsubishi", model: "Pajero", year: 2024, variant: "GLS", colour: "White", plateCode: "H", plateNumber: "69253", vin: "JA4JZ4AX7RZ004417", km: 18200, price: "135000" },
] as const;

type VehicleKey = (typeof VEHICLES)[number]["key"];

const STAFF = [
  { key: "sales", fullName: "Layla Hassan", email: "layla.hassan@example.com", role: "sales" },
  { key: "operations", fullName: "Karim Nasser", email: "karim.nasser@example.com", role: "operations" },
  { key: "finance", fullName: "Noura Saeed", email: "noura.saeed@example.com", role: "finance" },
] as const;

/** How a customer pays: how many days after the due date, and whether they stop. */
interface PaymentHabit {
  contractId: string;
  start: IsoDate;
  delayDays: number;
  /** Stops paying after this many instalments: the customer who falls behind. */
  stopAfter?: number;
  methods: readonly PaymentMethod[];
  paid: number;
}

function guard(): string {
  if (process.env.DEMO_SEED !== "yes") {
    throw new Error(
      "Refusing: this fills the database with a made-up business. Set DEMO_SEED=yes to confirm " +
        "this is a demo database.",
    );
  }
  const password = process.env.DEMO_STAFF_PASSWORD ?? "";
  const check = validatePassword(password);
  if (!check.valid) {
    throw new Error(`DEMO_STAFF_PASSWORD does not meet the password policy: ${check.errors.join(" ")}`);
  }
  return password;
}

async function main(): Promise<void> {
  const staffPassword = guard();

  const existing = await prisma.customer.count();
  if (existing > 0) {
    throw new Error(
      `Refusing: this database already has ${existing} customer(s). Demo data goes only into an ` +
        "empty database, so it can never mix with real records.",
    );
  }

  const admin = await prisma.user.findFirst({
    where: { roles: { some: { role: { key: "super_admin" } } }, deletedAt: null },
    select: { id: true },
  });
  if (!admin) throw new Error("Run the base seed first (pnpm db:seed): there is no Super Admin.");

  const storage: StorageAdapter = s3StorageFromEnv();
  console.log(`Loading demo data as of ${TODAY}…`);

  await withoutAudit(async () => {
    // -- Staff -----------------------------------------------------------------
    const passwordHash = await hashPassword(staffPassword);
    const staff = {} as Record<(typeof STAFF)[number]["key"], string>;
    for (const person of STAFF) {
      const role = await prisma.role.findUniqueOrThrow({ where: { key: person.role } });
      const user = await prisma.user.create({
        data: {
          email: person.email,
          fullName: person.fullName,
          passwordHash,
          // Demo accounts are never emailed, whatever the mail settings say.
          emailNotifications: false,
          roles: { create: { roleId: role.id } },
        },
      });
      staff[person.key] = user.id;
    }
    const { sales, operations, finance } = staff;

    // -- Suppliers ---------------------------------------------------------------
    const lessor = await prisma.supplier.create({
      data: {
        code: await nextSupplierCode(),
        companyName: "Gulf Fleet Leasing LLC",
        contactPerson: "Bilal Qureshi",
        phone: "+97142000101",
        email: "accounts@gulffleet.example.com",
        address: "Al Quoz Industrial Area 3, Dubai",
        tradeLicenseNo: "DED-1029384",
        trn: "100123456700003",
        bankName: "Demo Bank",
        bankAccountName: "Gulf Fleet Leasing LLC",
        iban: "AE070331234567890123456",
        notes: "Supplies cars that DrivenX places on lease-to-own.",
        createdById: admin.id,
      },
    });
    await prisma.supplier.create({
      data: {
        code: await nextSupplierCode(),
        companyName: "Emirates Auto Partners FZE",
        contactPerson: "Rania Aziz",
        phone: "+97142000202",
        email: "fleet@autopartners.example.com",
        address: "Dubai Silicon Oasis, Dubai",
        tradeLicenseNo: "DSO-558210",
        notes: "Prospective second supplier. No cars placed yet.",
        createdById: admin.id,
      },
    });

    // -- Fleet -------------------------------------------------------------------
    const vehicles = {} as Record<VehicleKey, string>;
    for (const car of VEHICLES) {
      const leasedIn = "supplierMonthly" in car;
      const vehicle = await createVehicle(
        {
          make: car.make,
          model: car.model,
          year: car.year,
          variant: car.variant,
          colour: car.colour,
          plateEmirate: "DUBAI",
          plateCode: car.plateCode,
          plateNumber: car.plateNumber,
          vin: car.vin,
          currentMileageKm: car.km,
          ownershipType: leasedIn ? "B2B_SUPPLIER" : "COMPANY_OWNED",
          supplierId: leasedIn ? lessor.id : null,
          sourceDate: leasedIn ? toDbDate(on(-6)) : null,
          supplierMonthlyCostFils: leasedIn ? aed(car.supplierMonthly) : null,
          purchasePriceFils: "price" in car ? aed(car.price) : null,
        },
        operations,
      );
      vehicles[car.key] = vehicle.id;
      // The reading a car joins the fleet with is stamped "now" by default, which would put
      // it after every service in the replayed history and make the odometer look as if it
      // ran backwards. It belongs before the car's first event.
      await prisma.mileageReading.updateMany({
        where: { vehicleId: vehicle.id },
        data: { readAt: toDbDate(on(-13)), note: "Joined the fleet" },
      });
    }

    // -- Insurance, on the cars DrivenX owns --------------------------------------
    const policies = {} as Partial<Record<VehicleKey, string>>;
    const insured: Array<[VehicleKey, string, number]> = [
      ["landcruiser", "5200", 40],
      ["patrol", "5600", 70],
      // Starts a year ago less twelve days, so it is up for renewal within a fortnight.
      ["camry", "2900", -12],
      ["sonata", "2700", 95],
      ["hilux", "3400", 120],
      ["seltos", "2600", 150],
      ["sunny", "2300", 180],
      ["pajero", "3800", 200],
    ];
    for (const [index, [car, premium, daysToExpiry]] of insured.entries()) {
      const expiryDate = addDays(TODAY, daysToExpiry < 0 ? -daysToExpiry : daysToExpiry);
      const startDate = addDays(addMonths(expiryDate, -12), 1);
      const policy = await createPolicy(
        {
          vehicleId: vehicles[car],
          provider: index % 2 === 0 ? "Oasis Insurance" : "Al Noor Takaful",
          policyNumber: `${index % 2 === 0 ? "OIC" : "ANT"}-26-${String(10418 + index * 37)}`,
          coverage: "COMPREHENSIVE",
          startDate,
          expiryDate,
          premiumNetFils: aed(premium),
        },
        operations,
      );
      policies[car] = policy.id;
    }

    // -- Customers -----------------------------------------------------------------
    const customers = {} as Record<CustomerKey | "aisha", string>;
    for (const [index, person] of CUSTOMERS.entries()) {
      const customer = await prisma.customer.create({
        data: {
          code: await nextCustomerCode(),
          fullName: person.fullName,
          mobile: `+97150000010${index}`,
          email: `${person.key}@example.com`,
          nationality: person.nationality,
          dateOfBirth: new Date(`${person.dob}T00:00:00Z`),
          addressLine: person.area,
          city: "Dubai",
          emergencyName: "Family contact",
          emergencyPhone: `+97150000090${index}`,
          createdById: sales,
        },
      });
      customers[person.key] = customer.id;
    }

    // -- Leads, and the one that became a contract ------------------------------
    const lead = async (
      name: string,
      index: number,
      source: "WEBSITE" | "WHATSAPP" | "REFERRAL" | "PHONE" | "WALK_IN",
      fields: { vehicle?: VehicleKey; budget: string; months: number; notes?: string },
    ) =>
      createLead(
        {
          name,
          mobile: `+97150000020${index}`,
          email: `${name.split(" ")[0]?.toLowerCase()}@example.com`,
          source,
          interestedVehicleId: fields.vehicle ? vehicles[fields.vehicle] : null,
          budgetFils: aed(fields.budget),
          durationMonths: fields.months,
          notes: fields.notes ?? null,
          salespersonId: sales,
        },
        sales,
      );

    await lead("Khalid Al Suwaidi", 1, "WEBSITE", {
      vehicle: "sunny",
      budget: "2500",
      months: 12,
      notes: "Starting a new job in Business Bay next month.",
    });
    const priya = await lead("Priya Nair", 2, "WHATSAPP", { vehicle: "pajero", budget: "3500", months: 24 });
    await changeLeadStatus(priya.id, "CONTACTED", { actorId: sales });
    const hamad = await lead("Hamad Al Ketbi", 3, "REFERRAL", {
      budget: "6500",
      months: 36,
      notes: "Referred by Ahmed Al Mansoori. Wants a family SUV.",
    });
    await changeLeadStatus(hamad.id, "CONTACTED", { actorId: sales });
    await changeLeadStatus(hamad.id, "QUALIFIED", { actorId: sales });
    const elena = await lead("Elena Petrova", 4, "PHONE", { vehicle: "pajero", budget: "3800", months: 24 });
    await saveQuote(
      elena.id,
      {
        vehicleId: vehicles.pajero,
        type: "LONG_TERM_RENTAL",
        durationMonths: 24,
        monthlyRentalFils: aed("3600"),
        annualInsuranceFils: aed("3000"),
      },
      sales,
    );
    const tariq = await lead("Tariq Mahmood", 5, "WALK_IN", { budget: "2000", months: 12 });
    await changeLeadStatus(tariq.id, "LOST", {
      actorId: sales,
      reason: "Chose a competitor with a lower down payment.",
    });
    const aishaLead = await lead("Aisha Rahman", 6, "WEBSITE", { vehicle: "seltos", budget: "3000", months: 24 });
    await saveQuote(
      aishaLead.id,
      { vehicleId: vehicles.seltos, type: "LONG_TERM_RENTAL", durationMonths: 24, monthlyRentalFils: aed("2900") },
      sales,
    );

    // -- Contracts -------------------------------------------------------------------
    const habits: PaymentHabit[] = [];
    const draft = async (
      customer: CustomerKey,
      car: VehicleKey,
      start: IsoDate,
      terms: {
        type?: "LONG_TERM_RENTAL" | "LEASE_TO_OWN";
        months: number;
        monthly: string;
        insurance?: string;
        down?: string;
        buyout?: string;
        allowanceKm?: number;
        excessRate?: string;
        salesperson?: string;
      },
      habit: Omit<PaymentHabit, "contractId" | "start" | "paid">,
    ) => {
      const contract = await createContract(
        {
          customerId: customers[customer],
          vehicleId: vehicles[car],
          type: terms.type ?? "LONG_TERM_RENTAL",
          startDate: start,
          durationMonths: terms.months,
          monthlyRentalFils: aed(terms.monthly),
          ...(terms.insurance ? { annualInsuranceFils: aed(terms.insurance) } : {}),
          ...(terms.down ? { downPaymentFils: aed(terms.down) } : {}),
          ...(terms.buyout ? { buyoutFils: aed(terms.buyout) } : {}),
          mileageAllowanceKm: terms.allowanceKm ?? null,
          excessMileageRateFils: terms.excessRate ? aed(terms.excessRate) : null,
          salespersonId: terms.salesperson ?? null,
        },
        sales,
      );
      habits.push({ contractId: contract.id, start, paid: 0, ...habit });
      return contract.id;
    };

    // The customer who falls behind: pays until two months ago, then stops. Two months
    // reads as a collections case; five would read as nobody chasing. Seven instalments,
    // because the first year's insurance is an instalment of its own.
    await draft(
      "rajesh",
      "camry",
      on(-7, -10),
      { months: 12, monthly: "3400", insurance: "2500", allowanceKm: 30000, excessRate: "0.40" },
      { delayDays: 3, stopAfter: 7, methods: ["CASH"] },
    );
    await draft(
      "maria",
      "hilux",
      on(-5, -20),
      { months: 6, monthly: "3100" },
      { delayDays: 1, methods: ["BANK_TRANSFER"] },
    );
    // A short contract that has already ended, with excess mileage settled at return.
    const danielContract = await draft(
      "daniel",
      "sunny",
      on(-5, -8),
      { months: 3, monthly: "2300", allowanceKm: 7500, excessRate: "0.40" },
      { delayDays: 4, methods: ["CARD"] },
    );
    await draft(
      "ahmed",
      "landcruiser",
      on(-5, -2),
      { months: 12, monthly: "6500", insurance: "4200", allowanceKm: 30000, excessRate: "0.50", salesperson: sales },
      { delayDays: 1, methods: ["BANK_TRANSFER"] },
    );
    await draft(
      "sara",
      "prado",
      on(-4, -1),
      { type: "LEASE_TO_OWN", months: 36, monthly: "4100", down: "10000", buyout: "1000" },
      { delayDays: 0, methods: ["BANK_TRANSFER"] },
    );
    // An instalment is overdue the day after it falls due, with no grace period, so the
    // customers who are meant to look reliable pay on the day or the next.
    await draft(
      "fatima",
      "patrol",
      on(-3, -6),
      { months: 24, monthly: "7200", insurance: "4800", allowanceKm: 60000, excessRate: "0.60", salesperson: sales },
      { delayDays: 0, methods: ["CARD", "BANK_TRANSFER"] },
    );
    // The second, much smaller, name on the overdue list: pays late, and only half of the
    // latest instalment. Next to Rajesh it shows the difference between a customer who is
    // a few days behind and one who has stopped paying.
    const omarContract = await draft(
      "omar",
      "sonata",
      on(-2, -12),
      { months: 12, monthly: "3200", salesperson: sales },
      { delayDays: 15, methods: ["TABBY", "CARD"] },
    );
    const yousefContract = await draft(
      "yousef",
      "lexus",
      on(-1, -3),
      { type: "LEASE_TO_OWN", months: 24, monthly: "4900", down: "15000", buyout: "1000" },
      { delayDays: 0, methods: ["BANK_TRANSFER"] },
    );
    // The lead that became a contract: the newest one on the books.
    const converted = await convertLead(aishaLead.id, { startDate: on(0, -9), actorId: sales });
    customers.aisha = converted.customerId;
    habits.push({
      contractId: converted.contract.id,
      start: on(0, -9),
      paid: 0,
      delayDays: 2,
      methods: ["TAMARA"],
    });

    const danielEnd = fromDbDate(
      (await prisma.contract.findUniqueOrThrow({ where: { id: danielContract }, select: { endDate: true } })).endDate,
    );

    // -- Replay the calendar -----------------------------------------------------
    const first = habits.map((habit) => habit.start).sort()[0] as IsoDate;
    let invoiceRef = 0;
    for (let day = first; compareIsoDates(day, TODAY) <= 0; day = addDays(day, 1)) {
      for (const habit of habits.filter((candidate) => candidate.start === day)) {
        await activateContract(habit.contractId, { actorId: operations, today: day });
      }

      await issueDueInstallments(day);
      await raiseDueSupplierInvoices(day);

      for (const habit of habits) {
        if (compareIsoDates(day, habit.start) < 0) continue;
        const owed = await prisma.installment.findMany({
          where: {
            contractId: habit.contractId,
            invoiceNumber: { not: null },
            waivedAt: null,
            dueDate: { lte: toDbDate(addDays(day, -habit.delayDays)) },
          },
          orderBy: [{ dueDate: "asc" }, { sequence: "asc" }],
          select: { grossFils: true, paidFils: true, invoiceNumber: true },
        });
        for (const item of owed) {
          if (item.paidFils >= item.grossFils) continue;
          if (habit.stopAfter !== undefined && habit.paid >= habit.stopAfter) break;
          await recordPayment(
            habit.contractId,
            {
              amountFils: item.grossFils - item.paidFils,
              receivedOn: day,
              method: habit.methods[habit.paid % habit.methods.length] as PaymentMethod,
              reference: item.invoiceNumber,
            },
            { actorId: finance, today: day },
          );
          habit.paid += 1;
        }
      }

      // DrivenX pays its supplier on the day each invoice falls due. A supplier invoice is
      // overdue the day after, and a demo should not show DrivenX late with its own lessor.
      const payable = await prisma.supplierInvoice.findMany({
        where: { raisedOn: { not: null }, dueDate: { lte: toDbDate(day) } },
        select: { id: true, grossFils: true, paidFils: true },
      });
      for (const invoice of payable) {
        if (invoice.paidFils >= invoice.grossFils) continue;
        invoiceRef += 1;
        await recordSupplierPayment(
          invoice.id,
          {
            amountFils: invoice.grossFils - invoice.paidFils,
            paidOn: day,
            method: "BANK_TRANSFER",
            reference: `GFL-TRF-${String(4100 + invoiceRef)}`,
          },
          { actorId: finance, today: day },
        );
      }

      if (day === danielEnd) {
        // The car comes back 1,900 km over its allowance. Settled at the counter.
        const returnedKm = 24600 + 9400;
        await recordMileage(vehicles.sunny, returnedKm, {
          note: "Returned at end of contract",
          actorId: operations,
          readAt: new Date(`${day}T00:00:00Z`),
        });
        const settlement = await openSettlement(danielContract, {
          reason: "END_OF_TERM",
          returnedMileageKm: returnedKm,
          actorId: operations,
        });
        await addSettlementLine(
          settlement.id,
          {
            kind: "CHARGE",
            chargeType: "EXCESS_MILEAGE",
            label: "Excess mileage: 1,900 km over the allowance at AED 0.40",
            netFils: aed("760"),
          },
          operations,
        );
        await settleSettlement(settlement.id, { actorId: finance, today: day });
        const finalInvoice = await prisma.installment.findFirst({
          where: { contractId: danielContract, invoiceNumber: { not: null } },
          orderBy: [{ dueDate: "desc" }, { createdAt: "desc" }],
          select: { grossFils: true, paidFils: true, invoiceNumber: true },
        });
        if (finalInvoice && finalInvoice.paidFils < finalInvoice.grossFils) {
          await recordPayment(
            danielContract,
            {
              amountFils: finalInvoice.grossFils - finalInvoice.paidFils,
              receivedOn: day,
              method: "CARD",
              reference: finalInvoice.invoiceNumber,
            },
            { actorId: finance, today: day },
          );
        }
        await terminateContract(danielContract, {
          outcome: "END_OF_TERM",
          vehicleTo: "RETURNED",
          actorId: operations,
          today: day,
        });
        await changeVehicleStatus(vehicles.sunny, "AVAILABLE", {
          actorId: operations,
          reason: "Cleaned and inspected after return",
        });
      }
    }

    // Omar pays half of what is still open.
    const omarOpen = await prisma.installment.findFirst({
      where: { contractId: omarContract, invoiceNumber: { not: null }, waivedAt: null },
      orderBy: [{ dueDate: "desc" }],
      select: { grossFils: true, paidFils: true, invoiceNumber: true },
    });
    if (omarOpen && omarOpen.paidFils < omarOpen.grossFils) {
      await recordPayment(
        omarContract,
        {
          amountFils: (omarOpen.grossFils - omarOpen.paidFils) / 2n,
          receivedOn: TODAY,
          method: "CASH",
          reference: omarOpen.invoiceNumber,
          notes: "Paid half; the rest promised at the end of the month.",
        },
        { actorId: finance, today: TODAY },
      );
    }

    // -- Handover, signed, for the newest lease-to-own -----------------------------
    const yousefStart = habits.find((habit) => habit.contractId === yousefContract)?.start as IsoDate;
    const handover = await recordHandover(
      {
        contractId: yousefContract,
        type: "HANDOVER",
        occurredAt: new Date(`${yousefStart}T10:30:00+04:00`),
        odometerKm: 2100,
        fuelEighths: 8,
        conditionNotes: "Delivered clean. Spare wheel, jack and two keys handed over.",
        damagePoints: [
          { positionX: 0.76, positionY: 0.41, severity: "MINOR", note: "Light scratch on the front right door" },
          { panel: "WHEELS", severity: "MINOR", note: "Kerb rash on the front left alloy" },
        ],
      },
      operations,
    );
    const signatureKeys: string[] = [];
    for (const seed of [2, 5]) {
      const key = buildObjectKey("signature", handover.id, "image/png");
      await storage.put({ key, bytes: signaturePng(seed), mimeType: "image/png", fileName: "signature.png" });
      signatureKeys.push(key);
    }
    await signHandover(
      handover.id,
      {
        customerSignatureKey: signatureKeys[0] as string,
        customerSignatureName: "Yousef Al Hashimi",
        staffSignatureKey: signatureKeys[1] as string,
        staffSignatureName: "Karim Nasser",
      },
      operations,
    );

    // -- Keeping cars on the road ----------------------------------------------------
    await recordMaintenance(
      {
        vehicleId: vehicles.landcruiser,
        type: "SERVICE",
        servicedOn: on(-2, -5),
        odometerKm: 14500,
        vendor: "Desert Auto Care",
        vendorInvoiceNumber: "DAC-24-1187",
        description: "20,000 km service: oil, filters, brake check",
        costNetFils: aed("1150"),
        nextServiceOn: on(4),
        nextServiceKm: 24500,
      },
      operations,
    );
    await recordMaintenance(
      {
        vehicleId: vehicles.patrol,
        type: "SERVICE",
        servicedOn: on(0, -21),
        odometerKm: 11000,
        vendor: "Desert Auto Care",
        vendorInvoiceNumber: "DAC-24-1342",
        description: "10,000 km service",
        costNetFils: aed("1350"),
        nextServiceOn: on(6),
        nextServiceKm: 21000,
      },
      operations,
    );
    // Due for service within the fortnight, so it appears in the alerts.
    await recordMaintenance(
      {
        vehicleId: vehicles.camry,
        type: "SERVICE",
        servicedOn: on(-6, 15),
        odometerKm: 26900,
        vendor: "Desert Auto Care",
        vendorInvoiceNumber: "DAC-24-0961",
        description: "Six-month service",
        costNetFils: aed("680"),
        nextServiceOn: on(0, 9),
        nextServiceKm: 36900,
      },
      operations,
    );
    await recordMaintenance(
      {
        vehicleId: vehicles.hilux,
        type: "TYRES",
        servicedOn: on(-1, -4),
        odometerKm: 19600,
        vendor: "Gulf Tyre Centre",
        vendorInvoiceNumber: "GTC-7731",
        description: "Four new tyres and alignment",
        costNetFils: aed("2400"),
      },
      operations,
    );
    await recordMaintenance(
      {
        vehicleId: vehicles.pajero,
        type: "INSPECTION",
        servicedOn: on(0, -12),
        odometerKm: 18950,
        vendor: "Desert Auto Care",
        description: "Pre-lease inspection",
        costNetFils: aed("320"),
      },
      operations,
    );

    // -- Fines: one recharged, one still open, one the customer paid themselves ---------
    const speeding = await recordFine(
      {
        vehicleId: vehicles.patrol,
        fineNumber: "DXB-SPD-48213",
        authority: "Dubai Police",
        occurredOn: on(-1, -10),
        issuedOn: on(-1, -3),
        amountFils: aed("600"),
      },
      operations,
    );
    await transitionFine(speeding.id, { to: "PAID", paidOn: on(-1, 0), actorId: finance });
    await recoverFine(speeding.id, { actorId: finance, today: TODAY });

    await recordFine(
      {
        vehicleId: vehicles.camry,
        fineNumber: "RTA-PRK-77120",
        authority: "RTA",
        occurredOn: on(0, -20),
        issuedOn: on(0, -12),
        amountFils: aed("200"),
      },
      operations,
    );

    const redLight = await recordFine(
      {
        vehicleId: vehicles.sonata,
        fineNumber: "DXB-PRK-30981",
        authority: "Dubai Police",
        occurredOn: on(-1, -2),
        issuedOn: on(0, -25),
        amountFils: aed("400"),
      },
      operations,
    );
    await transitionFine(redLight.id, { to: "PAID_BY_CUSTOMER", actorId: operations });

    // -- An accident: repaired, claimed, and the excess left with DrivenX --------------
    const crash = await recordAccident(
      {
        vehicleId: vehicles.camry,
        occurredOn: on(-3, -2),
        location: "Al Khail Road, near exit 34",
        description: "Hit another car while changing lanes. Front bumper and bonnet damaged.",
        responsibility: "CUSTOMER",
        policeReportNumber: "DXB-ACC-2026-118204",
      },
      operations,
    );
    await transitionAccident(crash.id, { to: "UNDER_REPAIR", actorId: operations });
    await recordRepair(crash.id, { repairNetFils: aed("4800"), vendor: "Marina Bodyshop", repairedOn: on(-3, 8) });
    await transitionAccident(crash.id, { to: "REPAIRED", actorId: operations });
    const claim = await lodgeClaim(
      {
        accidentId: crash.id,
        policyId: policies.camry ?? null,
        claimNumber: "OIC-CLM-55120",
        lodgedOn: on(-3, 1),
        claimedFils: aed("4800"),
      },
      operations,
    );
    await transitionClaim(claim.id, { to: "APPROVED", approvedFils: aed("4300"), actorId: finance });
    await transitionClaim(claim.id, {
      to: "SETTLED",
      receivedFils: aed("4300"),
      settledOn: on(-2, 5),
      actorId: finance,
    });

    // -- Expenses ----------------------------------------------------------------------
    for (let month = -5; month <= 0; month += 1) {
      await recordExpense(
        {
          category: "OVERHEAD",
          allocation: "COMPANY",
          incurredOn: firstOf(month),
          description: "Office rent",
          supplierName: "Business Bay Properties",
          netFils: aed("6500"),
          vatBasisPoints: 500,
        },
        finance,
      );
      await recordExpense(
        {
          category: "OVERHEAD",
          allocation: "COMPANY",
          incurredOn: firstOf(month),
          description: "Software and hosting",
          netFils: aed("450"),
        },
        finance,
      );
    }
    await recordExpense(
      {
        category: "REGISTRATION",
        allocation: "VEHICLE",
        vehicleId: vehicles.landcruiser,
        incurredOn: on(-2, -1),
        description: "Registration renewal",
        netFils: aed("420"),
      },
      operations,
    );
    await recordExpense(
      {
        category: "FUEL",
        allocation: "VEHICLE",
        vehicleId: vehicles.pajero,
        incurredOn: on(0, -6),
        description: "Fuel before a customer viewing",
        netFils: aed("180"),
      },
      operations,
    );
    await recordExpense(
      {
        category: "CLEANING",
        allocation: "VEHICLE",
        vehicleId: vehicles.prado,
        incurredOn: on(-1, -8),
        description: "Full valet",
        netFils: aed("120"),
      },
      operations,
    );
    await recordExpense(
      {
        category: "RECOVERY",
        allocation: "VEHICLE",
        vehicleId: vehicles.camry,
        incurredOn: on(-3, -2),
        description: "Tow from the accident scene",
        netFils: aed("350"),
      },
      operations,
    );

    // -- Documents, some of them about to run out ----------------------------------------
    const categories = new Map(
      (await prisma.documentCategory.findMany()).map((category) => [category.key, category]),
    );
    const attach = async (
      ownerType: DocumentOwnerType,
      ownerId: string,
      categoryKey: string,
      documentNumber: string,
      expiresOn: IsoDate,
      description: readonly string[],
    ) => {
      const category = categories.get(categoryKey);
      if (!category) return;
      const bytes = samplePdf(`${category.label} ${documentNumber}`, description);
      const key = buildObjectKey(ownerType, ownerId, "application/pdf");
      await storage.put({ key, bytes, mimeType: "application/pdf", fileName: `${categoryKey}.pdf` });
      const expiryDate = toDbDate(expiresOn);
      const state = expiryStatus(expiryDate, category.defaultReminderOffsets, new Date());
      await prisma.document.create({
        data: {
          ownerType,
          ownerId,
          categoryId: category.id,
          documentNumber,
          issueDate: toDbDate(addMonths(expiresOn, -24)),
          expiryDate,
          fileKey: key,
          fileName: `${categoryKey}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: bytes.byteLength,
          status: state === "expired" ? "EXPIRED" : state === "expiring" ? "EXPIRING" : "VALID",
          reminderOffsets: category.defaultReminderOffsets,
          uploadedById: operations,
        },
      });
    };

    const idExpiry: Record<CustomerKey | "aisha", IsoDate> = {
      ahmed: on(19),
      fatima: on(26),
      // Within the month: the scan raises it.
      rajesh: on(0, 18),
      sara: on(14),
      omar: on(22),
      // Already expired: the most urgent alert on the list.
      maria: on(0, -5),
      yousef: on(31),
      daniel: on(11),
      aisha: on(17),
    };
    for (const [index, [person, expiresOn]] of Object.entries(idExpiry).entries()) {
      await attach("CUSTOMER", customers[person as CustomerKey | "aisha"], "emirates_id", `784-19${80 + index}-${String(4021733 + index * 811)}-${index % 9}`, expiresOn, [
        "Emirates ID (front and back)",
      ]);
    }
    await attach("CUSTOMER", customers.ahmed, "driving_licence", "DXB-DL-2210485", on(30), ["UAE driving licence"]);
    // Inside the sixty-day warning.
    await attach("CUSTOMER", customers.omar, "driving_licence", "DXB-DL-3387120", on(0, 40), ["UAE driving licence"]);
    await attach("CUSTOMER", customers.daniel, "driving_licence", "DXB-DL-4473019", on(12), ["UAE driving licence"]);

    const mulkiyaExpiry: Partial<Record<VehicleKey, IsoDate>> = {
      landcruiser: on(10),
      patrol: on(9),
      camry: on(6),
      prado: on(8),
      // Registration running out within the month.
      sonata: on(0, 25),
      hilux: on(11),
      lexus: on(11),
      seltos: on(12),
      sunny: on(4),
      pajero: on(7),
    };
    for (const [car, expiresOn] of Object.entries(mulkiyaExpiry)) {
      const vehicle = VEHICLES.find((candidate) => candidate.key === car);
      await attach("VEHICLE", vehicles[car as VehicleKey], "mulkiya", `DXB-${vehicle?.plateCode}-${vehicle?.plateNumber}`, expiresOn as IsoDate, [
        "Vehicle registration card (mulkiya)",
        `${vehicle?.make} ${vehicle?.model} ${vehicle?.year}`,
      ]);
    }
    await attach("SUPPLIER", lessor.id, "trade_licence", "DED-1029384", on(8), ["Trade licence"]);

    // -- Where everything stands today ----------------------------------------------
    await refreshOverdue(TODAY);
    await refreshSupplierOverdue(TODAY);

    const counts = {
      vehicles: await prisma.vehicle.count(),
      customers: await prisma.customer.count(),
      contracts: await prisma.contract.count(),
      invoices: await prisma.installment.count({ where: { invoiceNumber: { not: null } } }),
      payments: await prisma.payment.count(),
      ledger: await prisma.ledgerEntry.count(),
      documents: await prisma.document.count(),
      leads: await prisma.lead.count(),
    };
    const overdue = await prisma.contract.count({ where: { status: "OVERDUE" } });

    console.log(
      `Done: ${counts.vehicles} cars, ${counts.customers} customers, ${counts.contracts} contracts ` +
        `(${overdue} overdue), ${counts.invoices} invoices, ${counts.payments} payments, ` +
        `${counts.ledger} ledger entries, ${counts.documents} documents, ${counts.leads} leads.`,
    );
    console.log("Demo staff, all with DEMO_STAFF_PASSWORD:");
    for (const person of STAFF) console.log(`  ${person.email.padEnd(28)} ${person.role}`);
    console.log("Now run the nightly jobs once, so the alerts appear: expiry-scan, maintenance-due.");
  });
}

main()
  .catch((error) => {
    console.error("Demo seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
