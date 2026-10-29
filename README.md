# DryCare

Multi-tenant dry cleaning & laundry store management — customer records, barcode-tagged garments, cleaning workflow with quality control, GST billing, payment ledger and reporting. Built from `SOFTWARE REQUIREMENTS SPECIFICATION (SRS).pdf` (DRYCARE-SRS-001 v1.0).

**What's built and what's left:** see [docs/PROGRESS.md](docs/PROGRESS.md).

## Editions

| Edition | For | Status |
|---|---|---|
| **DryCare for PC** (`apps/desktop`) | One shop, installed on the counter PC, works offline. Other PCs/tablets in the shop can connect over Wi-Fi. | Activation implemented; installer build needs the owner's signing key |
| **DryCare Cloud** (`apps/api` + `apps/web` on a server) | Chain of stores / many businesses, central reporting | Core works; multi-branch & SaaS layers in progress |

Both editions are the same code. The PC edition runs the API and a private PostgreSQL inside the app, so moving a shop to the chain edition later is a data migration, not a rewrite.

## DryCare for PC

Build the Windows installer:

```bash
pnpm install
pnpm license:keygen                 # one-time; encrypts private signing key outside the project
pnpm --filter @drycare/desktop dist     # → apps/desktop/release/DryCare-Setup-0.1.3.exe
```

Try it without installing: `pnpm --filter @drycare/desktop start`.

### Manual PC licenses

The PC installer requires activation. The owner pays by the bank/UPI method agreed with DryCare, sends the activation request code shown in the app, and receives a signed key. No payment or license server is contacted by the app.

- `pnpm license:keygen` creates an Ed25519 verification key at `apps/desktop/build/license-public.pem` and an encrypted private signing key under `%APPDATA%\DryCareLicenseIssuer`. Keep the private key and its passphrase secure and backed up separately. The public key belongs in source control and must stay the same for future builds and renewals.
- Build the installer after key generation. For each request, issue a key with `pnpm license:issue -- --plan "Standard" --expires 2027-10-27 --device-code <request-code>`. Use `--expires never` for a perpetual license. Add another `--device-code <code>` for each additional licensed PC; only those listed PCs can activate that key.
- Customers can copy their request code from the activation screen. Activation and license checks work offline. Expiration blocks normal app/API use until renewal; the license does not delete the local database or backups. The DryCare menu still offers backup and restore.
- This is an offline commercial-license check, not tamper-proof DRM: a determined user with control of the PC can alter local software or system time, and offline keys cannot be remotely revoked. Do not promise remote deactivation or fraud-proof enforcement.

What the installed app does:

- **First launch** asks for a signed license key, then opens *Set up your store* (business name, owner login, GSTIN). A starter price list for common Indian garments is created. Setup can only happen once per installation.
- **Accounts are local to this PC**: sign in with the email and password created during this PC's first store setup. Web/cloud and other-PC credentials are separate. If the local owner forgets the password or is locked out, version 0.1.2 and later provide a local-only reset from the sign-in screen; it requires the owner email and does not delete store records. Reinstalling will not reset the account or remove saved data.
- **Navigation** in version 0.1.3 includes the updated permission-aware sidebar, a persistent desktop expand/collapse control, and light/dark theme selection. Local owner password recovery is available from the sign-in screen in the installed PC app.
- **Data** lives in `%APPDATA%\DryCare\pgdata` (PostgreSQL 17, UTF-8, listening on 127.0.0.1 only). Uninstalling or upgrading DryCare never deletes it.
- **Backups** go to `Documents\DryCare Backups`: automatically at start-up (daily) and on closing, plus *DryCare → Back up now*. The newest 30 automatic backups are kept. *DryCare → Restore backup…* restores one after saving a safety copy. Copy the folder to a pen drive or cloud drive regularly.
- **Other computers in the shop**: *DryCare → Allow other computers in this shop* lets a second counter PC, tablet or phone on the same Wi-Fi open DryCare in a browser (address shown in *Business settings*).
- **Log file**: *DryCare → Open log file* (`%APPDATA%\DryCare\logs\drycare.log`) for support.

