"use server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { event, getDb, kontingent } from "@kw/db";
import { ausLokal } from "@kw/core/format";
import { blobHochladen, CONTAINER_BILDER } from "@kw/core/storage";

async function bildSpeichern(fd: FormData): Promise<string | null> {
  const bild = fd.get("bild");
  if (!(bild instanceof File) || bild.size === 0) return null;
  if (bild.size > 5_000_000) throw new Error("Bild zu groß (max. 5 MB)");
  const endung = bild.type === "image/png" ? "png" : bild.type === "image/webp" ? "webp" : "jpg";
  const pfad = `${randomUUID()}.${endung}`;
  await blobHochladen(CONTAINER_BILDER, pfad, new Uint8Array(await bild.arrayBuffer()), bild.type || "image/jpeg");
  return `/bilder/${pfad}`;
}

function felder(fd: FormData) {
  const f = {
    name: String(fd.get("name") ?? "").trim(),
    beschreibung: String(fd.get("beschreibung") ?? "").trim(),
    datum: ausLokal(String(fd.get("datum"))),
    preisCent: Math.round(Number(fd.get("preis")) * 100),
    kontingent: fd.get("kontingent") ? Number(fd.get("kontingent")) : undefined,
    verkaufAb: ausLokal(String(fd.get("verkaufAb"))),
    verkaufBis: ausLokal(String(fd.get("verkaufBis"))),
  };
  if (f.verkaufBis <= f.verkaufAb) throw new Error("Verkaufsende muss nach dem Start liegen");
  return f;
}

export async function eventAnlegen(fd: FormData) {
  const f = felder(fd);
  const id = randomUUID();
  const bildUrl = await bildSpeichern(fd);
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.insert(event).values({ id, name: f.name, beschreibung: f.beschreibung, bildUrl, datum: f.datum, preisCent: f.preisCent, erstelltAm: new Date(), verkaufAb: f.verkaufAb, verkaufBis: f.verkaufBis });
    await tx.insert(kontingent).values({ id: randomUUID(), eventId: id, gesamt: f.kontingent ?? 500, verkauft: 0 });
  });
  revalidatePath("/admin");
  redirect("/admin");
}

export async function eventAendern(id: string, kontingentGesperrt: boolean, fd: FormData) {
  const f = felder(fd);
  const bildUrl = await bildSpeichern(fd);
  const db = getDb();
  await db
    .update(event)
    .set({ name: f.name, beschreibung: f.beschreibung, datum: f.datum, preisCent: f.preisCent, verkaufAb: f.verkaufAb, verkaufBis: f.verkaufBis, ...(bildUrl ? { bildUrl } : {}) })
    .where(eq(event.id, id));
  // Läuft der Verkauf schon, hält Redis die Plätze 1…Kontingent. Dann darf sich die Zahl nicht mehr ändern.
  if (!kontingentGesperrt && f.kontingent) await db.update(kontingent).set({ gesamt: f.kontingent }).where(eq(kontingent.eventId, id));
  revalidatePath("/admin");
  redirect("/admin");
}
