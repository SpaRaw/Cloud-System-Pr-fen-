import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { getPool } from "@kw/db";
import { euro, mailSenden, ticketPdf } from "@kw/core";
import { dateiSchreiben } from "./dateien";

// So hat der Shop vor dem Umzug gekauft: alles synchron in EINER Anfrage.
//   1. Kontingent lesen   2. buchen   3. PDF erzeugen   4. Mail senden
// Der Fehler steckt zwischen 1 und 2: Parallele Käufe lesen denselben Stand
// und schreiben danach jeweils „gelesen + n“ zurück (Lost Update). Es gibt keine Sperre
// und keinen Unique-Key. Genau so wurden am 3. März 312 Tickets doppelt verkauft.

const verzoegerung = Number(process.env.LEGACY_VERZOEGERUNG_MS ?? 250); // simulierte Zahlungsprüfung

export class AusverkauftFehler extends Error {}

export async function kaufen(eingabe: { eventId: string; anzahl: number; name: string; email: string }) {
  const pool = getPool();
  const { eventId, anzahl, name, email } = eingabe;
  if (!Number.isInteger(anzahl) || anzahl < 1 || anzahl > 4) throw new Error("Anzahl 1 bis 4");

  // 1. Kontingent lesen
  const [k] = await pool.query<RowDataPacket[]>(
    "SELECT k.gesamt, k.verkauft, e.preis_cent, e.name AS event_name, e.datum FROM kontingent k JOIN event e ON e.id = k.event_id WHERE k.event_id = ?",
    [eventId],
  );
  if (!k.length) throw new Error("Event unbekannt");
  const { gesamt, verkauft, preis_cent, event_name, datum } = k[0];
  if (verkauft + anzahl > gesamt) throw new AusverkauftFehler("Leider ausverkauft");

  await new Promise((r) => setTimeout(r, verzoegerung));

  // 2. buchen – mit dem veralteten Wert von oben
  await pool.query("UPDATE kontingent SET verkauft = ? WHERE event_id = ?", [verkauft + anzahl, eventId]);
  const bestellungId = randomUUID();
  await pool.query(
    "INSERT INTO bestellung (id, event_id, name, email, anzahl, summe_cent, status) VALUES (?, ?, ?, ?, ?, ?, 'bezahlt')",
    [bestellungId, eventId, name, email, anzahl, preis_cent * anzahl],
  );
  const tickets = [];
  for (let i = 0; i < anzahl; i++) {
    const id = randomUUID();
    const platzNr = verkauft + i + 1;
    await pool.query("INSERT INTO ticket (id, bestellung_id, event_id, platz_nr) VALUES (?, ?, ?, ?)", [id, bestellungId, eventId, platzNr]);
    tickets.push({ ticketId: id, platzNr, eventName: event_name, eventDatum: new Date(datum), preisCent: preis_cent, name, bestellungId });
  }

  // 3. PDF erzeugen und auf die lokale Platte legen
  const pdf = await ticketPdf(tickets);
  const pfad = await dateiSchreiben("tickets", `${bestellungId}.pdf`, pdf);
  await pool.query("UPDATE ticket SET pdf_pfad = ? WHERE bestellung_id = ?", [pfad, bestellungId]);

  // 4. Mail senden – schlägt sie fehl, ist das Geld weg und die Mail kommt nie (wie im März)
  await mailSenden({
    an: email,
    betreff: `Deine Tickets für ${event_name}`,
    text: `Hallo ${name},\n\nim Anhang deine ${anzahl} Ticket(s), je ${euro(preis_cent)}.\nBestellnummer: ${bestellungId}\n\n(Testsystem, erfundene Daten)`,
    anhang: { name: `tickets-${bestellungId}.pdf`, daten: pdf },
  });
  await pool.query("UPDATE bestellung SET status = 'versendet' WHERE id = ?", [bestellungId]);
  return { bestellungId, plaetze: tickets.map((t) => t.platzNr) };
}
