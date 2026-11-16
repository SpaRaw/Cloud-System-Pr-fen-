// Prüft nach dem Lasttest: verkauft ≤ Kontingent, keine doppelten Plätze, keine Bestellung verloren.
import { verbinde } from "./verbindung";

const eventId = process.env.EVENT_ID!;
const bestaetigt = Number(process.env.BESTAETIGT ?? 0);
const conn = await verbinde();
const [[k]] = (await conn.query("SELECT gesamt, verkauft FROM kontingent WHERE event_id = ?", [eventId])) as unknown as [{ gesamt: number; verkauft: number }[]];
const [[t]] = (await conn.query("SELECT COUNT(*) AS n, COUNT(DISTINCT platz_nr) AS d FROM ticket WHERE event_id = ?", [eventId])) as unknown as [{ n: number; d: number }[]];
const [[b]] = (await conn.query("SELECT COUNT(*) AS n, SUM(status='versendet') AS v FROM bestellung WHERE event_id = ?", [eventId])) as unknown as [{ n: number; v: number }[]];
await conn.end();

const n = Number(t.n), doppelt = n - Number(t.d);
console.log(`Kontingent            ${k.gesamt}`);
console.log(`Tickets in MySQL      ${n}  (Zähler in kontingent: ${k.verkauft})`);
console.log(`Bestellungen          ${b.n}  davon versendet: ${b.v ?? 0}`);
console.log(`Doppelte Plätze       ${doppelt}`);
console.log(`Bestätigt laut k6     ${bestaetigt}`);
console.log();
console.log(n <= k.gesamt && doppelt === 0 ? "✔ verkauft ≤ Kontingent, kein Platz doppelt" : `✘ ÜBERVERKAUFT um ${n - k.gesamt}, ${doppelt} Plätze doppelt`);
console.log(bestaetigt === n ? "✔ keine Bestellung verloren (k6 = MySQL)" : `✘ Abweichung k6 ${bestaetigt} vs. MySQL ${n}`);
