import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Altsystem: alles liegt auf derselben Platte wie App und Datenbank.
const basis = process.env.LEGACY_DATEN_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "legacy-data");

export async function dateiSchreiben(ordner: "tickets" | "bilder", name: string, daten: Uint8Array) {
  const dir = path.join(/*turbopackIgnore: true*/ basis, ordner);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(/*turbopackIgnore: true*/ dir, path.basename(name)), daten);
  return `${ordner}/${path.basename(name)}`;
}

export async function dateiLesen(ordner: "tickets" | "bilder", name: string) {
  try {
    return await readFile(path.join(/*turbopackIgnore: true*/ basis, ordner, path.basename(name)));
  } catch {
    return null;
  }
}
