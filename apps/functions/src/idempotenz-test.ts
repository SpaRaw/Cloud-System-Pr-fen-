// Nachweis 6: Dieselbe Bestellnachricht zweimal einspielen – es entsteht genau ein Ticket.
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { bestaetigen, bestellen, inQueueLegen, reservieren } from "@kw/core";
import { getPool } from "@kw/db";

export async function idempotenzTest(eventId: string, log: (m: string) => void = console.log) {
  // 1. Echter Kauf bis zur Bestätigung (Redis 0 -> 1 -> 2 -> 3), aber noch NICHT in die Queue.
  const sid = randomUUID();
  const r = await reservieren(eventId, sid, 1);
  if (r.zustand !== "reserviert") throw new Error(`Reservierung nicht möglich: ${r.zustand}`);
  await bestellen(eventId, sid, "Ida Idempotent", "ida@example.test");
  const { nachricht } = await bestaetigen(eventId, sid);
  if (!nachricht) throw new Error("Bestätigung fehlgeschlagen");
  log(`Bestellung ${nachricht.bestellungId}, Platz ${nachricht.plaetze.join(", ")}`);

  // 2. Dieselbe Nachricht zweimal in die Queue.
  await inQueueLegen(nachricht);
  await inQueueLegen(nachricht);
  log("Nachricht 2× in die Queue gelegt, warte auf die Function …");

  // 3. Zählen, bis verarbeitet (max. 30 s).
  let zeile: RowDataPacket = {} as RowDataPacket;
  for (let i = 0; i < 30; i++) {
    await new Promise((res) => setTimeout(res, 1000));
    const [rows] = await getPool().query<RowDataPacket[]>(
      "SELECT (SELECT COUNT(*) FROM bestellung WHERE id = ?) AS bestellungen, (SELECT COUNT(*) FROM ticket WHERE bestellung_id = ?) AS tickets, (SELECT status FROM bestellung WHERE id = ?) AS status",
      [nachricht.bestellungId, nachricht.bestellungId, nachricht.bestellungId],
    );
    zeile = rows[0];
    if (zeile.status === "versendet" && i >= 5) break;
  }
  const ergebnis = {
    bestellungId: nachricht.bestellungId,
    nachrichtenEingespielt: 2,
    bestellungen: Number(zeile.bestellungen),
    tickets: Number(zeile.tickets),
    status: zeile.status,
    ok: Number(zeile.tickets) === 1,
  };
  log(ergebnis.ok ? "✔ Genau ein Ticket trotz doppelter Nachricht" : `✘ ${ergebnis.tickets} Tickets`);
  return ergebnis;
}
