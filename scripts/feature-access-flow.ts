/**
 * Who can use what, against a real database: plans, one customer's exceptions, temporary access, the global switch, and
 * direct API calls. Run: pnpm feature-access-test (needs `pnpm admin:create` once).
 * Uses fresh @test.local shops and its own test plans. It restores the global settings it changes, even when a check fails.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { buildServer } from "../apps/api/src/app";
import { db, schema, sqlClient } from "../apps/api/src/db/client";

const app = await buildServer();
let failures = 0;
const results: string[] = [];
function check(label: string, cond: boolean, extra?: unknown) {
  if (cond) results.push(`  ✓ ${label}`);
  else {
    failures++;
    results.push(`  ✗ ${label}${extra !== undefined ? `  → ${JSON.stringify(extra).slice(0, 500)}` : ""}`);
  }
}
const section = (t: string) => results.push(`\n${t}`);

class Client {
  cookie = "";
  async req(method: string, url: string, body?: unknown) {
    const res = await app.inject({ method: method as "GET", url: `/api/v1${url}`, payload: body as object, headers: { cookie: this.cookie, "x-drycare-csrf": "1" } });
    const set = res.headers["set-cookie"];
    if (set) this.cookie = (Array.isArray(set) ? set[0] : set).split(";")[0];
    let json: any;
    try {
      json = res.json();
    } catch {}
    return { status: res.statusCode, json };
  }
}

const runId = randomUUID().slice(0, 6);
const platformOrg = await db.query.organizations.findFirst({ where: (o, { eq }) => eq(o.slug, "drycare-platform") });
const platformRole = platformOrg && (await db.query.roles.findFirst({ where: (r, { and, eq }) => and(eq(r.organizationId, platformOrg.id), eq(r.key, "platform_admin")) }));
if (!platformOrg || !platformRole) throw new Error("Run pnpm admin:create once before this test.");
const [saUser] = await db.insert(schema.users).values({ email: `sa-access-${runId}@test.local`, name: "Access Test Admin", passwordHash: "x", isPlatformAdmin: true }).returning();
await db.insert(schema.memberships).values({ organizationId: platformOrg.id, userId: saUser.id, roleId: platformRole.id });
const token = randomBytes(32).toString("base64url");
await db.insert(schema.sessions).values({ id: createHash("sha256").update(token).digest("hex"), userId: saUser.id, organizationId: platformOrg.id, expiresAt: new Date(Date.now() + 3_600_000) });
const sa = new Client();
sa.cookie = `dc_session=${token}`;

async function shop(name: string) {
  const c = new Client();
  await c.req("POST", "/organizations", { businessName: `${name} ${runId}`, ownerName: "Owner", email: `owner-${name.toLowerCase()}-${runId}@test.local`.replace(/\s/g, ""), password: `Access-${runId}-Password1`, acceptedTerms: true });
  const session = (await c.req("GET", "/auth/session")).json;
  return { c, id: session.organization.id as string, branchId: session.branches[0].id as string };
}
const session = async (c: Client) => (await c.req("GET", "/auth/session")).json;
const plan = async (name: string, entitlements: Record<string, boolean>) =>
  (await db.insert(schema.commercialPlans).values({ code: `smoke-access-${name.toLowerCase()}-${runId}`, name: `${name} ${runId}`, pricePaise: 100000, interval: "month", published: true, sortOrder: 900, entitlements }).returning())[0];
const subscribe = (orgId: string, planId: string) => sa.req("POST", `/platform-admin/organizations/${orgId}/subscription`, { planId, endsOn: "2099-12-31", reason: "Automated access test" });
const exception = (orgId: string, overrides: object, expires?: object) => sa.req("PUT", `/platform-admin/organizations/${orgId}/entitlements`, { overrides, expires, reason: "Automated access test" });

const registryBefore = (await db.query.platformSettings.findFirst({ where: (s, { eq }) => eq(s.key, "feature_registry") }))?.value ?? null;
const OFF = { inventory: false, expenses: false, reports: false, advancedReports: false, claims: false, staffManagement: false };
const starter = await plan("Starter", OFF);
const professional = await plan("Professional", { inventory: true, expenses: true, reports: true, advancedReports: true, claims: true, staffManagement: true });

try {
  const a = await shop("Access A");
  const b = await shop("Access B");

  section("A trial shows everything");
  check("a new shop can use stock", (await a.c.req("GET", "/suppliers")).status === 200);

  section("Test 1 and 2: a customer on Starter");
  check("the plan is assigned", (await subscribe(a.id, starter.id)).status === 201);
  await subscribe(b.id, starter.id);
  let r = await a.c.req("GET", "/suppliers");
  check("a direct request for stock is refused by the server", r.status === 403 && r.json.error.code === "FEATURE_NOT_IN_PLAN", r.json);
  for (const [label, url] of [["expenses", "/expenses"], ["claims", "/claims"], ["reports", "/reports/catalogue"]]) {
    check(`so is ${label}`, (await a.c.req("GET", url)).status === 403);
  }
  r = await a.c.req("POST", "/staff", { name: "New person" });
  check("adding staff is refused", r.status === 403, r.json);
  check("the staff list can still be read, for naming people", (await a.c.req("GET", "/staff")).status === 200);
  check("core screens keep working", (await a.c.req("GET", "/customers")).status === 200 && (await a.c.req("GET", "/orders")).status === 200);
  let locks = (await session(a.c)).featureLocks;
  check("the screen is told why, and which plans have it", locks.inventory?.reason === "plan" && locks.inventory.plans.includes(professional.name) && !locks.inventory.plans.includes(starter.name) && locks.inventory.currentPlan === starter.name, locks.inventory);

  section("Test 3, 4 and 5: one customer's exception");
  check("the owner gives this customer stock", (await exception(a.id, { inventory: true })).status === 200);
  check("they can use it at once, on the same plan", (await a.c.req("GET", "/suppliers")).status === 200);
  check("another customer on that plan is unaffected", (await b.c.req("GET", "/suppliers")).status === 403);
  const stored = await db.query.commercialPlans.findFirst({ where: (p, { eq }) => eq(p.id, starter.id) });
  check("the plan itself is not changed", stored?.entitlements.inventory === false);
  await exception(a.id, {});
  check("removing it takes it away at once", (await a.c.req("GET", "/suppliers")).status === 403);

  section("Blocking a feature the plan includes");
  await subscribe(a.id, professional.id);
  check("on Professional they have stock", (await a.c.req("GET", "/suppliers")).status === 200);
  await exception(a.id, { inventory: false });
  r = await a.c.req("GET", "/suppliers");
  check("the owner can block it for them", r.status === 403 && r.json.error.code === "FEATURE_DISABLED", r.json);
  locks = (await session(a.c)).featureLocks;
  check("no upgrade is offered, because an upgrade would not help", locks.inventory?.reason === "admin" && locks.inventory.plans.length === 0, locks.inventory);
  check("the rest of the plan still works", (await a.c.req("GET", "/expenses")).status === 200);
  await exception(a.id, {});

  section("Temporary access");
  await subscribe(a.id, starter.id);
  r = await exception(a.id, { inventory: true }, { inventory: "2020-01-01" });
  check("an end date in the past is refused", r.status === 409, r.json);
  r = await exception(a.id, { inventory: true }, { inventory: "2099-01-01" });
  check("an end date in the future is accepted", r.status === 200, r.json);
  check("it works until then", (await a.c.req("GET", "/suppliers")).status === 200);
  await sqlClient`update organizations set feature_override_expiry_json = ${JSON.stringify({ inventory: new Date(Date.now() - 1000).toISOString() })}::jsonb where id = ${a.id}`;
  check("it stops by itself when the date passes", (await a.c.req("GET", "/suppliers")).status === 403);
  await exception(a.id, {});

  section("Test 7 and 8: upgrade and downgrade");
  await subscribe(a.id, professional.id);
  const expense = await a.c.req("POST", "/expenses", { branchId: a.branchId, category: "Other", amount: 12300, description: "Kept through a downgrade", paidOn: new Date().toISOString().slice(0, 10), paymentMode: "cash", method: "cash", fromDrawer: false });
  const count = async () => (await sqlClient`select count(*)::int as n from expenses where organization_id = ${a.id}`)[0].n as number;
  check("upgrading grants the new features at once", (await a.c.req("GET", "/expenses")).status === 200, expense.json);
  const before = await count();
  await subscribe(a.id, starter.id);
  check("downgrading locks them at once", (await a.c.req("GET", "/expenses")).status === 403);
  check("the shop's records are kept", (await count()) === before && before >= (expense.status < 300 ? 1 : 0), { before });
  await subscribe(a.id, professional.id);
  check("upgrading again opens them again", (await a.c.req("GET", "/expenses")).status === 200);

  section("Depends on");
  await exception(a.id, { reports: false });
  const f = (await session(a.c)).features;
  check("advanced reports go off with reports", f.reports === false && f.advancedReports === false, f);
  await exception(a.id, {});

  section("The global switch");
  check("the feature list is for the owner only", (await a.c.req("GET", "/platform-admin/features")).status === 401 || (await a.c.req("GET", "/platform-admin/features")).status === 403);
  r = await sa.req("GET", "/platform-admin/features");
  check("the owner sees every feature and who has it", r.status === 200 && r.json.features.some((x: any) => x.key === "inventory" && Array.isArray(x.plans)) && typeof r.json.summary.customers === "number", r.json.summary);
  r = await sa.req("PUT", "/platform-admin/features/inventory", { enabled: false, upgradeMessage: "", reason: "Automated access test" });
  check("the owner turns stock off for everyone", r.status === 200, r.json);
  r = await a.c.req("GET", "/suppliers");
  check("even a plan that includes it loses it", r.status === 403 && r.json.error.code === "FEATURE_UNAVAILABLE", r.json);
  await exception(b.id, { inventory: true });
  check("even a customer exception cannot beat it", (await b.c.req("GET", "/suppliers")).status === 403);
  locks = (await session(a.c)).featureLocks;
  check("no upgrade is offered", locks.inventory?.reason === "global" && locks.inventory.plans.length === 0, locks.inventory);
  await sa.req("PUT", "/platform-admin/features/inventory", { enabled: true, upgradeMessage: "Track every litre of solvent.", reason: "Automated access test" });
  check("turning it back on restores it", (await a.c.req("GET", "/suppliers")).status === 200);
  await exception(b.id, {});
  locks = (await session(b.c)).featureLocks;
  check("the owner's own upgrade wording reaches the shop", locks.inventory?.message === "Track every litre of solvent.", locks.inventory);

  section("Every change is recorded");
  const logged = await sqlClient`select count(*)::int as n from audit_logs where action in ('platform.features_changed', 'platform.feature_settings_changed') and (organization_id = ${a.id} or actor_user_id = ${saUser.id})`;
  check("the audit log has them", logged[0].n > 5, logged[0]);
} finally {
  await sqlClient`delete from platform_settings where key = 'feature_registry'`;
  if (registryBefore) await sqlClient`insert into platform_settings (key, value_json) values ('feature_registry', ${JSON.stringify(registryBefore)}::jsonb)`;
  await sqlClient`update commercial_plans set published = false where id in (${starter.id}, ${professional.id})`;
}

console.log(results.join("\n"));
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
await app.close();
await sqlClient.end();
process.exit(failures ? 1 : 0);
