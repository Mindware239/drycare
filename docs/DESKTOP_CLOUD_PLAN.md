# DryCare Windows Desktop + Cloud — Implementation Plan

Date: 29 Oct 2026 · Owner decision: keep PostgreSQL; Windows 10/11 64-bit; Android via installable web app (PWA); optional cloud sync. No destructive database change without owner approval.

## 1. Current state (inspected)

| Area | Finding |
|---|---|
| Desktop runtime | Electron 44.5.1 (Chromium-based), x64 only, NSIS installer (`apps/desktop`, v0.1.5). Electron ≥ 23 does not run on Windows 7/8/8.1. |
| Supported Windows | Windows 10 and 11, 64-bit. The installer did not check the OS before this plan (now added, §5). |
| Database | Embedded PostgreSQL 17 (`embedded-postgres`) in `%APPDATA%\DryCare\pgdata`, loopback only, scram auth, random password in `config.json`, UTF-8/locale C, clean `pg_ctl stop -m fast` on exit. Crash recovery is PostgreSQL's WAL redo (seen working in the install log after an unclean exit). |
| Startup (measured on this PC) | Normal launch **2.2 s** to the main window (PostgreSQL ready in 0.1–0.3 s). First launch after install, including database creation, **≈ 9 s**. Target < 20 s is met. |
| Startup bug found and fixed | On PCs running Hyper-V/WSL/Docker, Windows reserves port blocks (here 54307–54506). The app tried only 54329–54348 and **failed to start** ("No free port near 54329"). It now falls back to an OS-assigned free port (`apps/desktop/src/main.ts` `findPort`). |
| Backups | SQL-only backups (`apps/api/src/lib/backup.ts`, format v2 since 0.1.6 — the COPY-stream v1 writer could stall under newer Node.js; v1 files still restore): daily on start and on close, manual, restore with a safety copy, 30 kept. `pnpm backup-test` (10 checks). |
| Data model | 73 tables, UUID primary keys everywhere, `organization_id` on tenant rows, money in paise. Append-only ledgers guarded by triggers (payments, allocations, refunds, audit, garment history, stock movements, claim events). `version` columns on orders and garments (optimistic concurrency). |
| Numbering | Order and laundry numbers are per **branch** and year. Invoice, credit note, PO, transfer, customer, item and claim numbers are per **business** and would collide if two PCs of one business issued them offline. |
| Licensing | Offline signed licence per installation; not linked to a cloud tenant. |

## 2. Target architecture

```
 Shop PC (Windows 10/11)                         DryCare Cloud (PostgreSQL, HTTPS)
 ┌─────────────────────────────┐   push batches   ┌───────────────────────────────┐
 │ Electron + API + PostgreSQL │ ───────────────▶ │ /api/v1/sync/push  (device    │
 │ works fully offline         │                  │   token, idempotent, tenant-  │
 │ change log (outbox)         │ ◀─────────────── │   scoped)  /sync/pull         │
 └─────────────────────────────┘   pull changes   └───────────────────────────────┘
        ▲  shop Wi-Fi (LAN)                                ▲ HTTPS
   phones/tablets (browser)                         owners, other branches, PWA
```

* **Local-first:** the PC remains the system of record for its branch. Every screen keeps working with no internet (already true today: the API and database run on the PC).
* **Change capture:** a trigger-maintained `sync_outbox` (table, row id, operation, row JSON, local sequence, device id) records every insert/update on synced tables inside the same transaction as the business change, so a crash can never lose or half-record a change.
* **Push:** batches sent with a batch id + per-change id. The cloud applies them in one transaction and stores applied ids, so a retried batch is a no-op (no duplicate orders or payments).
* **Apply rules per table:**
  * Append-only ledgers (payments, allocations, refunds, credit notes, audit, history, stock movements, claim events): insert-if-absent by UUID. They are never updated, so there are never conflicts.
  * Branch-owned mutable rows (orders, garments, invoices, bags, transfers): accepted only from the device registered to that branch; `version` must be the next version, or the change goes to `sync_conflicts`.
  * Shared master data (customers, catalogue, prices, staff): field-level merge with `updated_at` + `version`; financial fields are never overwritten silently, and conflicts go to a review list.
