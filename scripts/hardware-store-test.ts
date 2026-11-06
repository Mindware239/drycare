/**
 * The hardware store on the website, against the running server (API_URL, default http://127.0.0.1:4000): what the public
 * sees, prices and totals, the delivery charge, picture uploads and enquiries. Run: pnpm hardware-store-test.
 * Puts the owner's saved store back at the end.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import path from "node:path";
import { DEFAULT_HARDWARE_STORE, packagePrice } from "../packages/shared/src/hardwareStore";
import { db, schema, sqlClient } from "../apps/api/src/db/client";

const CLOUD = process.env.API_URL ?? "http://127.0.0.1:4000";
let failures = 0;
const results: string[] = [];
const check = (label: string, ok: boolean, extra?: unknown) => {
  if (ok) results.push(`  ✓ ${label}`);
  else { failures++; results.push(`  ✗ ${label}${extra !== undefined ? `  → ${JSON.stringify(extra).slice(0, 400)}` : ""}`); }
};
const section = (t: string) => results.push(`\n${t}`);
const run = randomUUID().slice(0, 6);
const org = await db.query.organizations.findFirst({ where: (o, { eq }) => eq(o.slug, "drycare-platform") });
const role = org && (await db.query.roles.findFirst({ where: (r, { and, eq }) => and(eq(r.organizationId, org.id), eq(r.key, "platform_admin")) }));
if (!org || !role) throw new Error("Run pnpm admin:create once before this test.");
const [user] = await db.insert(schema.users).values({ email: `sa-store-${run}@test.local`, name: "Store Test Admin", passwordHash: "x", isPlatformAdmin: true }).returning();
await db.insert(schema.memberships).values({ organizationId: org.id, userId: user.id, roleId: role.id });
const token = randomBytes(32).toString("base64url");
await db.insert(schema.sessions).values({ id: createHash("sha256").update(token).digest("hex"), userId: user.id, organizationId: org.id, expiresAt: new Date(Date.now() + 3_600_000) });
const auth = { cookie: `dc_session=${token}`, "x-drycare-csrf": "1" };
const sa = async (method: string, url: string, body?: unknown) => {
  const res = await fetch(`${CLOUD}/api/v1${url}`, { method, headers: { ...auth, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
};
const pub = async () => (await fetch(`${CLOUD}/api/v1/commercial/hardware-store`)).json() as Promise<any>;
const [saved] = await sqlClient`select value_json from platform_settings where key = ${"hardware_store"}`;
const made: string[] = [];
const clone = () => JSON.parse(JSON.stringify(DEFAULT_HARDWARE_STORE));

try {
  section("Your list");
  const want = ["Barcode Printer", "Barcode Scanner", "Barcode Labels", "Taffeta Rolls", "External Taffeta Stand", "Barcode Ribbon", "Bill Printer", "Billing Rolls", "Cash Drawer"];
  check("all nine items are in the starting list", want.every((n: string) => DEFAULT_HARDWARE_STORE.products.some((p: any) => p.name === n)));
  check("the charge in India starts at ₹5,000", DEFAULT_HARDWARE_STORE.deliveryChargePaise === 500000);
  check("no price is made up", DEFAULT_HARDWARE_STORE.products.every((p: any) => p.pricePaise === null));
  check("consumables are kept apart from equipment", ["Barcode Labels", "Taffeta Rolls", "Barcode Ribbon", "Billing Rolls"].every((n: string) => DEFAULT_HARDWARE_STORE.products.find((p: any) => p.name === n)?.kind === "consumable") && ["Barcode Printer", "Barcode Scanner", "External Taffeta Stand", "Bill Printer", "Cash Drawer"].every((n: string) => DEFAULT_HARDWARE_STORE.products.find((p: any) => p.name === n)?.kind === "equipment"));
  const needs = DEFAULT_HARDWARE_STORE.packages.filter((p: any) => p.items.some((l: any) => l.product === "taffeta-rolls"));
  check("every package with taffeta also has ribbon to print on it", needs.every((p: any) => p.items.some((l: any) => l.product === "barcode-ribbon")));

  section("With no prices");
  let r = await sa("PUT", "/platform-admin/hardware-store", clone());
  check("the owner can save", r.status === 200, r.json);
  let s = await pub();
  check("the public sees the products and three packages", s.products.length === 9 && s.packages.length === 3 && s.categories.length === 3, s.packages?.length);
  check("a package lists what is in it, with quantities", s.packages[0].items.every((l: any) => l.name && l.qty >= 1) && s.packages[0].includesSoftware === true);
  check("a package shows no total until it has every price", s.packages.every((p: any) => p.hardwarePaise === null));
  check("the delivery charge is public", s.deliveryChargePaise === 500000);

  section("With prices");
  const priced = clone();
  priced.products.forEach((p: any, i: number) => { p.pricePaise = (i + 1) * 100000; });
  priced.products.find((p: any) => p.key === "taffeta-stand").pricePaise = null;
  r = await sa("PUT", "/platform-admin/hardware-store", priced);
  s = await pub();
  const starter = priced.packages.find((p: any) => p.key === "starter");
  const expected = 1 * 100000 + 1 * 200000 + 2 * 300000;
  check("price × quantity adds up", packagePrice(starter, priced.products) === expected && s.packages.find((p: any) => p.key === "starter").hardwarePaise === expected, s.packages[0]);
  check("a package missing one price still shows no total, not a low one", s.packages.find((p: any) => p.key === "complete").hardwarePaise === null);
  const zero = clone();
  zero.deliveryChargePaise = 750000;
  await sa("PUT", "/platform-admin/hardware-store", zero);
  check("the owner can change the charge", (await pub()).deliveryChargePaise === 750000);

  section("Hiding and changing");
  const hidden = clone();
  hidden.products.find((p: any) => p.key === "cash-drawer").published = false;
  hidden.packages.find((p: any) => p.key === "complete").published = false;
  await sa("PUT", "/platform-admin/hardware-store", hidden);
  s = await pub();
  check("a hidden product leaves the catalogue", !s.products.some((p: any) => p.key === "cash-drawer"));
  check("a hidden package leaves the page", !s.packages.some((p: any) => p.key === "complete"));
  check("a package still says it includes that product", s.packages.find((p: any) => p.key === "professional").items.some((l: any) => l.product === "cash-drawer"));

  section("Refused");
  const lost = clone();
  lost.packages[0].items.push({ product: "not-a-product", qty: 1 });
  r = await sa("PUT", "/platform-admin/hardware-store", lost);
  check("a package cannot include a product that does not exist", r.status === 422 && r.json.error.code === "PACKAGE_PRODUCT_MISSING", r.json);
  const twice = clone();
  twice.products.push({ ...twice.products[0] });
  check("nor can two products share a code", (await sa("PUT", "/platform-admin/hardware-store", twice)).status === 422);
  const free = clone();
  free.products[0].pricePaise = -5;
  check("a negative price is refused", (await sa("PUT", "/platform-admin/hardware-store", free)).status >= 400);
  const outside = clone();
  outside.products[0].imageUrl = "https://example.com/somebody-elses-photo.png";
  check("a picture cannot come from another website", (await sa("PUT", "/platform-admin/hardware-store", outside)).status >= 400);

  section("Pictures");
  const send = (body: Buffer, headers: Record<string, string> = auth) => fetch(`${CLOUD}/api/v1/platform-admin/hardware-store/images`, { method: "POST", headers: { ...headers, "content-type": "application/octet-stream" }, body: new Uint8Array(body) });
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);
  let up = await send(png);
  const url = ((await up.json()) as any).url as string;
  check("a picture uploads", up.status === 201 && /\.png$/.test(url), up.status);
  made.push(path.basename(url));
  const got = await fetch(`${CLOUD}${url}`);
  check("anyone can see it, marked as a picture", got.status === 200 && got.headers.get("content-type") === "image/png" && got.headers.get("x-content-type-options") === "nosniff", got.status);
  const withPic = clone();
  withPic.products[0].imageUrl = url;
  await sa("PUT", "/platform-admin/hardware-store", withPic);
  check("the product shows it", (await pub()).products[0].imageUrl === url);
  up = await send(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
  check("an SVG, which can carry scripts, is refused", up.status === 422, up.status);
  up = await send(Buffer.from("just some text pretending to be a picture"));
  check("a file that is not a picture is refused", up.status === 422, up.status);
  up = await send(Buffer.concat([png, randomBytes(3 * 1024 * 1024 + 2048)]));
  check("a picture over 3 MB is refused", up.status === 413, up.status);
  check("a strange file name cannot reach other files", (await fetch(`${CLOUD}/api/v1/commercial/hardware-store/images/..%2F..%2F.env`)).status >= 400);

  section("Enquiries");
  const lead = await fetch(`${CLOUD}/api/v1/public/leads`, { method: "POST", headers: { "content-type": "application/json", "x-drycare-csrf": "1" }, body: JSON.stringify({ type: "contact", name: `Store Lead ${run}`, email: `lead-${run}@test.local`, message: `Interested in: Hardware: Complete Store Setup. Number of stores: 3` }) });
  check("a hardware enquiry is received", lead.status === 201, lead.status);
  const leads = (await sa("GET", "/platform-admin/leads?status=all")).json;
  check("and shows in Website enquiries", leads.some((l: any) => l.name === `Store Lead ${run}` && l.message.includes("Hardware:")));
  await sqlClient`delete from public_leads where name = ${`Store Lead ${run}`}`;

  section("Security");
  check("only the owner can read the settings", [401, 403].includes((await fetch(`${CLOUD}/api/v1/platform-admin/hardware-store`)).status));
  check("or save them", [401, 403].includes((await fetch(`${CLOUD}/api/v1/platform-admin/hardware-store`, { method: "PUT", headers: { "content-type": "application/json", "x-drycare-csrf": "1" }, body: JSON.stringify(clone()) })).status));
  check("or upload", [401, 403].includes((await send(png, { "x-drycare-csrf": "1" })).status));
  const log = await sqlClient`select count(*)::int as n from audit_logs where action like 'platform.hardware_store%' and actor_user_id = ${user.id}`;
  check("changes are in the audit log", log[0].n >= 4, log[0]);
} finally {
  // The owner's saved store goes back exactly as it was.
  if (saved) await sqlClient`update platform_settings set value_json = ${sqlClient.json(saved.value_json)} where key = ${"hardware_store"}`;
  else await sqlClient`delete from platform_settings where key = ${"hardware_store"}`;
  const dir = process.env.STORE_IMAGE_DIR ?? path.join(process.cwd(), ".local", "store-images");
  for (const f of made) rmSync(path.join(dir, f), { force: true });
}
console.log(results.join("\n"));
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
await sqlClient.end();
process.exit(failures ? 1 : 0);
