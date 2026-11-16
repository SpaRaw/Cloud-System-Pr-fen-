import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { getPool } from "@kw/db";
import { getRedis, outboxQuittieren, type BestellNachricht } from "./kauf";
import { ticketPdf } from "./pdf";
import { mailSenden } from "./mail";
import { blobHochladen, CONTAINER_TICKETS } from "./storage";
import { euro } from "./format";

export type Ergebnis = "neu" | "schon_vorhanden" | "schon_versendet" | "konflikt" | "in_arbeit";

/**
 * Verarbeitet eine Bestellnachricht aus der Queue. Idempotent:
 * Die Bestell-ID ist der Primärschlüssel, kommt dieselbe Nachricht zweimal, entsteht genau ein Ticket.
 *
 * Absturz-Szenarien (Prüfungsfrage „stürzt nach dem Speichern, vor dem Bestätigen ab“):
 *  - nach dem Commit, vor dem PDF: Nachricht kommt wieder, Insert wird übersprungen, PDF + Mail folgen.
 *  - nach der Mail, vor dem Status-Update: Nachricht kommt wieder, Mail geht ein zweites Mal raus
 *    (at-least-once). Ein zweites Ticket entsteht nie.
 */
export async function verarbeiteBestellung(n: BestellNachricht, log: (m: string) => void = console.log): Promise<Ergebnis> {
  const pool = getPool();
  let ergebnis: Ergebnis = "neu";

  // Kein SELECT … FOR UPDATE vorab: Bei zwei gleichzeitigen Zustellungen würden Gap-Locks zum Deadlock führen.
  // Stattdessen direkt einfügen. Die zweite Zustellung wartet auf die Sperre des Primärschlüssels und
  // bekommt danach ER_DUP_ENTRY auf PRIMARY.
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [ev] = await conn.query<RowDataPacket[]>("SELECT preis_cent FROM event WHERE id = ?", [n.eventId]);
    if (!ev.length) throw new Error(`Event ${n.eventId} unbekannt`);
    const preis = Number(ev[0].preis_cent);
    await conn.query(
      "INSERT INTO bestellung (id, event_id, name, email, anzahl, summe_cent, status) VALUES (?, ?, ?, ?, ?, ?, 'bezahlt')",
      [n.bestellungId, n.eventId, n.name, n.email, n.plaetze.length, preis * n.plaetze.length],
    );
    for (const platz of n.plaetze) {
      await conn.query("INSERT INTO ticket (id, bestellung_id, event_id, platz_nr) VALUES (?, ?, ?, ?)", [
        randomUUID(), n.bestellungId, n.eventId, platz,
      ]);
    }
    await conn.query("UPDATE kontingent SET verkauft = verkauft + ? WHERE event_id = ?", [n.plaetze.length, n.eventId]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    const err = e as { sqlMessage?: string; code?: string };
    const msg = err.sqlMessage ?? "";
    if (err.code === "ER_DUP_ENTRY" && msg.includes("PRIMARY")) {
      // Diese Bestellung gibt es schon: zweite Zustellung derselben Nachricht.
      const [vorhanden] = await pool.query<RowDataPacket[]>("SELECT status FROM bestellung WHERE id = ?", [n.bestellungId]);
      const st = vorhanden[0]?.status;
      ergebnis = st === "versendet" ? "schon_versendet" : st === "konflikt" ? "konflikt" : "schon_vorhanden";
    } else if (err.code === "ER_DUP_ENTRY" && msg.includes("uq_ticket_platz")) {
      // Zweite Sicherung hat gegriffen: Platz ist in MySQL schon vergeben (z. B. nach Redis-Neustart).
      await pool.query(
        "INSERT IGNORE INTO bestellung (id, event_id, name, email, anzahl, summe_cent, status) VALUES (?, ?, ?, ?, ?, 0, 'konflikt')",
        [n.bestellungId, n.eventId, n.name, n.email, n.plaetze.length],
      );
      log(`KONFLIKT: Bestellung ${n.bestellungId} – Platz schon vergeben, kein Ticket ausgestellt`);
      await outboxQuittieren(n.eventId, n.bestellungId);
      return "konflikt";
    } else throw e;
  } finally {
    conn.release();
  }

  if (ergebnis === "schon_versendet" || ergebnis === "konflikt") {
    await outboxQuittieren(n.eventId, n.bestellungId);
    log(`Bestellung ${n.bestellungId}: ${ergebnis}, nichts zu tun`);
    return ergebnis;
  }

  // Läuft dieselbe Bestellung gerade parallel (zweite Zustellung), übernimmt der erste Durchlauf PDF und Mail.
  // Stürzt der erste ab, kommt SEINE Nachricht nach dem Visibility-Timeout zurück – es geht also nichts verloren.
  const sperre = await getRedis().set(`kw:verarbeitung:${n.bestellungId}`, "1", "PX", 120_000, "NX");
  if (!sperre) {
    log(`Bestellung ${n.bestellungId}: wird parallel verarbeitet, diese Zustellung endet hier`);
    return "in_arbeit";
  }

  // PDF erzeugen, in Blob Storage ablegen, Mail senden.
  const [zeilen] = await pool.query<RowDataPacket[]>(
    `SELECT t.id, t.platz_nr, e.name AS event_name, e.datum, e.preis_cent, b.name, b.email
       FROM ticket t JOIN bestellung b ON b.id = t.bestellung_id JOIN event e ON e.id = t.event_id
      WHERE t.bestellung_id = ? ORDER BY t.platz_nr`,
    [n.bestellungId],
  );
  const pdf = await ticketPdf(
    zeilen.map((z) => ({
      ticketId: z.id,
      platzNr: z.platz_nr,
      eventName: z.event_name,
      eventDatum: new Date(z.datum),
      preisCent: z.preis_cent,
      name: z.name,
      bestellungId: n.bestellungId,
    })),
  );
  const pfad = `${n.eventId}/${n.bestellungId}.pdf`;
  await blobHochladen(CONTAINER_TICKETS, pfad, pdf, "application/pdf");
  await pool.query("UPDATE ticket SET pdf_pfad = ? WHERE bestellung_id = ?", [pfad, n.bestellungId]);

  const erste = zeilen[0];
  await mailSenden({
    an: erste.email,
    betreff: `Deine Tickets für ${erste.event_name}`,
    text:
      `Hallo ${erste.name},\n\nvielen Dank für deine Bestellung. Im Anhang findest du ${zeilen.length} Ticket(s) ` +
      `(Plätze ${zeilen.map((z) => z.platz_nr).join(", ")}, je ${euro(erste.preis_cent)}).\n\n` +
      `Bestellnummer: ${n.bestellungId}\n\nDein KlangWerk-Team\n(Testsystem, erfundene Daten)`,
    anhang: { name: `tickets-${n.bestellungId}.pdf`, daten: pdf },
  });
  await pool.query("UPDATE bestellung SET status = 'versendet' WHERE id = ?", [n.bestellungId]);
  await outboxQuittieren(n.eventId, n.bestellungId);
  await getRedis().del(`kw:verarbeitung:${n.bestellungId}`);
  log(`Bestellung ${n.bestellungId}: ${zeilen.length} Ticket(s) erstellt und versendet (${ergebnis})`);
  return ergebnis;
}