* **Pull (phase 3):** the cloud returns changes since the device's cursor for shared master data and other branches' read-only data.
* **Numbering:** before multi-PC sync, business-wide series become branch series (e.g. `INV/BR1/2026/000123`). This is required so GST invoice series stay unique and gap-free per issuing branch. It is a data-format change that affects printed invoices, so **it needs owner approval** (it only affects new documents; existing numbers are unchanged).
* **Security:** the PC gets a revocable **device token** (hashed in the cloud, stored encrypted with Windows DPAPI on the PC) when an owner links the install to a cloud business. There are no database credentials or admin secrets in the desktop app. The cloud validates tenant, branch ownership and role for every change; payments are re-validated server-side (amount ≤ balance, allocation sums); everything is audited.
* **Status UI:** a sync indicator in the top bar (offline / syncing / up to date / N pending / conflicts), the last successful sync time, a **Sync now** button and a conflicts list for owners.

## 3. Phases

| Phase | Scope | Status |
|---|---|---|
| 1. Reliability & reach | Port fallback fix; backup stall fix (format v2); installer refuses Windows < 10 and 32-bit with a clear message; repeatable startup-time test; installable web app (PWA) for Android; plan document | **Done (0.1.6)** |
| 2. Sync foundation (local) | Migration 0027: `sync_config`, `sync_entities`, `sync_outbox` + capture triggers, `sync_conflicts`; queue processor behind a transport interface; status API and top-bar indicator; `pnpm sync-test` | **Done (0.1.7)** — no cloud upload yet |
| 3. Cloud push | Device linking, `/sync/push`, apply rules, retries, conflict review (§8) | **Built and tested against a local test cloud (0.1.8). Not deployed: no production cloud exists yet.** |
| 4. Branch numbering + pull | Per-branch document series (**owner approval**), pull of shared master data, multi-branch reports in the cloud | After phase 3 |
| 5. Operations | Startup integrity check (catalog + recent-backup verification), restore drill script, Windows 10/11 VM test matrix, code signing + auto-update | Parallel |

## 4. Risks

* **Invoice numbering across PCs** (above). Mitigation: branch series before multi-PC sync; single-PC shops are unaffected.
* **Clock skew on shop PCs.** Ordering uses the device's local sequence, not wall-clock time; `updated_at` is used only as a tie-break signal.
* **Large first sync** of an existing shop. Push in pages of about 500 changes with resumable cursors.
* **Schema drift between PC and cloud versions.** Each batch carries the schema version; the cloud refuses batches from newer schemas and asks the PC to update; older schemas are mapped.
* **Windows 7/8.1.** Not supported: current Electron/Chromium and PostgreSQL 17 require Windows 10+. Supporting them would mean an unpatched browser engine; not recommended for a commercial product. No claim of support is made.

## 5. Testing matrix

| Test | How |
|---|---|
| Startup < 20 s (normal and first launch) | `pnpm desktop:startup-test` (launches the staged app, measures until the main window, closes cleanly) |
| Reserved/occupied ports | Startup test on a PC with Hyper-V (this dev PC: 54307–54506 reserved) |
| Installer OS guard | Windows 10 x64, Windows 11 x64 VMs install; Windows 8.1 / 32-bit VM shows the message and stops |
| Offline operation | Existing API suites (`smoke`, `flow-test`, `billing-test`, `wallet-test`, `inventory-test`, `laundry-test`) run against the local database with no internet |
| Crash safety | Kill the app mid-transaction; restart; verify WAL recovery and no partial order/payment (phase 2 adds an outbox check) |
| Backup/restore | `pnpm backup-test`; restore drill on a copy |
| Sync (phase 3) | Reconnect after offline period, duplicate batch replay, duplicate payment replay, version conflict, cross-tenant rejection, schema-version mismatch |
| PWA | Android Chrome over HTTPS (cloud): install prompt, full-screen launch, offline notice; over shop Wi-Fi (HTTP): home-screen shortcut |

## 6. Effort (indicative)

Phase 1: done in this change. Phase 2: 3–4 days. Phase 3: 1.5–2 weeks (plus hosting). Phase 4: 1 week (after numbering approval). Phase 5: ongoing; code signing needs a purchased certificate.

---

