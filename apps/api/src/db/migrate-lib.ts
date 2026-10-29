import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { SYSTEM_ROLES } from "@drycare/shared";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { DB } from "./client";
import { setSchemaVersion } from "../sync/queue";

/**
 * Applies schema migrations, then re-syncs the built-in role definitions so permission changes
 * shipped in a new version reach existing businesses. Custom roles (is_system = false) are untouched.
 */
export async function runMigrations(db: DB, migrationsFolder: string) {
  await migrate(db, { migrationsFolder });
  for (const role of SYSTEM_ROLES) {
    await db.execute(sql`update roles set permissions = ${`{${role.permissions.join(",")}}`}::text[], name = ${role.name} where key = ${role.key} and is_system = true`);
  }
  // Sync events carry the schema version so the cloud can refuse changes from a newer DryCare.
  const journal = JSON.parse(readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
  await setSchemaVersion(db, journal.entries.at(-1)?.tag ?? "unknown");
}

/** Applies migration files only (no role sync or schema-version bookkeeping). Used by upgrade tests. */
export const applyMigrationFiles = (db: DB, migrationsFolder: string) => migrate(db, { migrationsFolder });
