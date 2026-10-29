import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { env } from "../env";

export const sqlClient = postgres(env.DATABASE_URL, { max: 10, onnotice: () => {} });
export const db = drizzle(sqlClient, { schema });
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type DbOrTx = DB | Tx;
export { schema };
