import mysql from "mysql2/promise";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "./schema";

// Verbindung kommt immer aus der Umgebung (lokal .env, in Azure Container-Apps-Secret).
// DATABASE_URL=mysql://user:pass@host:3306/klangwerk  · Azure: ?ssl=true wird erkannt.

let pool: mysql.Pool | undefined;
let db: MySql2Database<typeof schema> | undefined;

export function getPool(): mysql.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL fehlt");
    const parsed = new URL(url);
    const ssl = parsed.searchParams.get("ssl") === "true";
    parsed.searchParams.delete("ssl");
    pool = mysql.createPool({
      uri: parsed.toString(),
      connectionLimit: Number(process.env.DB_POOL ?? 10),
      timezone: "Z",
      dateStrings: false,
      ...(ssl ? { ssl: { rejectUnauthorized: true } } : {}),
    });
  }
  return pool;
}

export function getDb(): MySql2Database<typeof schema> {
  if (!db) db = drizzle(getPool(), { schema, mode: "default" });
  return db;
}

export async function closeDb() {
  await pool?.end();
  pool = undefined;
  db = undefined;
}
