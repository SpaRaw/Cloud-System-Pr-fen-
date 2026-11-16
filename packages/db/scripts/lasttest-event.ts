// Legt ein frisches Event für den Lasttest an und gibt die ID aus.
//   pnpm --filter @kw/db lasttest-event -- 500
import { randomUUID } from "node:crypto";
import { verbinde } from "./verbindung";

const kontingent = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 500);
const conn = await verbinde();
const [spalten] = await conn.query("SHOW COLUMNS FROM event LIKE 'verkauf_ab'");
const id = randomUUID();
const jetzt = new Date();
const datum = new Date(jetzt.getTime() + 90 * 86_400_000);
const name = `Lasttest ${jetzt.toISOString().slice(0, 16).replace("T", " ")}`;
if ((spalten as unknown[]).length)
  await conn.query("INSERT INTO event (id, name, beschreibung, datum, preis_cent, verkauf_ab, verkauf_bis) VALUES (?, ?, 'Lasttest', ?, 1000, ?, ?)", [id, name, datum, jetzt, datum]);
else await conn.query("INSERT INTO event (id, name, beschreibung, datum, preis_cent) VALUES (?, ?, 'Lasttest', ?, 1000)", [id, name, datum]);
await conn.query("INSERT INTO kontingent (id, event_id, gesamt, verkauft) VALUES (?, ?, ?, 0)", [randomUUID(), id, kontingent]);
await conn.end();
console.log(id);
