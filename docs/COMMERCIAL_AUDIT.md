# DryCare Commercial Feature Audit

Audit date: 27 October 2026  
Scope: source code, current database model/migrations, API routes, web routes, shared validation/workflows, and existing test/build commands.

## Executive summary

DryCare is an existing multi-tenant operations application, not a dashboard mockup. It already has real order-to-garment records, barcode labels, workflow transitions, QC/rework, order invoices and payment ledgers, customer consent, delivery scheduling/dispatch/OTP, reports, staff/branch authorization, backups, and owner-managed email campaigns.

The attached 111-item checklist is not complete. The most significant product gaps are inventory/procurement and claims, photos and richer garment traceability, production batching/machine tracking, real payment and SMS/WhatsApp providers, loyalty/feedback, campaign delivery analytics, and production operations/testing. Customer approval holds are now implemented for manual above-catalogue pricing and explicitly flagged special care. Some sidebar labels in the supplied checklist describe capabilities that do not yet exist and should not be exposed as working features.

## Architecture and data model

- **Workspace:** pnpm monorepo. Next.js 16/React web app; Fastify API; shared Zod schemas/workflow/permissions; Electron desktop edition.
- **Persistence:** PostgreSQL via Drizzle; twelve SQL migrations are present (`0000` through `0011`). The API is a modular monolith.
- **Core ownership chain:** organization → branches and memberships; customers → orders → order items → physical garment rows; orders → invoices → invoice items/payment allocations → append-only payments/refunds. A garment also has append-only status history, QC inspections, rework records, and optional storage location.
- **Tenant/branch model:** tenant-owned records generally carry `organization_id`; `loadAuth` resolves tenant and role from the session, and services apply organization and branch checks. Do not treat UI-hidden navigation as authorization.
- **Durable messaging:** transactional outbox → notification jobs, plus a separate worker; marketing campaigns/coupons use persisted rows and worker delivery. Provider acceptance is not delivery confirmation. Owner-only Integrations & notifications page displays safe Resend/OTP configuration status and setup steps; `pnpm dev:worker` starts the separate worker.
- **Security controls observed:** Argon2id credentials, server-side hashed sessions, CSRF header, request validation, general/auth rate limits, audit log and append-only database guards for selected ledgers/history, order/payment idempotency, and tenant-scoped queries.
- **Key model limitations:** no inventory/purchase-order/supplier, equipment/maintenance, production batch, branch-transfer, claim, loyalty, or feedback tables. Garment photos are absent; staff photo upload currently stores image bytes in PostgreSQL and is not an appropriate silent substitute for the requested garment image storage strategy.

## Status definitions

- **Implemented and tested:** implementation exists and has test evidence in the repository or prior recorded verification.
- **Implemented, verification incomplete:** code exists; the relevant end-to-end/provider/device test was not run in this audit.
- **Partial:** some real workflow exists but one or more requested behaviors are absent.
- **Missing:** no substantive implementation found.
- **External decision/integration:** cannot be called complete without provider, hardware, or operating-policy configuration.

## Checklist audit

