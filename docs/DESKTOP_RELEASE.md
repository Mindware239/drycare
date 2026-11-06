# Drycare for Windows: releases, updates and code signing

## How a change reaches a PC

The screens and server are packed into the installer. A website change reaches a PC only through a new version.

1. Raise `version` in `apps/desktop/package.json`.
2. Build, with the address of the cloud server: `DRYCARE_CLOUD_URL=https://your-server pnpm --filter @drycare/desktop dist`.
3. In Super admin > Software releases, **Add new version** (it starts as a draft), open **Details**, and upload `release/DryCare-Setup-<version>.exe`. The server records its SHA-256 and SHA-512 and checks its signature. A file with a bad signature is refused and not saved. Once released, a version's file can never be replaced: raise the version instead.
4. Use the status dropdown:
   - **Testing**: only PCs in the beta testing group get it.
   - **Staged**: starts at the first stage (10% by default). **Go to 25%** widens it. The same PC always stays in, so widening only adds PCs.
   - **Published**: every eligible PC.
   - **Paused**: no more PCs get it, and download links already handed out stop working. Resuming carries on at the same share.
   - **Withdrawn**: permanent. Add a new version instead.
5. A rollout pauses itself when failures reach its limit (by default 20%, once 3 PCs have failed). **Emergency stop** pauses everything at once.

Stable PCs only get stable releases; beta also gets beta; preview gets everything. Set this per PC on the PCs tab.

### Unsigned installers

A file that is not code-signed cannot be staged or published until the owner ticks that they accept it. It stays labelled **Not signed**. Windows warns the person who runs it. PCs still check it against the signed manifest, so a changed file is refused. Set `DRYCARE_REQUIRE_SIGNED=true` (below) once a certificate is in use, and PCs refuse anything unsigned.

### Where installers are kept

On the server's disk, in `RELEASE_DIR` (default `.local/releases`), never in the database. Keep this folder on backed-up storage, because a rollback needs the earlier installers. Object storage is not connected yet.

## What a PC does

It checks at start and every six hours, using its signed license key. A PC with no key does not get automatic updates; it updates by running a newer installer by hand. A PC offline just keeps working, and gets what it should when it reconnects.

1. Sends its key and a one-time code to `POST /updates/check`. The answer is signed with the licensing key and repeats the code, so an old answer cannot be replayed. Suspended licenses and removed PCs are offered nothing.
2. Refuses any version older than its own, unless the signed answer says the owner started a rollback.
3. Asks before downloading, unless it is mandatory (no Later button) or automatic. Automatic updates install only inside the maintenance window and after 10 minutes with no work on the PC, so they do not interrupt billing or printing. Past a deadline, it asks with only **Install now**.
4. Downloads through a link for that PC and version, which expires in 6 hours. Then checks SHA-256 against the signed answer. A mismatch stops the update.
5. If a code-signing requirement is set, checks the Authenticode signature (below).
6. Backs up the shop's data. If that fails, nothing is installed.
7. Copies the program folder aside and starts a watchdog, then installs.
8. The new version reports healthy once its server has started and answered. Only then is the update marked successful.
9. If it is not healthy in time, the watchdog restores the program folder and starts the old version, which reports the rollback.

Reports carry the PC's key, so nobody else can post failures to pause a rollout. Updates download the whole installer (about 150 MB); a failed download starts again at the next check.

### Rolling back

On the Rollback tab, choose the faulty version and an earlier one, for all PCs on it or for chosen installation IDs. Each is sent back at its next check-in, and progress shows on the same tab. Only the program goes back; see Database below. Starting a rollback does not pause the faulty release, so pause or withdraw that too.

Roles: release management needs the platform admin role. There is only one such role today, so anyone who is a platform admin can do all of it.

### Database

The database is never rolled back automatically. **Migrations must stay backward compatible: add columns and tables with defaults; do not rename, drop or change the meaning of anything in the same release.** An older version then keeps working on a newer database. The backup from step 5 is for a person to restore if needed.

## Code signing (not yet active)

Nothing is code-signed until a real certificate is configured. Windows shows an "unknown publisher" warning until then. The signed manifest above protects updates in the meantime, but does not remove that warning.

To activate, with a certificate from a certificate authority (an EV certificate clears SmartScreen warnings fastest):

1. Set `CSC_LINK` (path or base64 of the .pfx) and `CSC_KEY_PASSWORD` when building. electron-builder then signs the installer, the app and the uninstaller. For a hardware token, configure `win.signtoolOptions` for your provider instead.
2. Set `DRYCARE_REQUIRE_SIGNED=true` and `DRYCARE_SIGNING_PUBLISHER` to the certificate's exact subject name when building. PCs then refuse any update not signed by that publisher.
3. Check the result: `pwsh scripts/verify-signature.ps1 apps/desktop/release/DryCare-Setup-<version>.exe`.

Only turn on `DRYCARE_REQUIRE_SIGNED` in a version built with the certificate, so that each PC already trusts the publisher before it is required.

## Adding a feature that controls something

Features added on the Features & permissions page are **listed only**: they appear on plans and the pricing page, and they open or lock nothing. They can never bypass server rules, since they have none. To make a real one:

1. Add a key to `DEFS` in `packages/shared/src/features.ts`, with `dependsOn` if it cannot work without another. Keys are stored in plans and signed licenses, so never rename one.
2. Add its routes to `FEATURE_ROUTES` in `apps/api/src/lib/entitlements.ts`, or call `requireFeature()` where one action needs it. The server check is the security; hiding a menu item is not.
3. Add `feature: "yourKey"` to its menu item in `apps/web/src/app/(app)/layout.tsx`, and to `APP_MODULES` in `features.ts`. `pnpm feature-access-test` fails if a menu screen is missing from `APP_MODULES`.
4. Run `pnpm i18n:extract` and translate the new wording.

## Remote licensing

A PC checks in with its signed key at start and every six hours (`apps/api/src/lib/licenseSync.ts`, `apps/api/src/modules/licenseServer.ts`). Replies are signed and answer a one-time code, so they cannot be forged or replayed.

- Suspending, revoking, removing a PC and changing features all apply **at that PC's next successful check-in. A PC that stays offline cannot receive them.** Set an offline period on a license if it must not run unconnected for long.
- A key's expiry applies with or without internet, and being offline never extends it. Past expiry a shop can read its records (or see only the renewal screen, if the license says locked). Data is never deleted.
- A PC with full local control can always interfere with local files. Deleting the local status file clears a stop until the next check-in. The signed key itself cannot be forged, and an offline period limits how long this can last.
