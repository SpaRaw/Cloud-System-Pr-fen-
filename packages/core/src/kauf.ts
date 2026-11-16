import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { ladeEvent, verkauftePlaetze } from "@kw/db";
import {
  LUA_ABBRECHEN,
  LUA_AUFRAEUMEN,
  LUA_BESTAETIGEN,
  LUA_BESTELLEN,
  LUA_INIT,
  LUA_RESERVIEREN,
  LUA_STATUS,
} from "./lua";

export const KONFIG = {
  reservierungMs: Number(process.env.RESERVIERUNG_MS ?? 120_000), // 2 min
  zahlungMs: Number(process.env.ZAHLUNG_MS ?? 60_000), // Frist in Zustand 2
  warteTimeoutMs: Number(process.env.WARTE_TIMEOUT_MS ?? 10_000), // raus ohne Polling
  spitzeMs: Number(process.env.SPITZE_MS ?? 120_000), // nicht länger überspringen
  scanBreite: 500, // so viele Wartende prüft First-Fit pro Durchlauf
  outboxAlterMs: 60_000,
  maxTickets: 4,
};
const cfg = JSON.stringify(KONFIG);

let redis: Redis | undefined;
export function getRedis(): Redis {
  if (!redis) {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    redis = new Redis(url, { maxRetriesPerRequest: 3, enableAutoPipelining: true });
  }
  return redis;
}
export async function closeRedis() {
  await redis?.quit();
  redis = undefined;
}

const praefix = (eventId: string) => `kw:{${eventId}}:`;

export type KaufStatus =
  | { zustand: "keine"; frei: number }
  | { zustand: "wartend"; frei: number; position: number; schaetzungSek: number | null; anzahl: number }
  | { zustand: "reserviert" | "zahlung"; frei: number; bestellungId: string; plaetze: number[]; ablaufMs: number }
  | { zustand: "verkauft"; frei: number; bestellungId: string; plaetze: number[] }
  | { zustand: "abgelaufen" | "abgebrochen" | "ausverkauft" | "nicht_im_verkauf"; frei: number };

type Roh = (string | number)[];

function parse(r: Roh): KaufStatus {
  const [z, f] = r;
  const frei = Number(f);
  switch (z) {
    case "wartend": {
      const ms = Number(r[3]);
      return { zustand: "wartend", frei, position: Number(r[2]), schaetzungSek: ms < 0 ? null : Math.ceil(ms / 1000), anzahl: Number(r[4]) };
    }
    case "reserviert":
    case "zahlung":
      return { zustand: z, frei, bestellungId: String(r[2]), plaetze: liste(r[3]), ablaufMs: Number(r[4]) };
    case "verkauft":
      return { zustand: "verkauft", frei, bestellungId: String(r[2]), plaetze: liste(r[3]) };
    case "keine":
    case "abgelaufen":
    case "abgebrochen":
    case "ausverkauft":
    case "nicht_im_verkauf":
      return { zustand: z, frei };
    default:
      throw new Error(`Unbekannter Zustand ${String(z)}`);
  }
}
const liste = (s: unknown) => String(s).split(",").filter(Boolean).map(Number);

/** Baut den Redis-Hash eines Events aus MySQL auf (nach Neustart oder beim ersten Zugriff). */
export async function initEvent(eventId: string): Promise<"ok" | "nicht_im_verkauf"> {
  const r = getRedis();
  const p = praefix(eventId);
  if (await r.exists(`${p}meta`)) return "ok";
  const ev = await ladeEvent(eventId);
  const jetzt = Date.now();
  if (!ev || ev.verkaufAb.getTime() > jetzt || ev.verkaufBis.getTime() < jetzt) return "nicht_im_verkauf";
  // Sperre, damit bei einem Ansturm nur einer aufbaut.
  const lock = await r.set(`${p}initlock`, "1", "PX", 30_000, "NX");
  if (!lock) {
    for (let i = 0; i < 50 && !(await r.exists(`${p}meta`)); i++) await new Promise((res) => setTimeout(res, 100));
    return "ok";
  }
  try {
    const verkauft = await verkauftePlaetze(eventId);
    await r.eval(LUA_INIT, 1, p, jetzt, cfg, ev.gesamt, ev.verkaufBis.getTime(), ...verkauft);
  } finally {
    await r.del(`${p}initlock`);
  }
  return "ok";
}

async function ausfuehren(eventId: string, skript: string, ...args: (string | number)[]): Promise<Roh> {
  const r = getRedis();
  for (let versuch = 0; versuch < 2; versuch++) {
    const res = (await r.eval(skript, 1, praefix(eventId), Date.now(), cfg, ...args)) as Roh;
    if (res[0] !== "init") return res;
    if ((await initEvent(eventId)) === "nicht_im_verkauf") return ["nicht_im_verkauf", 0];
  }
  throw new Error("Redis-Init fehlgeschlagen");
}

