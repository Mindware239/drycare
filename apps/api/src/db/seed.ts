/**
 * Demo data for local development: the hypothetical "CleanCare Garment Services" from the case study.
 * Safe to re-run — it skips creation if the demo owner already exists.
 */
import { hash } from "@node-rs/argon2";
import { and, eq } from "drizzle-orm";
import { db, schema, sqlClient } from "./client";
import { provisionOrganization } from "../lib/provision";
import { nextNumber, pad } from "../lib/sequences";

const OWNER_EMAIL = "owner@cleancare.test";
const PASSWORD = "DryCare@2026";

const existing = await db.query.users.findFirst({ where: eq(schema.users.email, OWNER_EMAIL) });
if (existing) {
  console.log("Demo data already present.");
} else {
  await db.transaction(async (tx) => {
    const passwordHash = await hash(PASSWORD);
    const [owner] = await tx.insert(schema.users).values({ email: OWNER_EMAIL, name: "Anita Verma", passwordHash }).returning();
    const { org, branch } = await provisionOrganization(tx, {
      businessName: "CleanCare Garment Services",
      gstin: "27ABCDE1234F1Z5",
      branchName: "Andheri Main Store",
      branchCode: "AND",
      phone: "+91 98200 00000",
      city: "Mumbai",
      ownerUserId: owner.id,
    });
    await tx.update(schema.organizations).set({ status: "active" }).where(eq(schema.organizations.id, org.id));

    const staff: [string, string, string][] = [
      ["reception@cleancare.test", "Rohit Patil", "reception"],
      ["qc@cleancare.test", "Meena Iyer", "inspector"],
      ["operator@cleancare.test", "Suresh Kumar", "operator"],
      ["manager@cleancare.test", "Farhan Shaikh", "manager"],
    ];
    for (const [email, name, roleKey] of staff) {
      const [u] = await tx.insert(schema.users).values({ email, name, passwordHash }).returning();
      const role = await tx.query.roles.findFirst({ where: and(eq(schema.roles.organizationId, org.id), eq(schema.roles.key, roleKey)) });
      await tx.insert(schema.memberships).values({ organizationId: org.id, userId: u.id, roleId: role!.id });
    }

    const customers: [string, string, string][] = [
      ["Rahul Sharma", "+91 98765 43210", "regular"],
      ["Priya Nair", "+91 99887 76655", "vip"],
      ["Hotel Sea Breeze", "+91 22 2600 1122", "corporate"],
    ];
    for (const [name, phone, type] of customers) {
      const n = await nextNumber(tx, org.id, "customer");
      await tx.insert(schema.customers).values({
        organizationId: org.id,
        customerCode: `C-${pad(n)}`,
        name,
        phone,
        phoneNormalized: phone.replace(/\D/g, "").slice(-10),
        customerType: type,
        homeBranchId: branch.id,
      });
    }
    console.log(`Seeded "${org.name}" (${branch.branchCode}).`);
  });
}
console.log(`\nDemo logins (password for all: ${PASSWORD}):\n  owner@cleancare.test (Owner)\n  manager@cleancare.test (Manager)\n  reception@cleancare.test (Reception)\n  qc@cleancare.test (Quality inspector)\n  operator@cleancare.test (Cleaning operator)`);
await sqlClient.end();
