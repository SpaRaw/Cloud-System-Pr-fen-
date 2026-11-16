// Zählabfrage für Nachweis 2 (Migration) und Nachweis 5 (Lasttest).
//   pnpm --filter @kw/db zaehlen
import { verbinde } from "./verbindung";

const conn = await verbinde();
const tabellen = ["event", "kontingent", "bestellung", "ticket"];
console.log("Zeilen je Tabelle");
for (const t of tabellen) {
  const [r] = await conn.query(`SELECT COUNT(*) AS n FROM ${t}`);
  console.log(`  ${t.padEnd(12)} ${(r as { n: number }[])[0].n}`);
}

const [proEvent] = await conn.query(`
  SELECT e.name, k.gesamt, k.verkauft AS zaehler,
         (SELECT COUNT(*) FROM ticket t WHERE t.event_id = e.id) AS tickets,
         (SELECT COUNT(*) FROM (SELECT platz_nr FROM ticket t WHERE t.event_id = e.id GROUP BY platz_nr HAVING COUNT(*) > 1) d) AS doppelte_plaetze
  FROM event e JOIN kontingent k ON k.event_id = e.id ORDER BY e.datum`);
console.log("\nJe Event");
for (const r of proEvent as { name: string; gesamt: number; zaehler: number; tickets: number; doppelte_plaetze: number }[]) {
  const ueber = Math.max(0, Number(r.tickets) - r.gesamt);
  console.log(
    `  ${r.name.padEnd(24)} Kontingent ${r.gesamt}  Tickets ${r.tickets}  Zähler ${r.zaehler}  doppelte Plätze ${r.doppelte_plaetze}  ` +
      (ueber > 0 || Number(r.doppelte_plaetze) > 0 ? `ÜBERVERKAUFT (+${ueber})` : "ok"),
  );
}
await conn.end();
