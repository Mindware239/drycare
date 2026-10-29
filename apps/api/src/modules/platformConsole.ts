import { getStoredPayments, razorpayReady } from "../lib/platformSettings";
import { platformAdminPassword } from "./auth";
import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client";
import { requirePlatformAdmin } from "../lib/context";
import { audit } from "../lib/audit";
import { hash, verify } from "@node-rs/argon2";
import { AppError, conflict, notFound } from "../lib/errors";
import { env } from "../env";
import { orgView } from "../lib/orgView";
import { emailConfigured, emailFrom, emailProvider, sendEmail } from "../lib/mailer";

/** Customer organizations exclude the internal organization that hosts the super admin accounts. */
const NOT_INTERNAL = sql`o.settings_json->>'platformInternal' is distinct from 'true'`;
/** Businesses created by the automated smoke tests (owner emails on the reserved test.local domain). */
const TEST_ORG = sql`exists (select 1 from organization_memberships tm join users tu on tu.id = tm.user_id
  where tm.organization_id = o.id and tu.email like '%@test.local')`;
/** Real customer businesses: excludes the internal admin organization and automated test businesses. */
export const CUSTOMER_ORG = sql`(${NOT_INTERNAL} and not ${TEST_ORG})`;

/** Platform-level audit actions: super admin sign-ins and changes made from the console. */
const PLATFORM_ACTIONS = sql`(a.action like 'platform.%' or a.action like 'auth.platform_admin%')`;

const LEAD_STATUSES = ["new", "contacted", "qualified", "converted", "closed"] as const;

const num = (v: unknown) => Number(v ?? 0);

/**
 * Read models for the super admin control center. Every figure comes from stored records:
 * "collected" means verified commercial payments with status `paid`; nothing is estimated.
 */
