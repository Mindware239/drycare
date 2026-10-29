import { buildServer } from "./app";
import { env, isDesktop } from "./env";
import { db } from "./db/client";
import { setCapture } from "./sync/queue";
import { productionConfigProblems } from "./lib/productionChecks";

const config = productionConfigProblems();
for (const w of config.warnings) console.warn(`Configuration warning: ${w}`);
if (config.errors.length) {
  console.error(["DryCare will not start with an unsafe production configuration:", ...config.errors.map((e) => `- ${e}`)].join("\n"));
  process.exit(1);
}

try {
  await setCapture(db, (env.SYNC_CAPTURE ?? (isDesktop ? "on" : "off")) === "on");
} catch (err) {
  // Code deployed before its migrations: keep serving, but say how to fix it.
  if ((err as { code?: string }).code !== "42P01" && (err as { cause?: { code?: string } }).cause?.code !== "42P01") throw err;
  console.warn("Sync tables are missing — run `pnpm db:migrate`. Change capture stays off until then.");
}
const app = await buildServer();
await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
console.log(`DryCare API listening on http://localhost:${env.API_PORT}`);