| Area | Status | Verified implementation | Missing / partial work |
|---|---|---|---|
| A. Order management (9) | **Partial** | POS creates multi-line orders transactionally; server quote calculates price/tax/discount; express/promised time; snapshots; invoice/receipt and label reprint; order list/detail/history; cancellation rules; payment deposits/partials. Manual above-catalogue prices and explicitly flagged special care create audited approval holds; pending holds block production, payment collection, and handover. Approval evidence supports recorded verbal consent, typed-name in-person sign-off with staff witness, or email OTP. | Item-level order amendments are not supported (PATCH is limited to promised date/notes); SMS OTP is unavailable until an SMS provider is selected/configured; refund remains a separately authorized financial action. |
| B. Garment tracking (13) | **Partial** | Stable garment UUID plus unique tenant tag; one physical garment row/tag per piece-based item; Code-128 barcode endpoint and print/reprint; intake condition/fabric/brand/colour/care fields; workflow history with actor/time/branch/correlation; wrong-stage transitions rejected; QC, rework, storage, order-to-garment links. | No garment photo upload, QR/RFID adapter, production batches, machine/station/location event detail beyond stage/location history, public customer tracking, missing-item investigation/report, bag/rack transfer manifest, or explicit duplicate-scan event model. |
| C. Production and QC (12) | **Partial** | Per-service ordered workflow templates; queues and overdue view; transition API and scan station; optimistic version checks; branch-scoped active assignee list and scan-station assignment UI; assignment changes are audited/versioned; QC checklist and mandatory reason on fail; rework loop; readiness requires QC and rack. Assignment tenant/branch/role checks and customer approval holds pass API smoke checks. | No batches, machine assignment, start/pause/duration, station capacity, configurable checklists, or workload/bottleneck reporting. |
| D. Pickup/delivery (11) | **Implemented, verification incomplete** | Schedule pickup/delivery; assign active delivery drivers; driver worklist/detail; manifest requires exact scanned garment tags before dispatch; delivery OTP; recipient-name proof fallback; failed-attempt and reschedule paths; collection/payment and delivery events. | No recurring pickup rules, zones/slot capacity/fees, route optimization/GPS, photo/signature capture, ETA, cash/route reconciliation reports, or live location integration. Do not claim GPS capability. |
| E. CRM/retention (12) | **Partial** | Customer profiles with GSTIN, editable addresses, configurable phone/email duplicate checks, branch-scoped garment/order history and permission-gated financial details; contact channel, marketing consent, care notes, duplicate merge, opt-out token, owner-managed campaigns and inactive segment. | No loyalty/referrals/memberships/wallet rewards, saved segments, household/corporate hierarchy beyond customer type, complaints/feedback, birthday data/automation, SMS/WhatsApp provider, configurable welcome journeys, or campaign conversion attribution. |
| F. Finance/POS (12) | **Partial** | Cash/UPI/card/bank/wallet manual counter records, invoices with GST snapshots, outstanding balances, deposits/partial/split collection, append-only payments, refunds/credit balance math, shifts and reconciliation views, coupons, audited adjustments. | Counter-entered UPI/card references are not payment-gateway verification. No gateway/webhook, gateway reconciliation, credit limits/payment terms, aging reminders, accounting export, or hardware cash drawer integration. |
| G. Inventory/equipment (9) | **Partial** | Append-only stock ledger per branch, consumables catalogue, suppliers, purchase orders with part receipts, reorder alerts, stock checks, wastage, valuation at the last purchase price, usage report, supplier bills filed under expenses (`pnpm inventory-test`). | No branch-to-branch stock transfer, per-batch chemical consumption, or dry-cleaning equipment registry and maintenance (self-service laundry machines already have maintenance). |
| H. Administration/security (11) | **Partial** | Multi-tenant organizations and branches, branch-scoped memberships, roles/permissions, employee profiles/photos/attendance/leave, services/prices/tax snapshots, audit history, desktop backups, session revocation and security controls. | Branch garment transfers, staff activity/performance reports, retention/deletion/data-export workflows, SaaS plan entitlements, centralized platform admin, and tested production restore/deployment runbooks are absent or unverified. |
| I. Reports/analytics (11) | **Partial** | Actual-ledger dashboard/sales/receivables/expenses and date/branch filters; KPI definitions are documented; CSV export exists. | No inventory valuation/usage, equipment, detailed employee productivity, route, missing/damage/rework trend, campaign conversion/delivery, custom scheduled reports, or consistent export of every requested report. |
| J. Integrations/reliability (11) | **Partial** | Resend email adapter and worker; retryable outbox/jobs; consent-aware campaigns; order/payment idempotency; CSRF, validation, rate limiting, health endpoint; barcode image generation; shared workflow tests and DB smoke script. | Resend credentials/webhook/bounce events not configured; no SMS/WhatsApp/payment integrations; no RFID or printer SDK validation; no offline scan queue; no error monitoring/CI/load tests/import tooling. Worker job claiming must be hardened/tested before running multiple worker instances. |

### Navigation versus real capabilities

Existing working pages include Dashboard, POS/New Order, Orders, Customers, Production Board, Scan Station, Pickups & Deliveries, Driver, Cashier & Shifts, Expenses, Reports, Catalogue, Staff, Campaigns, Settings, Integrations & notifications, and Audit. The desktop sidebar supports a persisted compact icon rail and expanded labels; navigation remains permission-filtered by role. Inventory, Equipment, Loyalty, Coupons administration, Feedback, Route Planning, garment registry/photo archive, and payment integrations should not be presented as complete modules until their workflows exist. Coupon redemption is implemented in order pricing; a separate coupon-management page is not.