## 7. Phase 3 plan — cloud push synchronisation (Stage A, 29 Oct 2026)

### 7.1 What exists today (inspected)

* **Cloud backend:** the same Fastify API in `DRYCARE_MODE=saas` with the same PostgreSQL schema (all migrations, including 0027). Multi-tenant via `organization_id`; cookie sessions; per-route permissions; `assertWritable` already makes a shop read-only (expired trial/plan).
* **Hosting:** none. No Dockerfile, CI, reverse proxy, TLS or production URL exist in the repository; `docker-compose.yml` is local development only. Web metadata defaults to `https://drycare.in`, but nothing is deployed there from this repo.
* **Accounts:** PC accounts are local to the PC (README). Cloud `users.email` is globally unique and `password_hash` is NOT NULL.
* **Licensing:** `desktop_licenses` (issued from the cloud super-admin console) list installation ids and can reference a cloud organisation — usable to bind a device to the licence it was sold with.
* **Phase 2:** trigger-based outbox, lease-based claiming, back-off, conflict store, `SyncTransport` interface, status UI, `pnpm sync-test` (50 checks). Verified working.

### 7.2 Gaps in Phase 2 that Phase 3 must close

| Gap | Resolution |
|---|---|
| Data created before 0.1.7 was never queued | **Baseline snapshot** at link time: every row of every synced table enqueued once (op `snapshot`, parents before children), then normal capture continues. |
| Desktop staff users cannot be copied into cloud logins (email uniqueness; password hashes are stripped) | Identity tables (`users`, `organization_memberships`, `roles`, `staff_profiles`) are applied to a **mirror** (`sync_mirror_users`) used only for names in reports. PC staff never become cloud logins. |
| Cloud web could edit a PC-owned business, but Phase 3 is push-only | A linked business is **read-only in the cloud web** (`organizations.settings.syncSource = "device"` → `assertWritable` refuses writes with a clear message). Viewing and reports work. |
| Two PCs of one business could both link → duplicate invoice numbers | **One active device per organisation** until Phase 4 (unique partial index on active devices). Re-linking the same PC or replacing a PC revokes the old one first. |
| Some rows lack `branch_id` (`garments.current_branch_id`) or `organization_id` (`users`) | Server derives ownership from the row and its parents; client-supplied org/branch ids are never trusted. |
| Queue grows on shops that never link | **Decision 5** below. |

### 7.3 Design

* **Tenant model:** linking creates (or re-attaches) a cloud tenant that **keeps the PC's own UUIDs** for the organisation and branch. No id mapping, so every foreign key in the uploaded data stays valid. An owner's separate, pre-existing cloud trial business is not merged.
* **Linking (device authorisation flow):** PC calls `POST /sync/link/start` → cloud returns a short code and a URL. The PC opens the owner's browser at `{cloud}/link-device?code=…`; the owner signs in to the cloud (or creates a cloud account), sees "Link *Raj Store — Main* (this PC)" and approves. The PC polls `POST /sync/link/poll` and receives a **device credential** once. The owner's cloud password is never typed into the desktop app.
* **Device credential:** 256-bit random secret, sent as `Authorization: Device <deviceId>.<secret>`; the cloud stores only its SHA-256 hash, expiry (90 days) and status. The PC rotates it automatically before expiry (`POST /sync/device/rotate`); owners and the super admin can revoke it. Stored on the PC with **Electron `safeStorage` (Windows DPAPI, per Windows user)** in `%APPDATA%\DryCare\sync-credential.bin`, read only by the main process. Never sent to the renderer or web bundle.
* **Push API** `POST /api/v1/sync/push` (HTTPS only, ≤ 500 events, ≤ 2 MB): `{ batchId, deviceId, schemaVersion, events[] }`. Organisation and branch come from the device record, not the body. One database transaction per batch; events are applied in `seq` order; every applied event id is stored with a payload hash in `sync_applied_events` (unique on device + event id), so a replay returns `duplicate`, and a reused event id with a different payload returns `rejected`. The response is sent only after commit; the PC marks events acknowledged only from that response. Timeouts are therefore safe: retrying a committed batch returns `duplicate` for each event.
* **Apply rules:**
  * *ledger*: insert-if-absent; existing row with different content → conflict. Updates are allowed only where the existing database guards allow them (e.g. payment status, customer merge).
  * *financial / operational / master*: insert-if-absent; update only if the row belongs to the device's organisation and, where a `version` column exists, the incoming version is newer; equal or older → `stale` (acknowledged, not applied); same version with different data → conflict.
  * Never last-timestamp-wins for money.
  * After each batch the server checks invariants for touched invoices and payments: allocations ≤ payment amount, paid ≤ invoice total + credits, refunds ≤ payment, all rows in the device's organisation. A violation rolls the batch back and returns `rejected` for the offending events (recorded as conflicts on the PC).