Notes: the installer is not code-signed yet, so Windows SmartScreen shows "Unknown publisher" (click *More info → Run anyway*). Buy a code-signing certificate before giving it to customers. Run DryCare as a normal user, not "Run as administrator" (PostgreSQL refuses to run with admin rights).

## Stack

| Layer | Tech |
|---|---|
| Web | Next.js 16, React 19, TypeScript, Tailwind CSS 4 — `apps/web` |
| API | Node.js, Fastify 5, Zod — `apps/api` (modular monolith) |
| Database | PostgreSQL 17 + Drizzle ORM migrations |
| Background worker | Transactional outbox → notification jobs — `apps/api/src/worker.ts` |
| Shared | Pricing, workflow state machine, permissions, schemas — `packages/shared` |

## Development (both editions)

Prerequisites: Node 22+, pnpm 11, Docker.

```bash
pnpm install
cp .env.example .env          # already done once
pnpm db:up                    # Postgres on :5440, Redis on :6390
pnpm db:migrate
pnpm db:seed                  # demo business "CleanCare Garment Services"
pnpm dev                      # API :4000 + web :3210
pnpm --filter @drycare/api worker   # (separate terminal) customer notifications
```

For real order-update and marketing emails, configure `RESEND_API_KEY` and `EMAIL_FROM` in the local `.env`. Platform administrators sign in separately at `/super-admin/login`; after their password, DryCare emails a single-use link that expires after 10 minutes. Configure a verified Resend sender before attempting admin sign-in, and set `WEB_ORIGIN` to the public web URL in hosted deployments. Create a dedicated platform-admin account with `pnpm admin:create`; store accounts are not accepted by the admin login. Marketing campaigns also require a long random `MARKETING_UNSUBSCRIBE_SECRET` for signed opt-out links. Restart the API and worker after changing these values. SMS and WhatsApp delivery still require their own provider integration; without one, those jobs are marked failed rather than reported as sent.

Open http://localhost:3210 and sign in. Demo accounts (password `DryCare@2026`):

| Email | Role |
|---|---|
| owner@cleancare.test | Owner — everything |
| manager@cleancare.test | Store manager |
| reception@cleancare.test | Reception / counter |
| qc@cleancare.test | Quality inspector |
| operator@cleancare.test | Cleaning operator |

Or create your own business at http://localhost:3210/signup.

## Tests

```bash
pnpm test     # unit tests: pricing, balances, workflow state machine
pnpm smoke    # 56 end-to-end acceptance checks (SRS §16) against the real database
pnpm backup-test   # backup → change → restore round trip in a throwaway database
```

## Daily workflow in the app

1. **New order** (`/pos`): find customer by mobile → pick service → tap garments → note stains/damage → advance payment → *Create order & print tags*.
2. **Print** garment tags (50×25 mm Code-128) and the 80 mm GST receipt.
3. **Scan station** (`/scan`): scan tag at each workstation (auto-advance mode), QC checklist pass/fail → rework, assign rack, mark ready.
4. **Production board** (`/production`) shows every garment by stage, overdue first.
5. **Order page**: collect balance (split cash/UPI), hand over ready garments (partial delivery supported), refunds, cancellation.
6. **Cashier** (`/cashier`): open/close shift with cash reconciliation. **Dashboard** & **Reports** for owners.

## Key design rules (from the SRS)

- Money is stored as integer paise; prices are snapshotted on every order and invoice.
- Tenant scope comes only from the server session — never from the request body.
- Every permission is checked in the API (`requirePermission`), not just hidden in the UI.
- Garment stages change only through validated transitions; QC and delivery have dedicated endpoints that record evidence.
- Payments are an append-only ledger; corrections are refunds. DB triggers block edits to audit logs, history and payment amounts.
- Order creation, payments and refunds accept an `Idempotency-Key` so retries never double-charge.
- State-changing requests require the `x-drycare-csrf: 1` header (CSRF protection alongside SameSite cookies).
