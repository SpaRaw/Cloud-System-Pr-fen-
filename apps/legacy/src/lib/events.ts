import type { RowDataPacket } from "mysql2";
import { getPool } from "@kw/db";

export type LegacyEvent = {
  id: string;
  name: string;
  beschreibung: string;
  bild_url: string | null;
  datum: Date;
  preis_cent: number;
  gesamt: number;
  verkauft: number;
};

export async function alleEvents(): Promise<LegacyEvent[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT e.id, e.name, e.beschreibung, e.bild_url, e.datum, e.preis_cent, k.gesamt, k.verkauft FROM event e JOIN kontingent k ON k.event_id = e.id ORDER BY e.datum",
  );
  return rows as LegacyEvent[];
}

export async function einEvent(id: string): Promise<LegacyEvent | undefined> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT e.id, e.name, e.beschreibung, e.bild_url, e.datum, e.preis_cent, k.gesamt, k.verkauft FROM event e JOIN kontingent k ON k.event_id = e.id WHERE e.id = ?",
    [id],
  );
  return rows[0] as LegacyEvent | undefined;
}