* **Schema versions:** a batch from a newer schema than the cloud → `426 SCHEMA_TOO_NEW` (PC keeps events, shows "Cloud update pending"). Older schemas are accepted; missing columns take their defaults.
* **PC worker:** runs in the API process inside the Electron main process, one at a time (database advisory lock + existing lease). Triggered every 60 s, on reconnect and on **Sync now**. Exponential back-off with jitter; `401/403` → stop and show "Re-link needed"; `429` → honour `Retry-After`. Malformed events → permanent failure after a non-retryable reply (no infinite loop).
* **Cloud tables (migration 0028, additive):** `sync_devices`, `sync_link_requests`, `sync_applied_events`, `sync_batches` (audit: device, counts, outcome, no payloads), `sync_mirror_users`, plus a remote-conflict log. Indexes on (organization, device) and (device, event id).
* **UI:** the top-bar indicator gains *Link to cloud*, *Syncing…*, *Sync now*, *Re-link needed* and a conflicts list for owners. Online status stays separate from "Last successful cloud sync".

### 7.4 Test plan

`pnpm cloud-sync-test` starts a **local integration cloud** (a second API instance in saas mode on its own throwaway database) and a desktop-mode API on another throwaway database, and exercises all 16 required scenarios over real HTTP. These are integration tests against a local test cloud — **not** production. Production verification requires the hosted environment (§7.5) and a real Windows install pushing to it.

### 7.5 Decisions needed from the owner

1. Production cloud URL, hosting provider and region (data residency), managed PostgreSQL 17, TLS certificate, and who operates backups and monitoring.
2. Linked business is read-only in the cloud web (recommended), or editable (requires Phase 4 two-way sync).
3. One linked PC per business until Phase 4 (recommended).
4. When change capture starts: at linking with a baseline snapshot, and pruning acknowledged events after 30 days (recommended), or from day one.
5. Commercial: whether cloud sync is included in every licence or is a paid add-on (affects the check made at linking).


## 8. Phase 3 — as built (29 Oct 2026, v0.1.8)

Owner decisions: build and test against a local test cloud first; cloud copy is **read-only** and **one PC per shop**; change capture starts **at linking with a snapshot**, acknowledged events pruned after 30 days; cloud sync is a **paid add-on** (plan entitlement `cloudSync`).

### 8.1 Migration `0028_cloud_sync` (additive)

New tables: `sync_devices` (one active per organisation, enforced by a partial unique index), `sync_link_requests`, `sync_applied_events`, `sync_entity_state`, `sync_batches`, `sync_remote_conflicts`, `sync_shadow_users`. `sync_config` gains `cloud_state`, `cloud_url`, `linked_at`. `sync_outbox` checks are widened to allow op `snapshot` and status `skipped`. Data step: on installs that are **not linked**, queue entries from the 0.1.7 always-on capture are cleared and capture is switched off (queue only, never business data; nothing had been linked yet).

### 8.2 API contracts (all under `/api/v1`, JSON, header `x-drycare-csrf: 1`)