export async function platformConsoleRoutes(app: FastifyInstance) {
  app.get("/platform-admin/dashboard", async (req) => {
    requirePlatformAdmin(req);
    const [m] = await db.execute<Record<string, string | number>>(sql`
      with orgs as (select o.* from organizations o where ${CUSTOMER_ORG}),
      subs as (
        select s.*, p.price_paise, p.interval from commercial_subscriptions s
        join commercial_plans p on p.id = s.plan_id
        join orgs o on o.id = s.organization_id
      ),
      pays as (select p.* from commercial_payments p join orgs o on o.id = p.organization_id)
      select
        (select count(*) from orgs)::int as "customers",
        (select count(*) from orgs where created_at >= now() - interval '7 days')::int as "new7",
        (select count(*) from orgs where created_at >= now() - interval '30 days')::int as "new30",
        (select count(*) from orgs where status = 'trial' and (trial_ends_at is null or trial_ends_at > now()))::int as "trialsActive",
        (select count(*) from orgs where status = 'trial' and trial_ends_at between now() and now() + interval '7 days')::int as "trialsExpiring7",
        (select count(*) from orgs where status = 'trial' and trial_ends_at <= now())::int as "trialsLapsed",
        (select count(*) from orgs where status = 'suspended')::int as "suspended",
        (select count(*) from orgs where trial_started_at is not null)::int as "everTrialed",
        (select count(distinct organization_id) from pays where status = 'paid')::int as "payingEver",
        (select count(*) from subs where status = 'active' and (ends_at is null or ends_at > now()))::int as "paidActive",
        (select coalesce(sum(case when interval = 'year' then price_paise / 12.0 else price_paise end), 0)
           from subs where status = 'active' and (ends_at is null or ends_at > now())) as "mrrPaise",
        (select count(*) from subs where status = 'active' and ends_at between now() and now() + interval '14 days')::int as "renewals14",
        (select count(*) from subs where status in ('canceled', 'expired') or (status = 'active' and ends_at <= now()))::int as "lapsedSubscriptions",
        (select coalesce(sum(amount_paise), 0) from pays where status = 'paid') as "collectedPaise",
        (select coalesce(sum(amount_paise), 0) from pays where status = 'paid' and created_at >= now() - interval '30 days') as "collected30Paise",
        (select count(*) from pays where status = 'paid')::int as "paymentCount",
        (select count(*) from public_leads where status = 'new')::int as "newLeads",
        (select count(*) from users u where exists (
          select 1 from organization_memberships m join roles r on r.id = m.role_id and r.key = 'owner'
          join orgs o on o.id = m.organization_id where m.user_id = u.id) and u.email_verified_at is not null)::int as "verifiedOwners",
        (select count(*) from commercial_plans where published)::int as "publishedPlans"
    `);
    const signups = await db.execute<{ day: string; count: number }>(sql`
      select to_char(d, 'YYYY-MM-DD') as day, count(o.id)::int as count
      from generate_series((now() at time zone 'Asia/Kolkata')::date - 29, (now() at time zone 'Asia/Kolkata')::date, interval '1 day') d
      left join organizations o on ${CUSTOMER_ORG} and (o.created_at at time zone 'Asia/Kolkata')::date = d::date
      group by d order by d
    `);
    const activity = await db.execute(sql`
      select a.id, a.action, a.resource_type as "resourceType", a.created_at as "createdAt",
        u.email as "actorEmail",
        case when ${CUSTOMER_ORG} then o.name end as "organizationName",
        case when ${CUSTOMER_ORG} then a.organization_id end as "organizationId"
      from audit_logs a
      left join users u on u.id = a.actor_user_id
      left join organizations o on o.id = a.organization_id
      where ((${PLATFORM_ACTIONS} and a.action <> 'auth.platform_admin_challenge_sent') or a.action in ('organization.provisioned', 'auth.email_verified'))
        and (o.id is null or not ${TEST_ORG})
      order by a.created_at desc limit 12
    `);
    const everTrialed = num(m.everTrialed);
    const metrics = {
      customers: num(m.customers),
      new7: num(m.new7),
      new30: num(m.new30),
      trialsActive: num(m.trialsActive),
      trialsExpiring7: num(m.trialsExpiring7),
      trialsLapsed: num(m.trialsLapsed),
      suspended: num(m.suspended),
      paidActive: num(m.paidActive),
      mrrPaise: Math.round(num(m.mrrPaise)),
      renewals14: num(m.renewals14),
      lapsedSubscriptions: num(m.lapsedSubscriptions),
      collectedPaise: num(m.collectedPaise),
      collected30Paise: num(m.collected30Paise),
      paymentCount: num(m.paymentCount),
      newLeads: num(m.newLeads),
      verifiedOwners: num(m.verifiedOwners),
      conversionBps: everTrialed ? Math.round((num(m.payingEver) / everTrialed) * 10_000) : null,
      publishedPlans: num(m.publishedPlans),
    };
    const emailReady = emailConfigured();
    const alerts: { tone: "red" | "amber" | "blue"; title: string; detail: string; href: string }[] = [];
    if (!metrics.publishedPlans) alerts.push({ tone: "red", title: "No plans are published", detail: "Customers cannot buy DryCare until at least one plan has an approved price and is published.", href: "/super-admin/plans" });
    if (metrics.trialsExpiring7) alerts.push({ tone: "amber", title: `${metrics.trialsExpiring7} trial${metrics.trialsExpiring7 === 1 ? "" : "s"} end within 7 days`, detail: "Contact these shops before access lapses.", href: "/super-admin/trials?window=expiring" });
    if (metrics.trialsLapsed) alerts.push({ tone: "amber", title: `${metrics.trialsLapsed} trial${metrics.trialsLapsed === 1 ? "" : "s"} have lapsed without payment`, detail: "Follow up, extend with a reason, or suspend.", href: "/super-admin/trials?window=lapsed" });
    if (metrics.renewals14) alerts.push({ tone: "amber", title: `${metrics.renewals14} subscription${metrics.renewals14 === 1 ? "" : "s"} renew within 14 days`, detail: "Send renewal reminders and payment instructions.", href: "/super-admin/subscriptions" });
    if (metrics.newLeads) alerts.push({ tone: "blue", title: `${metrics.newLeads} new website enquir${metrics.newLeads === 1 ? "y" : "ies"}`, detail: "Respond to sales and demo requests.", href: "/super-admin/leads" });
    if (!emailReady) alerts.push({ tone: "red", title: "Email delivery is not configured", detail: "Verification, reminders and super admin codes cannot be emailed until SMTP or Resend is set up.", href: "/super-admin/settings" });
    return { metrics, signups, activity, alerts };
  });

  app.get("/platform-admin/trials/summary", async (req) => {
    requirePlatformAdmin(req);
    const [m] = await db.execute<Record<string, number>>(sql`
      select
        count(*) filter (where o.status = 'trial' and (o.trial_ends_at is null or o.trial_ends_at > now()))::int as active,
        count(*) filter (where o.status = 'trial' and o.trial_ends_at between now() and now() + interval '3 days')::int as "endingSoon",
        count(*) filter (where o.status = 'trial' and o.trial_ends_at <= now())::int as lapsed,
        count(*) filter (where o.trial_started_at > now() - interval '7 days')::int as "newThisWeek",
        count(*) filter (where o.trial_started_at > now() - interval '90 days')::int as "started90",
        count(*) filter (where o.trial_started_at > now() - interval '90 days' and exists (select 1 from commercial_payments cp where cp.organization_id = o.id and cp.status = 'paid'))::int as "converted90",
        count(*) filter (where o.status = 'trial' and (o.trial_ends_at is null or o.trial_ends_at > now()) and not exists (select 1 from orders od where od.organization_id = o.id))::int as "noOrders"
      from organizations o where ${CUSTOMER_ORG}`);
    return { ...m, trialDays: env.TRIAL_DAYS, conversionRate: m.started90 ? m.converted90 / m.started90 : null };
  });

  /** Emails the shop owner a friendly trial reminder with a link to Plan & billing. */
  app.post("/platform-admin/organizations/:id/trial-reminder", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const auth = requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, id) });
    if (!org || org.settings.platformInternal) throw notFound("Customer organization");
    const [owner] = await db.execute<{ name: string; email: string }>(sql`
      select u.name, u.email from organization_memberships m join roles r on r.id = m.role_id and r.key = 'owner' join users u on u.id = m.user_id
      where m.organization_id = ${id} and m.status = 'active' order by m.created_at limit 1`);
    if (!owner) throw notFound("Shop owner");
    if (!emailConfigured()) throw new AppError(503, "EMAIL_NOT_CONFIGURED", "Email is not set up on the server, so the reminder cannot be sent.");
    const days = org.trialEndsAt ? Math.ceil((org.trialEndsAt.getTime() - Date.now()) / 86_400_000) : null;
    const when = days === null ? "soon" : days > 1 ? `in ${days} days` : days === 1 ? "tomorrow" : days === 0 ? "today" : "already";
    const link = `${env.WEB_ORIGIN}/billing`;
    const subject = days !== null && days < 0 ? `Your DryCare trial has ended — keep ${org.name} running` : `Your DryCare free trial ends ${when}`;
    const text = `Hello ${owner.name.split(/\s+/)[0]},\n\n${days !== null && days < 0 ? `Your free trial for ${org.name} has ended. Your data is safe; choose a plan to keep adding orders.` : `Your free trial for ${org.name} ends ${when}. Choose a plan to keep using DryCare without interruption.`}\n\nChoose a plan: ${link}\n\nNeed help or a demo? Just reply to this email.\n\nTeam DryCare`;
    const sent = await sendEmail({ to: owner.email, subject, text });
    if (!sent.ok) throw new AppError(502, "EMAIL_FAILED", `The reminder could not be sent: ${sent.error ?? "unknown error"}`);
    await audit(db, req, { action: "platform.trial_reminder_sent", resourceType: "organization", resourceId: id, orgId: id, actorUserId: auth.userId, after: { to: owner.email, daysLeft: days } });
    return { ok: true, to: owner.email };
  });

  app.get("/platform-admin/customers", async (req) => {
    requirePlatformAdmin(req);
    const q = z.object({
      search: z.string().trim().max(120).default(""),
      status: z.enum(["all", "trial", "active", "past_due", "suspended", "terminated"]).default("all"),
      window: z.enum(["all", "expiring", "lapsed", "active", "converted"]).default("all"),
      sort: z.enum(["newest", "oldest", "trial_end", "name", "last_login"]).default("newest"),
      page: z.coerce.number().int().min(1).max(100_000).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(25),
      includeTest: z.enum(["true", "false"]).default("false"),
    }).parse(req.query);
    const term = `%${q.search}%`;
    const filters = sql`${q.includeTest === "true" ? NOT_INTERNAL : CUSTOMER_ORG}
      ${q.status === "all" ? sql`` : sql`and o.status = ${q.status}`}
      ${q.window === "expiring" ? sql`and o.status = 'trial' and o.trial_ends_at between now() and now() + interval '7 days'` : sql``}
      ${q.window === "lapsed" ? sql`and o.status = 'trial' and o.trial_ends_at <= now()` : sql``}
      ${q.window === "active" ? sql`and o.status = 'trial' and (o.trial_ends_at is null or o.trial_ends_at > now())` : sql``}
      ${q.window === "converted" ? sql`and o.trial_started_at is not null and exists (select 1 from commercial_payments cp where cp.organization_id = o.id and cp.status = 'paid')` : sql``}
      ${q.search ? sql`and (o.name ilike ${term} or o.gstin ilike ${term} or exists (
        select 1 from organization_memberships sm join users su on su.id = sm.user_id
        where sm.organization_id = o.id and (su.name ilike ${term} or su.email ilike ${term} or su.phone ilike ${term})))` : sql``}`;
    const order = {
      newest: sql`o.created_at desc`,
      oldest: sql`o.created_at asc`,
      trial_end: sql`o.trial_ends_at asc nulls last`,
      name: sql`lower(o.name) asc`,
      last_login: sql`stats."lastLoginAt" desc nulls last`,
    }[q.sort];
    const [count] = await db.execute<{ total: number }>(sql`select count(*)::int as total from organizations o where ${filters}`);
    // Trial tab extras: first paid date and staff/order activity in the last 7 days (engagement).
    const items = await db.execute(sql`
      select o.id, o.name, o.status, o.gstin, o.trial_started_at as "trialStartedAt", o.trial_ends_at as "trialEndsAt",
        o.created_at as "createdAt", o.settings_json->>'city' as city, o.settings_json->>'state' as state,
        owner.name as "ownerName", owner.email as "ownerEmail", owner.phone as "ownerPhone", owner.email_verified_at as "ownerVerifiedAt",
        stats."lastLoginAt", stats.users, stats.branches, stats.orders, stats."orders7d", stats."firstPaidAt",
        latest.status as "subscriptionStatus", latest."planName", latest."endsAt" as "subscriptionEndsAt"
      from organizations o
      left join lateral (
        select u.name, u.email, u.phone, u.email_verified_at from organization_memberships m
        join roles r on r.id = m.role_id and r.key = 'owner' join users u on u.id = m.user_id
        where m.organization_id = o.id and m.status = 'active' order by m.created_at limit 1
      ) owner on true
      left join lateral (
        select max(u.last_login_at) as "lastLoginAt", count(distinct m.user_id)::int as users,
          (select count(*)::int from branches b where b.organization_id = o.id) as branches,
          (select count(*)::int from orders od where od.organization_id = o.id) as orders,
          (select count(*)::int from orders od where od.organization_id = o.id and od.received_at > now() - interval '7 days') as "orders7d",
          (select min(cp.created_at) from commercial_payments cp where cp.organization_id = o.id and cp.status = 'paid') as "firstPaidAt"
        from organization_memberships m join users u on u.id = m.user_id
        where m.organization_id = o.id and m.status = 'active'
      ) stats on true
      left join lateral (
        select s.status, p.name as "planName", s.ends_at as "endsAt" from commercial_subscriptions s
        join commercial_plans p on p.id = s.plan_id where s.organization_id = o.id order by s.created_at desc limit 1
      ) latest on true
      where ${filters}
      order by ${order}
      limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}
    `);
    const [{ testCount }] = await db.execute<{ testCount: number }>(sql`select count(*)::int as "testCount" from organizations o where ${NOT_INTERNAL} and ${TEST_ORG}`);
    return { items, total: count.total, page: q.page, pageSize: q.pageSize, testCount };
  });

  app.get("/platform-admin/customers/:id", async (req) => {
    requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const organization = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, id) });
    if (!organization || organization.settings.platformInternal) throw notFound("Customer");
    const [users, branches, usageRows, subscriptions, payments, timeline] = await Promise.all([
      db.execute(sql`
        select u.id, u.name, u.email, u.phone, u.status, u.email_verified_at as "emailVerifiedAt", u.last_login_at as "lastLoginAt",
          m.status as "membershipStatus", r.name as "roleName", r.key as "roleKey", m.created_at as "joinedAt"
        from organization_memberships m join users u on u.id = m.user_id join roles r on r.id = m.role_id
        where m.organization_id = ${id} order by (r.key = 'owner') desc, m.created_at`),
      db.execute(sql`select id, name, branch_code as "branchCode", phone, status, address_json as address, created_at as "createdAt" from branches where organization_id = ${id} order by created_at`),
      db.execute(sql`
        select
          (select count(*)::int from customers where organization_id = ${id}) as customers,
          (select count(*)::int from orders where organization_id = ${id}) as orders,
          (select count(*)::int from orders where organization_id = ${id} and created_at >= now() - interval '30 days') as "orders30",
          (select max(created_at) from orders where organization_id = ${id}) as "lastOrderAt",
          (select count(*)::int from garments where organization_id = ${id}) as garments`),
      db.execute(sql`
        select s.id, s.status, s.provider, s.provider_reference as reference, s.starts_at as "startsAt", s.ends_at as "endsAt",
          s.canceled_at as "canceledAt", s.created_at as "createdAt", p.name as "planName", p.price_paise as "pricePaise", p.interval
        from commercial_subscriptions s join commercial_plans p on p.id = s.plan_id
        where s.organization_id = ${id} order by s.created_at desc`),
      db.execute(sql`
        select id, provider, provider_reference as reference, amount_paise as "amountPaise", currency, status, created_at as "createdAt"
        from commercial_payments where organization_id = ${id} order by created_at desc`),
      db.execute(sql`
        select a.id, a.action, a.resource_type as "resourceType", a.created_at as "createdAt", a.after_json as after, u.email as "actorEmail"
        from audit_logs a left join users u on u.id = a.actor_user_id
        where a.organization_id = ${id} and (a.action like 'platform.%' or a.action like 'auth.%' or a.action like 'organization.%'
          or a.action like 'branch.%' or a.action like 'user.%' or a.action like 'commercial.%')
        order by a.created_at desc limit 60`),
    ]);
    return { organization: orgView(organization), users, branches, usage: usageRows[0], subscriptions, payments, timeline };
  });

  app.get("/platform-admin/subscriptions", async (req) => {
    requirePlatformAdmin(req);
    const q = z.object({ status: z.enum(["all", "active", "renewing", "lapsed", "past_due", "canceled"]).default("all") }).parse(req.query);
    const filter = {
      all: sql``,
      active: sql`and s.status = 'active' and (s.ends_at is null or s.ends_at > now())`,
      renewing: sql`and s.status = 'active' and s.ends_at between now() and now() + interval '14 days'`,
      lapsed: sql`and (s.status = 'expired' or (s.status = 'active' and s.ends_at <= now()))`,
      past_due: sql`and s.status = 'past_due'`,
      canceled: sql`and s.status = 'canceled'`,
    }[q.status];
    return db.execute(sql`
      select s.id, s.organization_id as "organizationId", o.name as "organizationName", s.status,
        case when s.status = 'active' and s.ends_at <= now() then 'expired' else s.status end as "effectiveStatus",
        s.provider, s.provider_reference as reference, s.starts_at as "startsAt", s.ends_at as "endsAt", s.cancel_at as "cancelAt",
        p.name as "planName", p.price_paise as "pricePaise", p.interval, s.created_at as "createdAt"
      from commercial_subscriptions s join organizations o on o.id = s.organization_id join commercial_plans p on p.id = s.plan_id
      where ${CUSTOMER_ORG} ${filter}
      order by s.ends_at asc nulls last, s.created_at desc limit 500
    `);
  });

  app.get("/platform-admin/revenue", async (req) => {
    requirePlatformAdmin(req);
    const q = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() }).parse(req.query);
    const from = q.from ?? new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    const to = q.to ?? new Date().toISOString().slice(0, 10);
    const range = sql`(p.created_at at time zone 'Asia/Kolkata')::date between ${from}::date and ${to}::date`;
    const [monthly, byPlan, byChannel, [totals]] = await Promise.all([
      db.execute(sql`
        select to_char(date_trunc('month', p.created_at at time zone 'Asia/Kolkata'), 'YYYY-MM') as month,
          coalesce(sum(p.amount_paise) filter (where p.status = 'paid'), 0)::bigint as "collectedPaise",
          count(*) filter (where p.status = 'paid')::int as payments
        from commercial_payments p join organizations o on o.id = p.organization_id
        where ${CUSTOMER_ORG} and ${range} group by 1 order by 1`),
      db.execute(sql`
        select coalesce(pl.name, 'Unassigned') as plan, coalesce(sum(p.amount_paise), 0)::bigint as "collectedPaise", count(*)::int as payments
        from commercial_payments p join organizations o on o.id = p.organization_id
        left join commercial_subscriptions s on s.id = p.subscription_id left join commercial_plans pl on pl.id = s.plan_id
        where ${CUSTOMER_ORG} and p.status = 'paid' and ${range} group by 1 order by 2 desc`),
      db.execute(sql`
        select p.provider as channel, coalesce(sum(p.amount_paise), 0)::bigint as "collectedPaise", count(*)::int as payments
        from commercial_payments p join organizations o on o.id = p.organization_id
        where ${CUSTOMER_ORG} and p.status = 'paid' and ${range} group by 1 order by 2 desc`),
      db.execute(sql`
        select coalesce(sum(p.amount_paise) filter (where p.status = 'paid'), 0)::bigint as "collectedPaise",
          count(*) filter (where p.status = 'paid')::int as "paidCount",
          count(distinct p.organization_id) filter (where p.status = 'paid')::int as "payingCustomers"
        from commercial_payments p join organizations o on o.id = p.organization_id
        where ${CUSTOMER_ORG} and ${range}`),
    ]);
    return { from, to, totals, monthly, byPlan, byChannel };
  });

  app.get("/platform-admin/leads", async (req) => {
    requirePlatformAdmin(req);
    const q = z.object({ status: z.enum(["all", ...LEAD_STATUSES]).default("all") }).parse(req.query);
    return db.execute(sql`
      select id, type, name, business_name as "businessName", email, phone, city, message, status, created_at as "createdAt"
      from public_leads ${q.status === "all" ? sql`` : sql`where status = ${q.status}`}
      order by created_at desc limit 500`);
  });

  app.patch("/platform-admin/leads/:id", async (req) => {
    const auth = requirePlatformAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { status } = z.object({ status: z.enum(LEAD_STATUSES) }).parse(req.body);
    const before = await db.query.publicLeads.findFirst({ where: eq(schema.publicLeads.id, id) });
    if (!before) throw notFound("Enquiry");
    const [after] = await db.update(schema.publicLeads).set({ status }).where(eq(schema.publicLeads.id, id)).returning();
    await audit(db, req, { action: "platform.lead_status_changed", resourceType: "public_lead", resourceId: id, actorUserId: auth.userId, before: { status: before.status }, after: { status } });
    return after;
  });

  app.get("/platform-admin/audit-logs", async (req) => {
    requirePlatformAdmin(req);
    const q = z.object({
      scope: z.enum(["platform", "all"]).default("platform"),
      search: z.string().trim().max(120).default(""),
      page: z.coerce.number().int().min(1).max(100_000).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(50),
    }).parse(req.query);
    const term = `%${q.search}%`;
    const where = sql`${q.scope === "platform" ? PLATFORM_ACTIONS : sql`true`}
      ${q.search ? sql`and (a.action ilike ${term} or u.email ilike ${term} or o.name ilike ${term} or a.resource_id ilike ${term})` : sql``}`;
    const [count] = await db.execute<{ total: number }>(sql`
      select count(*)::int as total from audit_logs a left join users u on u.id = a.actor_user_id
      left join organizations o on o.id = a.organization_id where ${where}`);
    const items = await db.execute(sql`
      select a.id, a.action, a.resource_type as "resourceType", a.resource_id as "resourceId", a.ip, a.created_at as "createdAt",
        a.before_json as before, a.after_json as after, u.email as "actorEmail", o.name as "organizationName"
      from audit_logs a left join users u on u.id = a.actor_user_id left join organizations o on o.id = a.organization_id
      where ${where} order by a.created_at desc limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`);
    return { items, total: count.total, page: q.page, pageSize: q.pageSize };
  });

  app.get("/platform-admin/admins", async (req) => {
    requirePlatformAdmin(req);
    return db.execute(sql`
      select u.id, u.name, u.email, u.status, u.last_login_at as "lastLoginAt", u.created_at as "createdAt",
        u.locked_until as "lockedUntil",
        (select count(*)::int from sessions s where s.user_id = u.id and s.revoked_at is null and s.expires_at > now()) as "activeSessions"
      from users u where u.is_platform_admin order by u.created_at`);
  });

  app.post("/platform-admin/sessions/revoke-others", async (req) => {
    const auth = requirePlatformAdmin(req);
    const revoked = await db.execute<{ id: string }>(sql`
      update sessions set revoked_at = now()
      where user_id = ${auth.userId} and revoked_at is null and expires_at > now()
        and id <> ${auth.sessionId}
      returning id`);
    await audit(db, req, { action: "platform.sessions_revoked", resourceType: "user", resourceId: auth.userId, actorUserId: auth.userId, after: { count: revoked.length } });
    return { revoked: revoked.length };
  });

  app.post("/platform-admin/me/password", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req) => {
    const auth = requirePlatformAdmin(req);
    const body = z.object({
      currentPassword: z.string().min(1).max(200),
      newPassword: platformAdminPassword,
    }).parse(req.body);
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, auth.userId) });
    if (!user || !(await verify(user.passwordHash, body.currentPassword))) {
      await audit(db, req, { action: "platform.password_change_failed", resourceType: "user", resourceId: auth.userId, actorUserId: auth.userId });
      throw new AppError(400, "CURRENT_PASSWORD_INCORRECT", "Your current password is incorrect.");
    }
    if (body.currentPassword === body.newPassword) throw new AppError(400, "PASSWORD_UNCHANGED", "Choose a password you have not used here.");
    await db.transaction(async (tx) => {
      await tx.update(schema.users).set({ passwordHash: await hash(body.newPassword), updatedAt: new Date() }).where(eq(schema.users.id, auth.userId));
      // Every other device must sign in again with the new password and a fresh code.
      await tx.execute(sql`update sessions set revoked_at = now() where user_id = ${auth.userId} and revoked_at is null and id <> ${auth.sessionId}`);
      await audit(tx, req, { action: "platform.password_changed", resourceType: "user", resourceId: auth.userId, actorUserId: auth.userId });
    });
    return { ok: true };
  });

  app.post("/platform-admin/plans", async (req, reply) => {
    const auth = requirePlatformAdmin(req);
    const body = z.object({
      code: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, "Use 2-40 lowercase letters, numbers or hyphens"),
      name: z.string().trim().min(2).max(80),
      interval: z.enum(["month", "year"]).default("month"),
    }).parse(req.body);
    const existing = await db.query.commercialPlans.findFirst({ where: eq(schema.commercialPlans.code, body.code) });
    if (existing) throw conflict("A plan with this code already exists.", "PLAN_CODE_TAKEN");
    // New plans start as unpublished drafts with no price, exactly like the seeded plans.
    const [plan] = await db.insert(schema.commercialPlans).values({ ...body, pricePaise: 0, published: false, sortOrder: 100 }).returning();
    await audit(db, req, { action: "platform.plan_created", resourceType: "commercial_plan", resourceId: plan.id, actorUserId: auth.userId, after: plan });
    reply.code(201);
    return plan;
  });

  app.get("/platform-admin/system", async (req) => {
    requirePlatformAdmin(req);
    const [dbInfo] = await db.execute<{ version: string; now: string; size: string }>(sql`
      select split_part(version(), ' ', 2) as version, now()::text as now, pg_size_pretty(pg_database_size(current_database())) as size`);
    return {
      environment: env.NODE_ENV,
      mode: env.DRYCARE_MODE,
      appVersion: env.APP_VERSION,
      webOrigin: env.WEB_ORIGIN,
      database: dbInfo,
      email: { configured: emailConfigured(), provider: emailProvider(), from: emailFrom() },
      paymentGateway: { configured: razorpayReady(await getStoredPayments(db)) },
      customerApprovals: { configured: Boolean(env.CUSTOMER_APPROVAL_SECRET) },
      marketingUnsubscribe: { configured: Boolean(env.MARKETING_UNSUBSCRIBE_SECRET) },
      licensing: { enforced: env.LICENSE_ENFORCED, publicKeyConfigured: Boolean(env.LICENSE_PUBLIC_KEY) },
      trialDays: env.TRIAL_DAYS,
      sessionTtlHours: env.SESSION_TTL_HOURS,
      cookieSecure: env.COOKIE_SECURE,
    };
  });
}
