/**
 * Logical backup / restore for the standalone desktop edition (SRS §17.5).
 *
 * Format (.dcbak, gzip): a header line, a JSON manifest line, then for every table
 *   "--TABLE <name> <col,col,...>" + one row per line + "\." terminator.
 *   v2 (current): each row is `row_to_json` text — always starts with "{" and never contains a raw newline.
 *   v1 (still restored): Postgres COPY text rows; COPY escapes backslashes, so no row equals "\.".
 * v2 reads and writes with ordinary queries. The COPY stream API was dropped because under newer
 * Node.js a second COPY in the same transaction could stall forever (the daily backup never finished).
 * Uses only SQL (no pg_dump), so it works with the embedded database on any PC.
 */
import { gunzipSync, gzipSync } from "node:zlib";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Sql } from "postgres";

const MAGIC = "DRYCARE-BACKUP v2";
const MAGIC_V1 = "DRYCARE-BACKUP v1";
/** Rows per INSERT when restoring a v2 backup. */
const RESTORE_CHUNK = 500;
/** Sessions are never backed up: a restore always forces everyone to sign in again. */
const EXCLUDED = new Set(["sessions"]);

async function listTables(sql: Sql) {
  const rows = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`;
  return rows.map((r) => r.table_name);
}

async function listColumns(sql: Sql, table: string) {
  const rows = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table} order by ordinal_position`;
  return rows.map((r) => r.column_name);
}

export interface BackupInfo {
  file: string;
  name: string;
  sizeBytes: number;
  createdAt: string;
  rows: number;
  kind: "auto" | "manual";
}

export async function createBackup(sql: Sql, dir: string, opts: { appVersion: string; kind?: "auto" | "manual" }): Promise<BackupInfo> {
  await mkdir(dir, { recursive: true });
  const tables = (await listTables(sql)).filter((t) => !EXCLUDED.has(t));
  const parts: Buffer[] = [];
  let rows = 0;
  // One repeatable-read snapshot so all tables are mutually consistent.
  await sql.begin("isolation level repeatable read read only", async (tx) => {
    for (const table of tables) {
      const cols = await listColumns(tx as unknown as Sql, table);
      const data = await tx.unsafe<{ j: string }[]>(`select row_to_json(t)::text as j from "${table}" t`);
      rows += data.length;
      parts.push(Buffer.from(`--TABLE ${table} ${cols.join(",")}\n${data.map((r) => `${r.j}\n`).join("")}\\.\n`));
    }
  });
  const createdAt = new Date();
  const manifest = { createdAt: createdAt.toISOString(), appVersion: opts.appVersion, tables, rows };
  const body = gzipSync(Buffer.concat([Buffer.from(`${MAGIC}\n${JSON.stringify(manifest)}\n`), ...parts]));
  const kind = opts.kind ?? "manual";
  const stamp = createdAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const name = `drycare-${kind}-${stamp}.dcbak`;
  const file = path.join(dir, name);
  await writeFile(file, body);
  return { file, name, sizeBytes: body.length, createdAt: manifest.createdAt, rows, kind };
}

export async function listBackups(dir: string): Promise<BackupInfo[]> {
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".dcbak"));
  } catch {
    return [];
  }
  const out: BackupInfo[] = [];
  for (const name of names) {
    const s = await stat(path.join(dir, name));
    out.push({ file: path.join(dir, name), name, sizeBytes: s.size, createdAt: s.mtime.toISOString(), rows: -1, kind: name.includes("-auto-") ? "auto" : "manual" });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Keeps the newest `keep` automatic backups; manual backups are never deleted automatically. */
export async function pruneAutoBackups(dir: string, keep = 30) {
  const autos = (await listBackups(dir)).filter((b) => b.kind === "auto");
  for (const b of autos.slice(keep)) await rm(b.file, { force: true });
}

export async function readBackupManifest(file: string) {
  const text = gunzipSync(await readFile(file)).toString("utf8");
  const [magic, manifest] = text.split("\n", 2);
  if (magic !== MAGIC && magic !== MAGIC_V1) throw new Error("This file is not a DryCare backup");
  return JSON.parse(manifest) as { createdAt: string; appVersion: string; tables: string[]; rows: number };
}

/**
 * Replaces ALL data with the backup's contents in a single transaction: either everything is
 * restored or nothing changes. The caller must run migrations first so the schema is current;
 * columns added since the backup was taken get their defaults.
 */
export async function restoreBackup(sql: Sql, file: string) {
  const text = gunzipSync(await readFile(file)).toString("utf8");
  const lines = text.split("\n");
  if (lines[0] !== MAGIC && lines[0] !== MAGIC_V1) throw new Error("This file is not a DryCare backup");
  const v1 = lines[0] === MAGIC_V1;
  const manifest = JSON.parse(lines[1]);
  const sections: { table: string; cols: string[]; rows: string[] }[] = [];
  let i = 2;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) {
      i++;
      continue;
    }
    const m = /^--TABLE (\S+) (.+)$/.exec(line);
    if (!m) throw new Error(`Backup file is damaged near line ${i + 1}`);
    const start = ++i;
    while (i < lines.length && lines[i] !== "\\.") i++;
    if (i >= lines.length) throw new Error(`Backup file is truncated in table ${m[1]}`);
    sections.push({ table: m[1], cols: m[2].split(","), rows: lines.slice(start, i) });
    i++;
  }

  const current = new Set(await listTables(sql));
  for (const s of sections) {
    if (!current.has(s.table)) throw new Error(`Backup contains unknown table "${s.table}" — it was made by a newer DryCare version`);
    const cols = new Set(await listColumns(sql, s.table));
    const missing = s.cols.filter((c) => !cols.has(c));
    if (missing.length) throw new Error(`Backup has columns not in this version (${s.table}.${missing[0]}) — update DryCare first`);
  }

  await sql.begin(async (tx) => {
    // Bypass FK and append-only triggers while reloading; the data is restored as a consistent set.
    await tx.unsafe("set local session_replication_role = replica");
    const all = [...current].filter((t) => t !== "__drizzle_migrations");
    await tx.unsafe(`truncate ${all.map((t) => `"${t}"`).join(", ")} cascade`);
    for (const s of sections) {
      if (!s.rows.length) continue;
      const colList = s.cols.map((c) => `"${c}"`).join(",");
      if (!v1) {
        for (let k = 0; k < s.rows.length; k += RESTORE_CHUNK) {
          const chunk = `[${s.rows.slice(k, k + RESTORE_CHUNK).join(",")}]`;
          await tx.unsafe(`insert into "${s.table}" (${colList}) select ${colList} from json_populate_recordset(null::"${s.table}", $1::json)`, [chunk]);
        }
        continue;
      }
      // v1 backups (DryCare ≤ 0.1.6) hold COPY text, which only COPY can load.
      const writable = await tx.unsafe(`copy "${s.table}" (${colList}) from stdin`).writable();
      await new Promise<void>((resolve, reject) => {
        writable.on("error", reject);
        writable.on("finish", resolve);
        writable.end(s.rows.map((l) => `${l}\n`).join(""));
      });
    }
  });
  return manifest as { createdAt: string; appVersion: string; rows: number };
}
