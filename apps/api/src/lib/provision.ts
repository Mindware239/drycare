import { randomBytes } from "node:crypto";
import { SYSTEM_ROLES } from "@drycare/shared";
import { STANDARD_SERVICES, installStandardCatalogue } from "./standardCatalogue";
import { schema, type Tx } from "../db/client";

export function slugify(name: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  return `${base || "business"}-${randomBytes(3).toString("hex")}`;
}

export async function provisionOrganization(
  tx: Tx,
  input: { businessName: string; gstin?: string; branchName: string; branchCode: string; phone?: string; city?: string; state?: string; businessType?: string; outletCount?: number; counterCount?: number; ownerUserId: string; status?: "trial" | "active"; trialStartedAt?: Date; trialEndsAt?: Date; trialSource?: string },
) {
  const [org] = await tx
    .insert(schema.organizations)
    .values({
      name: input.businessName,
      slug: slugify(input.businessName),
      gstin: input.gstin,
      status: input.status ?? "trial",
      trialStartedAt: input.trialStartedAt,
      trialEndsAt: input.trialEndsAt,
      trialSource: input.trialSource,
      settings: {
        maxDiscountBpsWithoutApproval: 1000,
        expressSurchargeBps: 5000,
        defaultTurnaroundHours: 48,
        ...(input.state ? { state: input.state } : {}),
        ...(input.businessType ? { businessType: input.businessType } : {}),
        ...(input.outletCount ? { outletCount: input.outletCount } : {}),
        ...(input.counterCount ? { counterCount: input.counterCount } : {}),
      },
    })
    .returning();

  const roleRows = await tx
    .insert(schema.roles)
    .values(SYSTEM_ROLES.map((r) => ({ organizationId: org.id, key: r.key, name: r.name, permissions: r.permissions })))
    .returning();
  const ownerRole = roleRows.find((r) => r.key === "owner")!;

  const [branch] = await tx
    .insert(schema.branches)
    .values({ organizationId: org.id, name: input.branchName, branchCode: input.branchCode, phone: input.phone, address: input.city ? { city: input.city } : {} })
    .returning();

  await tx.insert(schema.memberships).values({ organizationId: org.id, userId: input.ownerUserId, roleId: ownerRole.id });

  await tx.insert(schema.storageLocations).values(
    ["A1", "A2", "A3", "B1", "B2", "B3"].map((code) => ({ organizationId: org.id, branchId: branch.id, code, description: `Rack ${code}` })),
  );

  await tx
    .insert(schema.services)
    .values(STANDARD_SERVICES.map((s) => ({ organizationId: org.id, name: s.name, category: s.category, serviceCode: s.code, unitType: s.unit, workflowStages: s.stages })));
  // Full built-in garment list with starting prices; owners adjust prices in Services & prices.
  await installStandardCatalogue(tx, org.id);

  return { org, branch };
}
