"use server";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPool } from "@kw/db";
import { ausLokal } from "@kw/core/format";
import { dateiSchreiben } from "./dateien";

async function bildSpeichern(fd: FormData): Promise<string | null> {
  const bild = fd.get("bild");
  if (!(bild instanceof File) || bild.size === 0) return null;
  const endung = bild.type === "image/png" ? "png" : bild.type === "image/webp" ? "webp" : "jpg";
  const name = `${randomUUID()}.${endung}`;
  await dateiSchreiben("bilder", name, new Uint8Array(await bild.arrayBuffer()));
  return `/bilder/${name}`;
}

function felder(fd: FormData) {
  return {
    name: String(fd.get("name") ?? "").trim(),
    beschreibung: String(fd.get("beschreibung") ?? "").trim(),
    datum: ausLokal(String(fd.get("datum"))),
    preisCent: Math.round(Number(fd.get("preis")) * 100),
    kontingent: Number(fd.get("kontingent")),
  };
}

export async function eventAnlegen(fd: FormData) {
  const f = felder(fd);
  const id = randomUUID();
  const bild = await bildSpeichern(fd);
  const pool = getPool();
  await pool.query("INSERT INTO event (id, name, beschreibung, bild_url, datum, preis_cent) VALUES (?, ?, ?, ?, ?, ?)", [
    id, f.name, f.beschreibung, bild, f.datum, f.preisCent,
  ]);
  await pool.query("INSERT INTO kontingent (id, event_id, gesamt, verkauft) VALUES (?, ?, ?, 0)", [randomUUID(), id, f.kontingent]);
  revalidatePath("/admin");
  redirect("/admin");
}

export async function eventAendern(id: string, fd: FormData) {
  const f = felder(fd);
  const bild = await bildSpeichern(fd);
  const pool = getPool();
  await pool.query(
    `UPDATE event SET name = ?, beschreibung = ?, datum = ?, preis_cent = ?${bild ? ", bild_url = ?" : ""} WHERE id = ?`,
    bild ? [f.name, f.beschreibung, f.datum, f.preisCent, bild, id] : [f.name, f.beschreibung, f.datum, f.preisCent, id],
  );
  if (f.kontingent) await pool.query("UPDATE kontingent SET gesamt = ? WHERE event_id = ?", [f.kontingent, id]);
  revalidatePath("/admin");
  redirect("/admin");
}
