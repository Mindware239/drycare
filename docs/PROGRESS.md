# DryCare — Build Progress vs. SRS v1.0

Last updated: 29 Oct 2026 · Source documents: *DRYCARE-SRS-001 v1.0*, *Complete Dry Cleaning Store Management Software Blueprint*, and [Commercial Feature Audit](./COMMERCIAL_AUDIT.md).

**Current scope note:** The detailed 111-item source-code audit and the active prioritized plan are in `COMMERCIAL_AUDIT.md`; it supersedes stale estimates in older rows below. The app already includes customer pickup/delivery workflows and password reset/invitations.

**Legend:** ✅ Done & tested · 🟡 Partial (works, but missing pieces listed) · ⬜ Not started

## Production-readiness fixes and audit (29 Oct 2026, v0.1.9): not deployed

See [DESKTOP_CLOUD_PLAN.md §9](./DESKTOP_CLOUD_PLAN.md). Migration `0029_staged_commit` is additive; the dev DB was backed up first.

- **View-only cloud copy:** write actions are hidden in the UI; the server still refuses writes.
- **Large changes:** staged commit, so a change is applied in the cloud all at once or not at all.
- **Account-from-approval-page:** owners return to the pending approval after creating an account; the PC shows the approving account.
- **Hardening:** `TRUST_PROXY` (was trust-all), production configuration guard, link-code rate limits, upload pause after restoring a linked PC, `/health/ready`.
- **Phase 4:** analysis only, in [PHASE4_REVIEW.md](./PHASE4_REVIEW.md) (ownership matrix, numbering inventory, proposal, accountant questions); not implemented.
- **Tests:** `cloud-sync-test` 82 checks, `sync-test` 51.

## Desktop + Cloud phase 3: cloud push sync (29 Oct 2026, v0.1.8): tested locally, not deployed

Contracts, security and deployment steps are in [DESKTOP_CLOUD_PLAN.md §8](./DESKTOP_CLOUD_PLAN.md). Migration `0028_cloud_sync` is additive; the dev DB was backed up first to `.local/backups/before-0028-*.sql`.

- **Linking:** owner approves the PC in the cloud web (code + browser approval). The PC gets a DPAPI-protected device credential with rotation and revocation.
- **Upload:** `POST /sync/push` applies each PC transaction idempotently, with conflict and money checks. Uploads require the paid add-on.
- **Cloud copy:** view-only, one PC per shop. Capture starts at linking, with a snapshot of existing data.
- **Screens:** top-bar indicator with Link / Sync now / conflict review; a "Linked shop PC" card and business switcher in the cloud web.
- **Tests:** `pnpm cloud-sync-test` (72 checks, local test cloud) and a real Windows-app end-to-end run against the local dev cloud.
- **Test data left in the dev database:** the test shop "E2E Dry Cleaners" (cloud copy) and an unpublished test plan `e2e-cloud-sync-test`.

## Desktop + Cloud phase 2: local sync queue (29 Oct 2026, v0.1.7)

Migration `0027_sync_queue` (additive; dev DB backed up to `.local/backups/before-0027-*.sql`) adds `sync_config` (singleton: capture switch, device id, schema version, last attempt/success), `sync_entities` (58 tables classified ledger / financial / operational / master), `sync_outbox` (events) and `sync_conflicts`, plus the `drycare_sync_capture()` trigger on every classified table.

- **Capture:** row changes are written to `sync_outbox` by trigger in the same transaction as the business change (rollback removes the event; a failed event write fails the business change). Events carry a stable id, local `seq`, `txid` (groups one business operation), tenant/branch ids, entity class, schema version, device id and an idempotency key; unchanged re-writes create no event. Passwords, token/OTP hashes, the public laundry status token and images are stripped; sessions, login tokens, audit log, idempotency keys, counters, notification/print queues and platform billing are never captured (`LOCAL_ONLY_TABLES`).
- **Switch:** capture is on in the Windows app (`server-entry.ts`), off on the cloud/web server unless `SYNC_CAPTURE=on`. Startup tolerates code deployed before its migration.
- **Queue processing** (`apps/api/src/sync/`): `SyncTransport` interface (phase 3 plugs in HTTPS), lease-based claiming in local order (crash mid-upload → lease expires → re-sent; cloud de-duplicates by event id), back-off retries, permanent refusals stop automatic retries, records with an open conflict or earlier failure are held back, conflicts stored with local and cloud versions and never overwritten. No transport is configured yet: events stay pending.
- **UI/API:** top-bar indicator (desktop only) with internet state shown separately from cloud sync, pending count, last successful cloud sync (“Never” until phase 3), failures and conflicts; owners can retry failed uploads. `GET /sync/status`, `GET /sync/conflicts`, `POST /sync/retry`.
- **Tests:** `pnpm sync-test` (50 checks across all 8 required scenarios, throwaway database, simulated cloud). Startup test also verifies the Windows app has capture on.

## Desktop + Cloud phase 1: reliability, Windows guard, Android app (29 Oct 2026)

