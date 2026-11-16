import { and, eq, gte, lte } from "drizzle-orm";
import { getDb } from "./client";
import { event, kontingent, ticket } from "./schema";

export type EventMitKontingent = {
  id: string;
  name: string;
  beschreibung: string;
  bildUrl: string | null;
  datum: Date;
  preisCent: number;
  verkaufAb: Date;
  verkaufBis: Date;
  gesamt: number;
  verkauft: number;
};

const auswahl = {
  id: event.id,
  name: event.name,
  beschreibung: event.beschreibung,
  bildUrl: event.bildUrl,
  datum: event.datum,
  preisCent: event.preisCent,
  verkaufAb: event.verkaufAb,
  verkaufBis: event.verkaufBis,
  gesamt: kontingent.gesamt,
  verkauft: kontingent.verkauft,
};

export async function ladeEvents(): Promise<EventMitKontingent[]> {
  return getDb().select(auswahl).from(event).innerJoin(kontingent, eq(kontingent.eventId, event.id)).orderBy(event.datum);
}

export async function ladeEvent(id: string): Promise<EventMitKontingent | undefined> {
  const rows = await getDb()
    .select(auswahl)
    .from(event)
    .innerJoin(kontingent, eq(kontingent.eventId, event.id))
    .where(eq(event.id, id));
  return rows[0];
}

export async function eventsImVerkauf(jetzt = new Date()): Promise<EventMitKontingent[]> {
  return getDb()
    .select(auswahl)
    .from(event)
    .innerJoin(kontingent, eq(kontingent.eventId, event.id))
    .where(and(lte(event.verkaufAb, jetzt), gte(event.verkaufBis, jetzt)));
}

export async function verkauftePlaetze(eventId: string): Promise<number[]> {
  const rows = await getDb()
    .select({ platzNr: ticket.platzNr })
    .from(ticket)
    .where(eq(ticket.eventId, eventId));
  return rows.map((r) => r.platzNr);
}