## Prioritized implementation plan

Implement vertical slices (database migration, tenant-scoped API, authorization, UI, tests, and docs together), preserving the current install and append-only financial/tracking history.

### P0 — Operational correctness

1. ✅ Add customer-approval and hold records for additional charges/special-care decisions; record staff-witnessed evidence and prevent production/payment/handover until all holds are approved. Email OTP is implemented but requires provider configuration; SMS is not configured.
2. Expand garment traceability: garment images using a configured, private object-storage adapter; richer immutable station/batch events; packing count/missing-item reconciliation; customer-safe tracking view.
3. Complete production accountability: assignment UI/API permission checks are implemented; next add per-employee queues, then batches/machines/start-stop timestamps and configurable QC checklists.
4. ✅ Claims/damage/lost-garment investigation and audited resolution/compensation (`/claims`, 29 Oct 2026).
5. Add integration tests for tenant/branch authorization, transition concurrency, QC/rework, dispatch mismatch, and payment/refund invariants.

### P1 — Daily store operations

6. ✅ Inventory movement ledger, suppliers, purchase orders, goods receipts, reorder thresholds, adjustments/wastage and usage reporting (`/inventory`, 29 Oct 2026). Branch-to-branch stock transfers remain.
7. Equipment registry, preventive maintenance, service records and downtime.
8. Complete delivery slots/zones/charges and route manifests; proof media only after private storage and retention rules are configured.
9. Add branch-transfer manifests/scan acceptance and reconciliation.
10. Add customer feedback/complaints and staff performance reporting.

### P2 — Customer growth

11. Loyalty/referrals/memberships with a ledger and redemption rules.
12. Owner-editable templates and event/timing controls; pickup/payment/welcome reminders using durable jobs and duplicate/frequency prevention.
13. Configure selected SMS/WhatsApp providers; implement signed provider webhooks, bounce/suppression and campaign delivery/conversion analytics.
14. Coupon admin/analytics UI and customer preference/consent management.

### P3 — Enterprise and rollout

15. Select and implement a payment gateway with signed webhooks and authoritative status verification.
16. Optional RFID/device adapters, offline-safe scanning, advanced route optimization, cross-branch analytics and forecasting.
17. Add deployment CI, monitoring, restore drills, import/export/retention tools, load tests and operational runbooks.

## Decisions required before integrations

These are deliberately not guessed or hard-coded:

- Payment gateway: Razorpay, Cashfree, PayU, or another supported provider.
- Private object storage for garment/proof images: S3-compatible endpoint and retention/access policy.
- Messaging providers: Resend is already the email adapter; SMS and WhatsApp need the store/provider choice and approved templates.
- Hardware model/protocols: barcode and QR generation can use keyboard-wedge scanners and browser printing; RFID, thermal, cash drawer and scales require actual device models/protocols.
- Approval policy selected: manual above-catalogue prices and explicitly flagged non-standard care require approval; evidence supports staff-recorded verbal consent, typed customer name with staff witness, and email OTP. SMS OTP remains unavailable until a provider is configured.
- Desktop licensing selected: manually verify bank/UPI payment; issue signed offline activation keys by custom plan and expiry date. A license can list one or multiple PC activation request codes. Offline licenses cannot be remotely revoked and cannot provide tamper-proof expiry enforcement.

## Verification baseline and limitations

- Most recent validation (29 Oct 2026, end of day): `pnpm typecheck` passed; `pnpm test` passed (32); `pnpm smoke`, `pnpm inventory-test` (57), `pnpm wallet-test`, `pnpm flow-test`, `pnpm reports-test`, `pnpm laundry-test` and `pnpm billing-test` all passed; web production build passed. Migration `0026` applied. Dark theme checked visually on Dashboard, New order, Order details, Production board, Self-service laundry, Stock & purchasing and Claims.
- The current report does not claim that all 111 acceptance items have end-to-end coverage.
- No real email OTP, payment, SMS/WhatsApp, RFID, or printer integration was exercised. Email OTP requires `RESEND_API_KEY`, `EMAIL_FROM`, and a random `CUSTOMER_APPROVAL_SECRET` of at least 32 characters in the API environment; SMS currently returns an explicit not-configured response.
- The smoke suite creates fresh test tenants; it does not alter existing business-tenant rows. The approval workflow schema is additive and has been applied.