Plan: [DESKTOP_CLOUD_PLAN.md](./DESKTOP_CLOUD_PLAN.md) (keep PostgreSQL; Windows 10/11 64-bit; PWA for Android; offline-first PC with optional cloud sync in later phases).

- **Startup failure fixed:** on PCs running Hyper-V/WSL/Docker, Windows reserves port blocks (e.g. 54307–54506) and DryCare 0.1.5 could not start ("No free port near 54329"). It now falls back to a Windows-assigned free port (`apps/desktop/src/main.ts`).
- **Installer guard:** `apps/desktop/build/installer.nsh` stops setup on Windows 7/8/8.1 or 32-bit Windows with a clear message (Electron 44 and PostgreSQL 17 need 64-bit Windows 10+).
- **Startup test:** `pnpm desktop:startup-test` (or `-Exe <DryCare.exe>`) launches into a throwaway data folder, measures first and normal launch, blocks the preferred DB ports to exercise the fallback, and checks clean shutdown. Packaged 0.1.6: first launch 10 s, normal 0.7 s (limit 20 s). `DRYCARE_BACKUP_DIR` keeps test backups out of the real folder.
- **Android installable app (PWA):** `app/manifest.ts`, icons generated by `node scripts/pwa-icons.mjs`, `public/sw.js` (offline page only — never caches shop data), `public/offline.html`, theme colour and iPhone icon. Full-screen install needs HTTPS (cloud address); on shop Wi-Fi over HTTP, Android offers a home-screen shortcut.
- **Backup hang fixed:** under Node 24 the COPY stream used by backups could stall on the second table, leaving the daily backup unfinished with a transaction open. Backups are now format v2 (one `row_to_json` line per row, ordinary queries; restore via `json_populate_recordset` in 500-row batches); v1 files from earlier versions still restore. Dev database: 180,685 rows in 1.7 s. `pnpm backup-test` fixed (signup now needs accepted terms and a stronger password) and extended: 13 checks incl. role permission arrays and v1 restore.
- Installer `DryCare-Setup-0.1.6.exe` built (unsigned). `pnpm desktop:startup-test -Exe` on it: first launch 8.3 s, normal 1 s, port fallback, clean shutdown, automatic backup written.

## UX pass: POS cart, phone layouts, fixes (29 Oct 2026)

