import { datetime, int, mysqlTable, text, uniqueIndex, varchar, char, index } from "drizzle-orm/mysql-core";

// Zielschema = Altschema (sql/001_altsystem.sql) + Erweiterung (sql/002_azure.sql).

export const event = mysqlTable("event", {
  id: char("id", { length: 36 }).primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  beschreibung: text("beschreibung").notNull(),
  bildUrl: varchar("bild_url", { length: 500 }),
  datum: datetime("datum").notNull(),
  preisCent: int("preis_cent").notNull(),
  erstelltAm: datetime("erstellt_am").notNull(),
  verkaufAb: datetime("verkauf_ab").notNull(),
  verkaufBis: datetime("verkauf_bis").notNull(),
});

export const kontingent = mysqlTable(
  "kontingent",
  {
    id: char("id", { length: 36 }).primaryKey(),
    eventId: char("event_id", { length: 36 }).notNull(),
    gesamt: int("gesamt").notNull(),
    verkauft: int("verkauft").notNull(),
  },
  (t) => [uniqueIndex("uq_kontingent_event").on(t.eventId)],
);

export const bestellung = mysqlTable("bestellung", {
  id: char("id", { length: 36 }).primaryKey(),
  eventId: char("event_id", { length: 36 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  anzahl: int("anzahl").notNull(),
  summeCent: int("summe_cent").notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  erstelltAm: datetime("erstellt_am").notNull(),
});

export const ticket = mysqlTable(
  "ticket",
  {
    id: char("id", { length: 36 }).primaryKey(),
    bestellungId: char("bestellung_id", { length: 36 }).notNull(),
    eventId: char("event_id", { length: 36 }).notNull(),
    platzNr: int("platz_nr").notNull(),
    pdfPfad: varchar("pdf_pfad", { length: 500 }),
    erstelltAm: datetime("erstellt_am").notNull(),
  },
  (t) => [uniqueIndex("uq_ticket_platz").on(t.eventId, t.platzNr), index("idx_ticket_event").on(t.eventId)],
);

export type Event = typeof event.$inferSelect;
export type Bestellung = typeof bestellung.$inferSelect;
export type Ticket = typeof ticket.$inferSelect;
