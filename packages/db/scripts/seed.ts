// Erfundene Testdaten: ein Festival mit 500 Tickets (Pflicht) plus zwei weitere.
//   pnpm db:seed
import { randomUUID } from "node:crypto";
import { verbinde } from "./verbindung";

const events = [
  { name: "Sommerklang Festival", beschreibung: "Drei Tage elektronische und Indie-Musik am See. Alle Bands sind erfunden.", preis: 8900, kontingent: 500, tage: 120 },
  { name: "Herbstrauschen", beschreibung: "Akustik-Wochenende im alten Kurpark mit erfundenen Singer-Songwritern.", preis: 4900, kontingent: 200, tage: 200 },
  { name: "Winterlicht Open Air", beschreibung: "Ein Abend mit Lichtinstallationen und Live-Sets im Schnee.", preis: 3900, kontingent: 100, tage: 300 },
];

const conn = await verbinde();
const [spalten] = await conn.query("SHOW COLUMNS FROM event LIKE 'verkauf_ab'");
const hatVerkauf = (spalten as unknown[]).length > 0;

const [vorhanden] = await conn.query("SELECT COUNT(*) AS n FROM event");
if ((vorhanden as { n: number }[])[0].n > 0 && !process.argv.includes("--force")) {
  console.log("Es gibt schon Events, Seed übersprungen (--force zum Erzwingen).");
  await conn.end();
  process.exit(0);
}

const jetzt = new Date();
for (const e of events) {
  const id = randomUUID();
  const datum = new Date(jetzt.getTime() + e.tage * 86_400_000);
  if (hatVerkauf) {
    await conn.query(
      "INSERT INTO event (id, name, beschreibung, datum, preis_cent, verkauf_ab, verkauf_bis) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, e.name, e.beschreibung, datum, e.preis, jetzt, datum],
    );
  } else {
    await conn.query("INSERT INTO event (id, name, beschreibung, datum, preis_cent) VALUES (?, ?, ?, ?, ?)", [
      id, e.name, e.beschreibung, datum, e.preis,
    ]);
  }
  await conn.query("INSERT INTO kontingent (id, event_id, gesamt, verkauft) VALUES (?, ?, ?, 0)", [randomUUID(), id, e.kontingent]);
  console.log(`+ ${e.name} (${e.kontingent} Tickets) ${id}`);
}
await conn.end();