export async function reservieren(eventId: string, sid: string, anzahl: number): Promise<KaufStatus> {
  if (!Number.isInteger(anzahl) || anzahl < 1 || anzahl > KONFIG.maxTickets) throw new Fehler(400, `Anzahl muss 1 bis ${KONFIG.maxTickets} sein`);
  return parse(await ausfuehren(eventId, LUA_RESERVIEREN, sid, anzahl, randomUUID()));
}

export async function status(eventId: string, sid: string): Promise<KaufStatus> {
  return parse(await ausfuehren(eventId, LUA_STATUS, sid));
}

export async function bestellen(eventId: string, sid: string, name: string, email: string): Promise<KaufStatus> {
  if (!name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Fehler(400, "Name und gültige Mailadresse angeben");
  return parse(await ausfuehren(eventId, LUA_BESTELLEN, sid, name.trim().slice(0, 200), email.trim().slice(0, 320)));
}

export type BestellNachricht = {
  bestellungId: string;
  eventId: string;
  plaetze: number[];
  name: string;
  email: string;
};

/** 2 -> 3. Gibt bei Erfolg die Nachricht für die Queue zurück. */
export async function bestaetigen(eventId: string, sid: string): Promise<{ status: KaufStatus; nachricht?: BestellNachricht }> {
  const r = await ausfuehren(eventId, LUA_BESTAETIGEN, sid);
  const st = parse(r);
  if (st.zustand !== "verkauft") return { status: st };
  return {
    status: st,
    nachricht: { bestellungId: st.bestellungId, eventId, plaetze: st.plaetze, name: String(r[5]), email: String(r[6]) },
  };
}

export async function abbrechen(eventId: string, sid: string): Promise<KaufStatus> {
  return parse(await ausfuehren(eventId, LUA_ABBRECHEN, sid));
}

/** Timer: gibt Abgelaufenes frei, teilt zu, liefert Outbox-Einträge, die erneut in die Queue müssen. */
export async function aufraeumen(eventId: string): Promise<{ freigegeben: number; zugeteilt: number; erneutSenden: BestellNachricht[] }> {
  if ((await initEvent(eventId)) === "nicht_im_verkauf") return { freigegeben: 0, zugeteilt: 0, erneutSenden: [] };
  const r = getRedis();
  const p = praefix(eventId);
  const [freigegeben, zugeteilt, haengend] = (await r.eval(LUA_AUFRAEUMEN, 1, p, Date.now(), cfg, KONFIG.outboxAlterMs)) as [
    number,
    number,
    string[],
  ];
  const erneutSenden: BestellNachricht[] = [];
  for (const rid of haengend) {
    const h = await r.hgetall(`${p}res:${rid}`);
    if (h.plaetze) erneutSenden.push({ bestellungId: rid, eventId, plaetze: liste(h.plaetze), name: h.name, email: h.email });
    else await r.zrem(`${p}outbox`, rid);
  }
  return { freigegeben, zugeteilt, erneutSenden };
}

/** MySQL hat die Bestellung gespeichert: Outbox-Eintrag löschen, Reservierungsdaten nach 1 h verwerfen. */
export async function outboxQuittieren(eventId: string, bestellungId: string) {
  const r = getRedis();
  const p = praefix(eventId);
  await r.zrem(`${p}outbox`, bestellungId);
  await r.expire(`${p}res:${bestellungId}`, 3600);
}

/** Freie Plätze je Event (nur Zustand 0). null = Event nicht in Redis (nicht im Verkauf). */
export async function verfuegbar(eventIds: string[]): Promise<Record<string, number | null>> {
  const r = getRedis();
  const pipe = r.pipeline();
  for (const id of eventIds) {
    pipe.exists(`${praefix(id)}meta`);
    pipe.scard(`${praefix(id)}frei`);
  }
  const res = (await pipe.exec()) ?? [];
  const aus: Record<string, number | null> = {};
  eventIds.forEach((id, i) => {
    const existiert = Number(res[i * 2]?.[1]);
    aus[id] = existiert ? Number(res[i * 2 + 1]?.[1]) : null;
  });
  return aus;
}

/** Schutz gegen Bots: einfaches Fenster pro Sekunde. */
export async function rateLimit(schluessel: string, maxProSekunde: number): Promise<boolean> {
  const r = getRedis();
  const k = `kw:rl:${schluessel}:${Math.floor(Date.now() / 1000)}`;
  const n = await r.incr(k);
  if (n === 1) await r.expire(k, 2);
  return n <= maxProSekunde;
}

export class Fehler extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
