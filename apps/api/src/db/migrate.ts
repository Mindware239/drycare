import { fileURLToPath } from "node:url";
import { db, sqlClient } from "./client";
import { runMigrations } from "./migrate-lib";

await runMigrations(db, fileURLToPath(new URL("../../drizzle", import.meta.url)));
console.log("Migrations applied");
await sqlClient.end();