- **New order (POS):** sticky cart panel with compact lines (service, −/+, amount, per-line Details for colour/brand/condition/care/approval hold), auto-scroll and highlight on add, delivery/discount/notes collapsed to a one-line summary, total + Create order always visible; floating “View cart” bar below 1280 px.
- **Bug fixes:** customer list always showed 0 orders / no last order (correlated subquery compared the order's own id; now uses `"customers"."id"`). Cash paid “from the drawer” (expenses, supplier bills, claim compensation) is refused when the drawer holds less (`assertDrawerCash`, error `DRAWER_SHORT`); refunds are unchanged.
- **Phone width (all 29 app screens checked at 375 px, none scroll sideways):** responsive grids default to `grid-cols-1`; tab strips swipe without scrollbars (`dc-tabs`); KPI cards two per row; banners wrap instead of squeezing text.
- **Customer profile:** new Claims tab.

## Dark theme readability (29 Oct 2026)

Dark mode remaps light utility classes in `apps/web/src/app/globals.css`. It now also covers `text-slate-950`; tinted panels (`bg-<colour>-50/100`, including opacity variants such as `bg-amber-50/50` and hover variants), which become dark translucent tints with the matching light text shade; borders and rings; gradients ending in white; and opacity variants of white/slate surfaces. The dashboard banner has a dark teal version with the photo dimmed (`dc-hero*`). Chart gridlines are softened (`dc-chart-*`), and drawn garment pictures get a faint outline so black garments stay visible (`dc-garment-art`). New pages need no extra work as long as they use the standard Tailwind palette.

## Stock & purchasing, customer claims (29 Oct 2026)

Migration `0026` (database backed up first to `.local/backups/before-0026-*.sql`) adds `suppliers`, `inventory_items`, `purchase_orders`, `purchase_order_lines`, `inventory_movements` (append-only, trigger-guarded), `claims` and `claim_events` (append-only). Uses the existing `inventory.manage` and `complaints.manage` permissions; no role changes.

- **Stock & purchasing** (`/inventory`, API `apps/api/src/modules/inventory.ts`): stock items with automatic codes (`ITM-0001`), units (L, ml, kg, g, pcs, box, pack, roll, can), reorder levels and a one-click list of 16 common dry-cleaning supplies. Stock on hand is always the sum of the movement ledger per branch (thousandths of a unit, so 1.5 L is exact). Record use, wastage (reason required), returns, extra stock, and a **stock check** that sets the counted quantity and records the difference. Stock can never go below zero, and concurrent takes are serialised. Low-stock alert with **Reorder low stock**, which drafts a purchase order with suggested quantities. Suppliers have GSTIN validation and purchase totals. **Purchase orders** (`PO/2026/0001`) go draft → ordered → part received → received, or get cancelled or closed short. Goods receipt cannot exceed what was ordered, updates the item price, and can file the supplier bill under Expenses (optionally from the cash drawer). POs can be printed or saved as PDF. A usage report shows bought, used, wasted and stock-check difference per item, with CSV export.
- **Claims & complaints** (`/claims`, API `apps/api/src/modules/claims.ts`): log a claim (`CLM-00001`) from an order, a single garment, a garment exception (“Open claim”) or a customer with no order. Only one open claim per garment is allowed. Investigation notes, then a manager decision (needs `payments.refund`): approve with wallet credit, compensation payment or free re-clean, or reject with a reason. Settlement credits the customer wallet (new wallet entry kind `claim`), or records the payment as a “Claims & compensation” expense (cash from the drawer, UPI, or bank transfer with a reference). Every step is on an immutable timeline. KPIs cover claims awaiting a decision, claims older than 3 days and compensation this month. There is a shortcut from the order page.
- **Tests:** `pnpm inventory-test` (57 checks: decimals, negative-stock and race protection, ledger immutability, PO edit/place/part-receive/over-receipt/cancel, bill→expense and drawer, usage, claim linking, duplicate claims, staff vs manager permissions, wallet and cash settlement, timeline immutability, cross-business isolation).

## Self-service laundry & machine management module (28 Oct 2026)

Independent module (`apps/api/src/modules/laundry.ts`, `packages/shared/src/laundry.ts`, web `/laundry/*`, `/laundry-kiosk`, `/laundry-status`). Migration `0021` adds `laundry_services`, `laundry_pricing_rules` (weight/item/cycle/time/package, store-wide or per-branch), `laundry_item_rates`, `laundry_machines`, `laundry_programs`, `laundry_orders`, `laundry_order_items`, `laundry_sessions` (partial unique index: one booked/running cycle per machine), `laundry_maintenance`; `payment_allocations`/`refunds` gain `laundry_order_id` with a check that exactly one of invoice / laundry order is set, so self-service payments use the shared ledger and cashier shifts. New permissions `laundry.view|operate|manage|maintain` granted to existing system roles plus a new "Maintenance staff" role.

- Server-side pricing engine (integer paise / grams): billable weight rounding and minimums, item lists, cycles, minutes with minimum, packages, minimum charge, discount before GST, manager approval above the discount limit.
- Machines: capacity and type checks, programs, maintenance/out-of-service with history, release after unloading. Machine start only after fully verified payment; concurrent/duplicate starts send one command. Control adapters in `apps/api/src/lib/machineControl.ts` (manual, http) — see `docs/LAUNDRY_IOT.md`.
- Screens: live machine board, staff checkout, customer kiosk (pay at counter / UPI QR), orders + detail (pay, verify transfer, book machine, collect, cancel with refund), setup & pricing, reports (by service/method/machine/store, utilization, CSV/print), 80 mm receipt with QR to a public status page that shows no personal or payment data.
- Admin price management: Laundry setup → **Price list** edits every service × method price on one screen (changed cells only) with a **price change history** from the audit log (`GET /laundry/price-history`). New prices apply to new orders only.
- Go-live helpers: **Kiosk & scale** tab creates a branch-limited kiosk login (new `kiosk` system role, migration `0022`: laundry.view + laundry.operate only) and tests a USB-serial scale; logins land on the first screen they may use (kiosk → `/laundry-kiosk`). `pnpm laundry-iot-sim` simulated controller for connected-machine mode. Starter services installed into Raj Store (no machines added — add the shop's real machines).
- Tests: `pnpm laundry-test` (58+ checks: pricing, capacity, double booking, concurrent bookings and starts, payment verification, duplicates, cancellation/refund, maintenance, permissions, store/business isolation, controller failure, public page, reports) and 5 pricing unit tests.

## Invoice & payment details, production board (28 Oct 2026)

- **Settings → Invoice & payment details:** logo upload (migration `0020`, PNG/JPEG/WebP ≤ 300 KB, signature-checked), address with state (place of supply), phone/email/website, PAN, SAC code, bank account (IFSC validated), UPI ID + payee name, invoice title, terms, footer, authorised signatory, paper (80 mm / A4) and print toggles, with a live preview. Stored as `settings.billing` (validated by `billingProfileSchema`). GSTIN is now format-checked. Organization rows returned by the API never include logo bytes (`orgView`).
- **Invoices:** 80 mm receipt and new A4 tax invoice with logo, CGST/SGST, SAC, amount in words, bank details and a UPI "scan to pay" QR (`GET /orders/:id/upi-qr`, built only from the saved UPI ID and the order's real balance).
- **Production board:** multi-select (per card or per column) to move garments to their next step or assign them to staff; filters for service, assignee (incl. "My work"/unassigned), overdue, express; time-in-stage with >24 h highlight; facility/transit location badges; "Away from shop" count; 30 s auto-refresh. QC passes and racks still go through the scan station.

## Built-in catalogue, cashier & expenses (28 Oct 2026)

- **Standard catalogue** (`apps/api/src/lib/standardCatalogue.ts`): 231 garments in 11 categories (Men, Women, Ethnic, Kids & Baby, Household Linen, Home Furnishing, Accessories, Premium & Delicate, Footwear & Leather, Commercial Linen, Repair & Alterations) plus a "Repair & special care" service; the install also moves untouched garments from the earlier categories. Checked by `scripts/catalogue-lint.ts`. Originally 88 garments in 9 categories with starting prices for Dry clean / Wash & iron / Steam iron / Stain treatment. New stores get it at signup; existing stores see "Add N garments" in Services & prices (`POST /catalogue/standard`), which only adds missing garments and never changes existing prices. Verified by `scripts/catalogue-check.ts`.
- **Expenses** (migration `0019`): vendor, bill number, "paid from cash drawer" (lowers the open shift's expected cash) and void-with-reason instead of delete. Fixed: the list ignored its date filter and showed other branches' expenses to branch-limited staff. Totals and reports exclude voided entries.
- **Cashier:** shift KPIs incl. cash expenses, close-shift with a note/coin counter and live short/over check (explanation required when it doesn't match), collections with date presets. Fixed: reconciliation dates now use India time instead of UTC.

## Garment tracking, bags & facility transfers (28 Oct 2026)

Migrations `0017` (bags, transfer batches, scan events, garment exceptions, label print jobs, credit notes, `garments.bag_id`/`location`, with a backfill giving every existing order one bag) and `0018` (location columns on garment history). Database backed up first to `.local/backups/`.

- **Bags:** each order gets bag `<order no>-B1` at intake; `POST /orders/:id/bags` splits garments into more bags. Bag codes and garment tags resolve via `GET /scan/resolve`.
- **Location vs stage:** `garments.location` (shop → in transit → facility → in transit → shop → collected / missing) is tracked separately from the processing stage; every move is in the garment timeline.
- **Facility transfers** (`/transfers`): batches of bags scanned out and in. Dispatch needs every garment scanned (or an audited override); receipt treats only scanned garments as present; a partial receipt needs `garments.override` and a note, and opens "missing" exceptions (`/exceptions`). Duplicate scans are recorded but never double count.
- **Labels** (`/print/labels`): bag label + garment tags, configurable sizes, Code 128 or QR, customer name policy (first name by default), copies, test print, and print jobs that staff confirm as printed/failed. Printer selection and density come from the OS printer driver.
- **Final billing:** collection discount (percent or fixed) as a credit note with proportional GST reduction, one per invoice, manager permission above the counter limit. Balance = invoice − credit notes − verified payments. Bank transfers can be recorded as awaiting verification and only count once confirmed.
- **Tests:** `pnpm flow-test` runs the ₹540 → ₹40 discount → ₹200 advance → ₹300 settlement scenario end to end, plus missing-garment, duplicate-scan, partial-receipt, failed-print, rejected-transfer and multiple-advance cases.

## Delivery plan (owner decision, 23 Oct 2026)

**Phase A — Standalone PC software for a single store (first).** **Phase B — chain of stores** on the same codebase.

| Phase A item | Status |
|---|---|
| Windows installer (Electron + embedded PostgreSQL 17, no Docker/internet needed) | ✅ `apps/desktop`, version 0.1.3 adds manual offline signed-license activation to the current navigation/theme UI and local owner password recovery |
| First-run store setup, single business per install, no trial | ✅ |
| Automatic daily + on-close backups, manual backup, restore with safety copy | ✅ `pnpm backup-test` (10 checks) |
| Clean database shutdown on close (no crash recovery) | ✅ uses `pg_ctl stop -m fast` |
| UTF-8 database (Hindi/Marathi names, ₹) | ✅ |
| Other counter PCs/tablets over shop Wi-Fi | ✅ menu toggle (binds to LAN, firewall prompt) |
| Silent printing to thermal receipt / label printers | ⬜ uses the print dialog today |
| Code-signing certificate | ⬜ needs purchase |
| Auto-update | ⬜ |
| Pickup & delivery, password reset and invitations | ✅ implemented; real messaging provider configuration remains external |
| Inventory, purchasing and claims (single-store needs) | ✅ `/inventory`, `/claims` (29 Oct 2026) |

Phase B (chain) items are tracked in the sections below: branch transfers, central price lists, consolidated reports, SaaS plans, platform admin, and sync from PC installs to the central server.

## Summary

| Release (Blueprint §19) / Priority (§18) | Status |
|---|---|
| **Release 1 / P0** — login, permissions, customers, garment intake, barcode tags, order tracking, pricing, invoices, payments | ✅ Done |
| **P1** — QC, packing, notifications, dues, daily reports | 🟡 Partial (email/campaign foundation, customer approval holds, and scheduled pickup/delivery are implemented; email OTP needs local provider configuration, SMS/WhatsApp providers and analytics remain) |
| **Release 2 / P2** — inventory, loyalty, customer portal | ⬜ Not started (expenses and pickup/delivery ✅) |
| **Release 3** — SaaS subscriptions, platform admin | 🟡 Multi-tenant foundation done; billing/plans not started |
| **Release 4 / P3** — AI inspection, route optimization, offline, forecasting | ⬜ Out of initial scope (SRS §3.2) |

Latest verification (27 Oct 2026): `pnpm typecheck`, `pnpm test` (24 tests), `pnpm smoke` (all checks passed, including customer duplicate rules, addresses, garment history, financial permissions, branch isolation, effective-dated pricing, approval holds, and delivery workflows), and `pnpm --filter @drycare/web build`. Database migration `0011` adds customer GSTIN and service categories without removing existing records; existing service categories are inferred from service codes. The owner-only Integrations & notifications page shows safe Resend/OTP setup status; use the workspace-root `.env` and run `pnpm dev:worker` in a second terminal for email delivery. No real OTP email was sent. SMS remains unavailable pending provider configuration. Light/dark mode is available in the app header and saves the selection in the browser.

## SRS §23 build order

| # | Step | Status | Notes |
|---|---|---|---|
| 1 | Project foundation & tenant isolation | ✅ | Monorepo, Fastify modular monolith, Drizzle migrations, org-scoped queries everywhere |
| 2 | Authentication, users, roles, branches | ✅ | Argon2 hashing, server-side sessions, lockout, 9 system roles, branch restriction |
| 3 | Customer management | ✅ | Customer 360, configurable phone/email duplicate matching, GSTIN, editable addresses, branch-scoped garment/order history, permission-gated financials, merge, consent |
| 4 | Garment catalogue, services, pricing | ✅ | Searchable garment/service catalogue with categories, effective-dated prices and history, branch price lists, per-service workflows |
| 5 | Order intake & garment-level records | ✅ | Transactional + idempotent creation, one tag per physical garment |
| 6 | Barcode labels & production workflow | ✅ | Code-128 labels, scan station, auto-advance, production board |
| 7 | QC, rework, packing, storage | ✅ | Checklist inspections, rework loop, rack locations; customer approval holds gate production when required |
| 8 | Invoices, payments, balances, refunds | ✅ | Append-only ledger, split payments, refunds, cashier shifts |
| 9 | Pickup, delivery & notifications | 🟡 | Scheduling, assignment, dispatch manifests, driver worklist, OTP, and outbox/email/campaign foundation exist; SMS/WhatsApp and delivery analytics remain |
| 10 | Inventory, suppliers, expenses | 🟡 | Expenses done; inventory/suppliers/purchases not started |
| 11 | Reporting & dashboards | ✅ | Dashboard, sales by service/garment/day/branch, receivables ageing, CSV export |
| 12 | SaaS subscription management | ⬜ | |
| 13 | Platform administration | ⬜ | |
| 14 | Security hardening, load testing, rollout | 🟡 | Many controls in place (below); no load test / pen test / CI yet |

## Functional requirements (SRS §6)

### 6.1 Identity & authentication
| ID | Status | Notes |
|---|---|---|
| FR-AUTH-001 login | ✅ | |
| FR-AUTH-002 password hashing | ✅ | Argon2id |
| FR-AUTH-003 logout & session revocation | ✅ | Sessions stored hashed in DB; suspension revokes sessions |
| FR-AUTH-004 password reset tokens | ✅ | One-time reset tokens, expiry, and session revocation covered by API smoke checks |
| FR-AUTH-005 MFA | ⬜ | SHOULD |
| FR-AUTH-006 rate limiting | ✅ | 10/min on auth routes, lockout after 5 failures |
| FR-AUTH-007 suspended users blocked | ✅ | |
| FR-AUTH-008 expiring invitations | ✅ | One-time invitation token flow with expiry and role assignment |

### 6.2 Tenant & branch
| ID | Status | Notes |
|---|---|---|
| FR-TEN-001 platform provisioning | 🟡 | Self-service signup provisions tenant; no platform-admin console |
| FR-TEN-002 tenant settings | ✅ | |
| FR-TEN-003 branches | ✅ | Plan limits not enforced (no plans yet) |
| FR-TEN-004 branch fields | ✅ | |
| FR-TEN-005 branch transfers | ⬜ | |
| FR-TEN-006 permission-aware reporting | ✅ | Branch-restricted staff only see their branches |

### 6.3 Customers — FR-CRM-001…009
All ✅ (create/update, search by ID/phone/email/name/order no., configurable phone/email duplicate matching, history, GSTIN, editable addresses, marketing consent separate from operational channel, branch and financial permission scoping, no hard delete — inactive/merged instead, audited merge). Loyalty or membership rewards are not supported by the current data model.

### 6.4 Catalogue & pricing — FR-CAT-001…007
All ✅. Includes service categories, searchable garment/service listings, branch price lists, effective dates, and price history. Units: per piece / pair / kg / package. Price edits close the old row and insert a new one, so old orders never change (verified in smoke test). Overrides need `prices.override` + reason. Discounts above the configurable limit need `discounts.approve`.

### 6.5 Orders — FR-ORD-001…010
All ✅. Order numbers `BRANCH-YEAR-00001` via locked sequences. Promised-date changes are audited and trigger a "delayed" message. Reprinting labels creates no financial records. Above-catalogue manual prices and explicitly flagged special care create approval holds; pending holds block production, payments, and handover. Staff-witnessed verbal/typed-name approval and email OTP are supported; email OTP delivery needs provider configuration, and SMS is not configured.

### 6.6 Garments — FR-GAR-001…007
| ID | Status | Notes |
|---|---|---|
| 001, 002, 004, 005, 007 | ✅ | Unique DB index on tag per tenant |
| 003 photos | 🟡 | Type/colour/brand/fabric/condition ✅; **photo upload not built** (needs S3-compatible storage) |
| 006 tag reprint / replace | ✅ | Replacement bumps tag version, identity unchanged |

### 6.7 Workflow — FR-WF-001…009
All ✅ except FR-WF-005 🟡 (branch-scoped assignment API and scan-station UI exist; employee work queue and machine/batch assignments remain). Assignment authorization and stale-version behavior are covered by smoke checks. Exceptions require notes; resolving them needs `garments.override`.

### 6.8 QC & claims
| ID | Status |
|---|---|
| FR-QC-001…003 | ✅ (checklist is fixed in UI; configurable checklists ⬜) |
| FR-QC-004 damage claims | ✅ `/claims` |
| FR-QC-005 authorized compensation | 🟡 refunds need permission; no claims workflow |

### 6.9 Billing & payments
| ID | Status | Notes |
|---|---|---|
| 001 invoices & receipts | ✅ | 80 mm GST receipt with CGST/SGST split |
| 002 payment methods | 🟡 | Cash/UPI/card/bank/wallet recorded at counter; **no online payment gateway yet** |
| 003–006, 009–012 | ✅ | |
| 007 webhooks, 008 gateway reconciliation | ⬜ | Needs gateway choice (Razorpay / Cashfree / PayU) |

### 6.10 Pickup & delivery — FR-DEL-001…006 🟡
Scheduling, active-driver assignment, scan-verified dispatch manifest, mobile-friendly driver worklist, OTP/recipient proof, failed-attempt rescheduling, delivery events, and collect-on-delivery exist. Recurring pickups, slot capacity/zones, route optimization/GPS, and proof photos/signatures remain.

### 6.11 Inventory — FR-INV-001…006 ✅ (stock ledger, suppliers, purchase orders, receipts, reorder alerts, usage report; branch-to-branch stock transfer ⬜)

### 6.12 Expenses & reconciliation
FR-FIN-001…005 ✅ (attachments ⬜). Gross billed, net sales, collections, receivables and expenses are separate, documented figures; no "profit" is shown.

### 6.13 Notifications
| ID | Status | Notes |
|---|---|---|
| 001 configurable templates | 🟡 | Templates are in code; admin editing ⬜ |
| 002 SMS/WhatsApp/email | 🟡 | Resend email adapter for transactional and opt-in campaign emails; configure `RESEND_API_KEY`, `EMAIL_FROM`, and `MARKETING_UNSUBSCRIBE_SECRET`; SMS/WhatsApp providers not configured |
| 003 events | ✅ | booked, partially ready, ready, delivered, delayed, payment received |
| 004–006 | ✅ | |

Owner-managed campaigns at `/campaigns` support drafts, recipient previews, scheduled/single sends, opted-in customers, 90-day promotional cooldown, last-minute consent checks, unsubscribe links, and POS-redeemable coupons. Configure Resend credentials and run the API worker to send; SMS/WhatsApp, templates, provider webhooks, and delivery/conversion analytics are not complete.

### 6.14 Reports — FR-REP-001…006 ✅ (staff-performance and inventory reports ⬜; PDF export ⬜, CSV ✅)

### 6.15 SaaS subscriptions — FR-SAAS-001…007 ⬜
Tenant status (trial/active/suspended) exists and suspended tenants are blocked; plans, entitlements and billing are not built.

### 6.16 Audit — FR-AUD-001…005
✅ Audit events with actor, IP, request ID, before/after. **Database triggers block UPDATE/DELETE** on audit logs, garment history, inspections, payment allocations, invoice items; payment amounts are immutable. Logs redact cookies and passwords. Retention/export policies ⬜.

## Screens (SRS §7)

| Screen | Status | Route |
|---|---|---|
| A01 sign-in | ✅ | `/login` |
| A02 password reset · A03 invitation | ✅ | One-time expiring tokens; covered by smoke |
| B01 onboarding wizard | 🟡 | `/signup` (single step; seeds default Indian catalogue) |
| B02 branches · B03 org settings | ✅ | `/settings` |
| C01 dashboard | ✅ | `/dashboard` |
| C02 order list | ✅ | `/orders` |
| C03 production board | ✅ | `/production` |
| C04 reports | ✅ | `/reports` |
| D01–D03 customers | ✅ | `/customers`, `/customers/[id]` |
| E01 new order (POS) | ✅ | `/pos` |
| E02 garment detail editor | ✅ | inline in POS (photos ⬜) |
| E03 labels · E04 receipt | ✅ | `/print/labels/[id]`, `/print/receipt/[id]` |
| F01 scan station · F02 QC · F03 packing | ✅ | `/scan` |
| G01 invoice · G02 payment · G03 refund | ✅ | `/orders/[id]` |
| H01–H03 inventory | ✅ | `/inventory` |
| H04 expenses | ✅ | `/expenses` |
| I01–I03 pickup / driver / dispatch | 🟡 | Scheduling, dispatch scan manifest, OTP and driver worklist implemented; route optimization/media proof remain |
| J01 users & permissions | ✅ | `/staff` (employee details, contact/address, weekly schedules, private profile photos, owner-only salary, manual attendance, and leave periods) |
| J02 service & price config | ✅ | `/catalogue` |
| J03 notification templates | ⬜ | (delivery log ✅ at `/audit`) |
| J04 SaaS platform admin | ⬜ | |
| J05 audit | 🟡 | `/audit` (system-health metrics ⬜) |
| Customer self-service portal (§7.12) | ⬜ | |
| Cashier shifts (FR-PAY-012) | ✅ | `/cashier` |

## Acceptance criteria (SRS §16)

| AC | Status | Evidence |
|---|---|---|
| AC-01 tenant isolation | ✅ | `pnpm smoke` — 8 cross-tenant checks |
| AC-02 customers | ✅ | smoke |
| AC-03 order creation | ✅ | smoke (transaction + idempotency) |
| AC-04 garment tracking | ✅ | smoke |
| AC-05 pricing | ✅ | unit tests + smoke |
| AC-06 payment integrity | ✅ | smoke (split, retry, overpay, refund limits, pending-approval hold) |
| AC-07 quality control | ✅ | smoke |
| AC-08 delivery | ✅ | smoke covers scheduling, driver access, manifest mismatch, OTP, failure/reschedule and counter handover |
| AC-09 notifications | 🟡 | outbox & retry built; no failure-injection test yet |
| AC-10 reporting | ✅ | smoke reconciles dashboard to ledger |
| AC-11 permissions | ✅ | smoke (direct API calls) |
| AC-12 recovery | ⬜ | backup/restore drill not done |
| AC-13 operational readiness | ⬜ | monitoring, CI/CD, runbooks not done |

## Recommended next steps

Follow the current prioritized plan in [COMMERCIAL_AUDIT.md](./COMMERCIAL_AUDIT.md). Next P0 work is garment traceability/photos, claims, production batches, and broader acceptance coverage; then inventory/procurement/equipment and branch transfers (P1). Gateway, private image storage, and SMS/WhatsApp work must wait for the owner/provider choices recorded in that audit. Production-readiness work includes CI, monitoring, restore drills, and load tests.

## Software-owner billing: settings, payment gateway, GST invoices, shop Plan & billing (2026-10-28)

- **Super admin → Settings & payment gateways** (`/super-admin/settings`): tabs *Company & invoices* (seller legal name, GSTIN/PAN/CIN, address/state, bank, UPI, invoice prefix + next number, SAC, GST rate, terms, signatory), *Payments & gateway* (UPI / bank / cash methods, instructions, Razorpay test/live keys, connection test, webhook URL), *System health*.
- Stored in `platform_settings` (migration 0023). Gateway secrets are AES-256-GCM encrypted (`apps/api/src/lib/secretBox.ts`); the browser only ever sees the last 4 characters; secrets never enter the audit log.
  - **Production:** set `PLATFORM_SECRETS_KEY` (32 random bytes, base64) in `.env`. Development auto-creates `.local/platform-secrets.key`. Changing the key makes saved gateway secrets unreadable (re-enter them).
- **GST tax invoices** (`commercial_invoices`): issued automatically for every verified or online subscription payment, one continuous number series (row-locked), seller/buyer frozen on the invoice, CGST+SGST when the shop's state (GSTIN or address) matches the seller's, otherwise IGST. Super admin → Tax invoices (list, CSV, void with reason, print/PDF, backfill for older payments).
- **Shop → Plan & billing** (`/billing`, owners): status (trial/active/expired), plans with amount incl. GST, pay by Razorpay, UPI QR with exact amount, or bank transfer; "I have paid" report (UTR) → super admin Payments queue (Verify prefills the form / Reject with reason); invoices to view/print. Desktop edition shows a license note instead.
- **Razorpay**: order → checkout → signature verified → payment re-checked with Razorpay (captured, same order, same shop, full amount) → plan activated + invoice. Webhook `POST /api/v1/webhooks/razorpay` (raw-body HMAC) records payments if the browser was closed; callback and webhook can't double-record (unique provider reference).
- Payment amounts must cover the plan price **including GST** when the plan price excludes GST.
- Tests: `pnpm billing-test` (56 checks, incl. a simulated Razorpay API in `scripts/razorpay-simulator.ts`). It restores the real platform settings and uses a `TEST/` invoice prefix; test shops are excluded from the real queue, invoice list and totals.
- Fixed: the smoke suite left a published ₹0 "Smoke Plan" visible to real shops on every run (18 found and unpublished; the suite now unpublishes its plan at the end).

## 7-day trial, read-only after expiry, dashboard v2, trials console, panel-issued desktop licenses (2026-10-28)

- **Trial length** default is now 7 days (`TRIAL_DAYS`). Existing trials keep their end dates.
- **Access rules** (`apps/api/src/lib/subscriptionAccess.ts`, cloud only): trial running → full access; trial ended → read-only; paid plan → full access until end + 3-day grace; suspended → read-only. Read-only shops can sign in, read everything, and use Plan & billing (402 `SUBSCRIPTION_REQUIRED` on changes). Shops activated without a recorded plan, legacy trials without an end date, the desktop edition and super admins are never limited. `PlanBanner` shows trial-ending / grace / read-only notices with a "Choose a plan" link for owners.
- **Dashboard** redesigned (hero photo + quick actions, 4 KPIs with % vs previous period and sparklines, revenue & collections chart, quick access, sales by branch incl. self-service laundry and dues, counter-wise takings by cashier and payment method, recent orders, garment status breakdown, ready/overdue desks). Branch-scoped by role: owners see all branches, managers only theirs, counter staff see no money figures.
- Mobile header: branch selector narrower and bell hidden on phones (multi-branch shops overflowed by 65px on every page).
- **Super admin → Free trials**: KPIs (active, ending in 3 days, lapsed, 90-day conversion, new this week), tabs (active / ending soon / lapsed / converted), activity and Hot / Engaged / Tried it / At risk signal, extend dialog (reason audited), record payment, email reminder (`POST /platform-admin/organizations/:id/trial-reminder`), call and WhatsApp links.
- **Super admin → Licenses & releases**: create the license signing key once (Ed25519; private key encrypted with secretBox; public key written to `apps/desktop/build/license-public.pem` in a dev checkout and downloadable), issue activation keys for PCs (plan, validity, request codes, note), register of issued keys (`desktop_licenses`, migration 0024), passphrase-encrypted private-key backup compatible with the CLI issuer. `pnpm license-test` (21 checks; skips itself if a real key exists and removes its own test key).
- Desktop: `scripts/build.mjs` now points to the console for the public key. Stage build verified with all new screens; the installer is built after the owner creates the signing key.

## Plans published, reports centre, A5, online booking, customer wallet (2026-10-28)

- **Plans** (excl. GST): Starter ₹999/mo (1 branch, 2 devices), Growth ₹1,999/mo and Growth Yearly ₹19,999/yr (3 branches, 6 devices, + laundry, marketing, WhatsApp), Enterprise custom quote (unpublished). Plan limits are not yet enforced in-app.
- **Reports centre** (`/reports`, API `modules/reportsCenter.ts`): 17 reports in Sales (service, garment, daily, branch-wise, GST summary B2B/B2C, discounts & credit notes), Money (day book, payment methods, expenses by category, customers with dues), Customers (top, inactive, new), Operations (pending register with ageing, cancelled orders), Staff (productivity, user activity). Role-filtered catalogue, branch scope, totals, CSV, print. `pnpm reports-test`.
- **A5 invoices**: third paper size (A4 layout at 70.7%, `@page A5`); verified as a single A5 page.
- **Online pickup booking**: owner toggle in Pickups & deliveries → Online booking (branch, message, link, WhatsApp share, QR poster). Public page `/book?s=<org slug>` creates/matches the customer and a scheduled pickup marked "Online booking". Spam limits: 5 per 10 min per IP, honeypot, max 2 open requests per phone, 30-day window; off for lapsed trials.
- **Customer wallet** (`customer_wallet_entries`, migration 0025; `lib/wallet.ts`, `modules/wallet.ts`): counter top-ups are real payments (counted in collections and the drawer); paying with the new `store_credit` method ("Customer wallet") debits the wallet under a customer row lock and is excluded from every money-in figure (dashboard, reports, day book, counters, drawer non-cash). Refunds of wallet payments go back to the wallet. Manager adjustments with reason. Wallet tab on the customer page; POS shows the balance and "Use wallet". Expenses and manual refunds cannot use the customer wallet. `pnpm wallet-test`.
- Desktop installer built with the console's license public key (fingerprint 70A3-0CF2-B0E6-7EBA).

## Windows app: 7-day demo, then upgrade (2026-10-28)

- Unlicensed desktop installs run as a full **7-day demo** (`lib/license.ts` `demoState`, `DEMO_DAYS`). After that every API call answers 402 `LICENSE_REQUIRED` ("Your 7-day DryCare demo has ended…") and the app opens `/activate`, which now shows "Your 7-day demo has ended", the data-is-kept note, the 3 steps to buy, and the PC request code. During the demo a banner shows days left with **Upgrade now** (`/activate?upgrade=1`, owners) to activate early.
- Start = earliest of `demo.json` (next to `license.json` in the app's user-data folder, HMAC-sealed) and the oldest store record in the local database (set at start-up in `apps/desktop/src/server-entry.ts`). Deleting `demo.json` doesn't restart it; editing it or moving the clock back more than a day ends it. Reinstalling keeps app data, so the demo carries over.
- Cloud signups keep their own 7-day trial + read-only rules (`subscriptionAccess.ts`); development builds of the desktop app are never limited.
- `pnpm demo-test` (10 checks). Desktop version 0.1.5.
