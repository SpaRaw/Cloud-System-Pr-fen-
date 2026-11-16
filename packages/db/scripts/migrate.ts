// Wendet die SQL-Dateien aus sql/ der Reihe nach an und merkt sich den Stand in schema_version.
//   pnpm db:migrate              -> alle (Zielsystem)
//   pnpm db:migrate -- --bis 001 -> nur bis 001 (Altsystem)
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verbinde } from "./verbindung";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "sql");
const bisIdx = process.argv.indexOf("--bis");
const bis = bisIdx > -1 ? process.argv[bisIdx + 1] : undefined;

const conn = await verbinde();
await conn.query(
  "CREATE TABLE IF NOT EXISTS schema_version (version VARCHAR(10) PRIMARY KEY, angewendet_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)",
);
const [rows] = await conn.query("SELECT version FROM schema_version");
const vorhanden = new Set((rows as { version: string }[]).map((r) => r.version));

const dateien = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
for (const datei of dateien) {
  const version = datei.slice(0, 3);
  if (bis && version > bis) break;
  if (vorhanden.has(version)) {
    console.log(`= ${datei} (schon angewendet)`);
    continue;
  }
  const sqlText = await readFile(join(dir, datei), "utf8");
  await conn.query(sqlText);
  await conn.query("INSERT INTO schema_version (version) VALUES (?)", [version]);
  console.log(`+ ${datei}`);
}
await conn.end();