| Endpoint | Caller | Purpose |
|---|---|---|
| `POST /sync/link/start` | PC (anonymous, 10 per 10 min per IP) | `{deviceId, deviceName, appVersion, schemaVersion, shop{organizationId, organizationName, branchId, branchName, branchCode, gstin}}` → `{requestId, userCode "ABCD-2345", pollToken, verificationUrl, expiresAt (15 min), pollIntervalSeconds}` |
| `GET /sync/link/requests/:code` | cloud owner (session) | Shop and device shown for approval; existing cloud copy; active PC that would be replaced; entitlement |
| `POST /sync/link/approve` | cloud owner | `{code, replaceExisting}` → creates the view-only cloud copy (keeping the PC's own UUIDs) or re-links the owner's existing copy. Errors: `409 DEVICE_ALREADY_LINKED`, `409 ORG_NOT_LINKABLE`, `403` if not the copy's owner |
| `POST /sync/link/deny` | cloud owner | Decline |
| `POST /sync/link/poll` | PC (poll token) | `{status: pending / approved / denied / expired}`; on approval returns the device credential **once** |
| `GET /sync/device` | device | Status, entitlement, cloud schema version |
| `POST /sync/device/rotate` | device | New credential; the previous one stays valid for 24 h |
| `POST /sync/push` | device | `{batchId, schemaVersion, appVersion, events[≤500]}` (body ≤ 4 MB) → after commit `{batchId, committed: true, results[{id, outcome: applied / duplicate / stale / conflict / error, reason or message, retryable, remoteData?}], counts}`. Errors: `401 DEVICE_AUTH_FAILED / DEVICE_REVOKED / DEVICE_CREDENTIAL_EXPIRED`, `402 CLOUD_PLAN_REQUIRED`, `426 SCHEMA_TOO_NEW`, `429` |
| `GET /sync/devices`, `POST /sync/devices/:id/revoke` | cloud owner | List or disconnect the shop PC |
| `GET /auth/organizations`, `POST /auth/switch-organization` | signed-in user | Switch between one's own cloud business and the PC's cloud copy |
| PC only: `GET /sync/status`, `POST /sync/cloud-link/start`, `/cancel`, `/unlink`, `POST /sync/now`, `GET /sync/conflicts`, `POST /sync/conflicts/:id/resolve {action: retry / skip, note}`, `POST /sync/retry` | PC staff (owner for actions) | Indicator, linking, Sync now, conflict decisions |

### 8.3 Security decisions

* **Device credential:** 256-bit random, sent as `Authorization: Device <deviceId>.<secret>`. The cloud stores the SHA-256 only and compares in constant time. 90-day expiry with automatic rotation 14 days before; the owner can revoke; only the copy's owner can re-link.
* **PC storage:** Electron `safeStorage` (AES-GCM; key protected by Windows DPAPI for the Windows user) in `%APPDATA%\DryCare\sync-credential.bin`, main process only. Verified not readable, and absent from `config.json` and logs.
* **Tenant isolation:** organisation and branch always come from the device record. Every row, and every row it references through a foreign key, must belong to that organisation (`CROSS_TENANT` / `CROSS_BRANCH`). An event's `deviceId` must equal the authenticated device.
* **PC staff** are uploaded as **non-login shadow users** (`status = pc_staff`, unusable password, `<id>@pc-staff.drycare.invalid`). Passwords, tokens and OTP data are never uploaded.
* **View-only cloud copy:** `settings.syncSource = "device"` makes the cloud web refuse changes with `409 MANAGED_BY_SHOP_PC`. Phase 3 is push-only; no data flows back to the PC.
* **Money:** ledger rows are insert-if-absent; a different row with the same id is a conflict. The cloud itself checks allocations and refunds against payment amounts, invoice paid against total minus credits, and wallet statement totals for each PC transaction; a violation rejects the whole PC transaction. Timestamps never decide money conflicts.
* **Errors:** database errors are mapped to codes (`DEPENDENCY_MISSING`, `UNIQUE_CONFLICT`, `IMMUTABLE_RECORD`, `INVALID_DATA`, `CLOUD_ERROR`); no SQL or stack details reach the PC. `sync_remote_conflicts` keeps codes and hashes, not row data.
* **Transport:** HTTPS is required for the cloud URL. `http://localhost` is allowed only with `DRYCARE_CLOUD_ALLOW_INSECURE=true`, for tests.

### 8.4 Tests

* `pnpm cloud-sync-test`: **local test cloud with a simulated network, 72 checks.** Covers all 16 required scenarios plus the paid-add-on gate: registration; unauthorised and revoked devices; cross-tenant and cross-branch; push with durable acknowledgement; replay; reused event id; network loss before and after commit (fault proxy); restart with in-progress batches; stale, out-of-order and version conflicts; duplicate payments and stock; allocation and invoice validation; conflict recording; schema mismatch; a resumable 1,200-row upload and the 501-event limit; rotation, revocation, re-link and the one-PC rule; existing workflows and backup.
* **End-to-end with the real Windows app** (staged Electron, DPAPI store) against the local dev cloud. Linked through the real approval page; showed "Cloud plan needed" until a plan was granted; then 845 snapshot changes plus a later payment uploaded (4 batches, 847 applied, 0 duplicates, conflicts or rejections). The cloud web showed the order as paid. **This is not a production test.**

### 8.5 Deployment steps (when hosting is decided)

1. Provision the cloud: a Node 22+ host for `apps/api` (saas mode) and `apps/web`, managed PostgreSQL 17, a TLS certificate, backups and monitoring. Set `WEB_ORIGIN` to the public HTTPS URL, `COOKIE_SECURE=true`, email (Resend) and `PLATFORM_SECRETS_KEY`.
2. Run `pnpm db:migrate` on the cloud database **before** starting the new API.
3. Create a published plan whose entitlements include `"cloudSync": true` (super-admin console → plans).
4. Point PCs at the cloud: `cloudUrl` in `%APPDATA%\DryCare\config.json`, or `DRYCARE_CLOUD_URL` (HTTPS only).
5. Production acceptance: link a real Windows install, upload, verify in the cloud, then run the failure checks (offline, revoke, re-link) on the real host before announcing the feature.

### 8.6 Known limitations

* No production cloud exists and nothing is deployed. Cloud sync is **not** operational for customers.
* ~~Cloud web screens still show create and edit buttons on the view-only copy~~: fixed in §9.1.
* ~~A single PC transaction with more than 400 changes is applied in parts~~: fixed by staged commit (§9.1).
* Rare: if the owner skips a conflicted parent record, children of a newly created parent may wait as `DEPENDENCY_MISSING` until reviewed.


## 9. Production-readiness review (29 Oct 2026, v0.1.9, migration 0029)

### 9.1 Phase 3 issues fixed

| Issue | Fix |
|---|---|
| View-only cloud copy still showed write actions | When the business is a PC copy, the session's `can()` keeps only view permissions (`customers.read`, `orders.read`, `reports.view/financial`, `audit.view`, `laundry.view`, plus `org.manage` for Plan & billing and the linked-PC card). Menus and buttons that depend on write permissions disappear. Label printing and "Open scan station" are now gated too. A sweep of every visible page found only navigation, filters, print and export. The server still refuses writes (`409 MANAGED_BY_SHOP_PC`). |
| Changes with more than 400 records were applied in parts | **Staged commit** (migration 0029, `sync_staged_events`): the PC keeps each change whole in a batch. A change bigger than a batch is sent in parts tagged `groupSize` / `groupFinal`. The cloud holds parts without applying them (outcome `staged`; the PC shows them as still waiting) and applies the whole change in one transaction when the last part arrives. If parts are missing, `GROUP_INCOMPLETE` makes the PC resend the whole change. Snapshot rows are applied independently. Conflict decisions cover the whole change. |
| Sign-up from the approval page lost the pending code | Sign-up honours `?next=/link-device?code=XXXX-XXXX` (only that exact pattern, so it can't be used as an open redirect). Codes stay 15-minute, single-use (consumed on first credential issue), and the credential is bound to the PC's poll token. The PC now shows which cloud account approved it. |

### 9.2 Audit

| Area | Finding | Status |
|---|---|---|
| Authentication | Argon2id passwords; hashed server-side sessions; CSRF header; email-OTP for super admin. Device credentials SHA-256 hashed, constant-time compare, 90-day expiry, rotation with 24 h overlap | OK |
| Proxy / client IP | `trustProxy: true` let any client fake `X-Forwarded-For`, bypassing rate limits and falsifying audit IPs | **Fixed**: `TRUST_PROXY` setting, default off; production refuses `true` |
| Rate limiting | Global 600/min per IP; login/signup 10/min; link start 10/10 min; link view/approve/deny 30/10 min; poll 40/min; push 120/min; rotate 5/h. In-memory store | OK for **one** API instance; multiple instances need a shared (Redis) store |
| Tenant isolation | Org/branch from session or device; every synced row and its foreign-key targets checked; cross-tenant/branch tests pass | OK |
| Device revocation | Checked on every device request; revoked PC pauses with "Link again" and keeps its changes | OK |
| Link-code guessing | 40-bit codes, 15 min, per-IP limits; approver shown on the PC | Acceptable; consider requiring the owner to type the code |
| Payment validation | Cloud re-checks allocations, refunds, invoice paid ≤ total − credits, wallet sums per PC change | OK |
| Retry safety | Event-id dedupe, durable ack after commit, staged commit, lease recovery, network-loss tests before and after commit | OK |
| Secrets | Device secret: DPAPI on the PC, hash in the cloud. Poll token hashed. No DB credentials leave the server. `.env` holds the email app password and keys: use the host's secret store in production | **Hosting task** |
| Cookies / TLS | `COOKIE_SECURE` defaulted to false | **Fixed**: production refuses to start unless `COOKIE_SECURE=true` and `WEB_ORIGIN` is https; warns if the database URL lacks `sslmode=require` |
| Backup restore (cloud) | No automated cloud backups in the repo | **Hosting task**: managed PostgreSQL point-in-time recovery plus a tested restore drill |
| Backup restore (PC, linked) | Restoring an older backup on a linked PC could upload old data over newer cloud records and reuse order numbers | **Fixed (guard)**: uploads pause after a restore ("Paused after restore"); support must check the cloud copy before re-linking. Full reconciliation needs Phase 4 pull |
| Monitoring | Only `/health` existed | `/health/ready` added (database, schema version, mode, uptime). Still needed: external uptime check, error tracking, log retention, alerts on `sync_remote_conflicts` growth — **hosting task** |
| Migrations | All additive (0026–0029); run before starting the new API; startup tolerates a missing migration | OK |
| Rollback | Additive schema: roll back by redeploying the previous app version (old code ignores the new tables). Data rollback by restoring the pre-deploy database snapshot. PCs refuse to upload to an older cloud schema (`426`) instead of corrupting it | Documented; take a database snapshot before every deploy |

### 9.3 Remaining blockers before production

1. **Hosting decided and provisioned**: URL, region, managed PostgreSQL 17 with PITR and `sslmode=require`, TLS, secret store.
2. **Production settings**: `NODE_ENV=production`, `COOKIE_SECURE=true`, `WEB_ORIGIN=https://…`, `TRUST_PROXY=<hop count or proxy addresses>`, email provider, `PLATFORM_SECRETS_KEY`, `CUSTOMER_APPROVAL_SECRET`, `MARKETING_UNSUBSCRIBE_SECRET`.
3. **One API instance**, or a Redis-backed rate-limit store before scaling out.
4. **Monitoring and alerting** wired to `/health/ready` and the error logs.
5. **Restore drill** on the hosted database.
6. **Production acceptance**: a real Windows install links, uploads, survives offline/revoke/re-link on the hosted cloud.
7. **Code-signing certificate** for the Windows installer (SmartScreen warning today).

### 9.4 Hosting configuration required

| Setting | Value |
|---|---|
| `DATABASE_URL` | Managed PostgreSQL 17, `?sslmode=require` |
| `NODE_ENV` | `production` |
| `DRYCARE_MODE` | `saas` |
| `WEB_ORIGIN` | `https://<your cloud domain>` |
| `COOKIE_SECURE` | `true` |
| `TRUST_PROXY` | e.g. `2` (load balancer + Next.js web server in front of the API), or the proxy addresses |
| `RESEND_API_KEY` + `EMAIL_FROM` (or SMTP) | Verified sender domain |
| `PLATFORM_SECRETS_KEY`, `CUSTOMER_APPROVAL_SECRET`, `MARKETING_UNSUBSCRIBE_SECRET` | Long random values from the secret store |
| Never set in production | `SYNC_CAPTURE=on`, `DRYCARE_CLOUD_ALLOW_INSECURE` |
| Deploy order | Snapshot the DB → `pnpm db:migrate` → start the API (it refuses unsafe settings) → check `/health/ready` reports the expected `schemaVersion` |
| PCs | `cloudUrl` in `%APPDATA%\DryCare\config.json` (or `DRYCARE_CLOUD_URL`), https only |
