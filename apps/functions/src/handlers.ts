// Framework-unabhängige Handler. azure.ts bindet sie an Azure Functions, dev.ts an einen lokalen HTTP-Server.
import { randomUUID } from "node:crypto";
import {
  abbrechen,
  aufraeumen,
  bestaetigen,
  bestellen,
  Fehler,
  inQueueLegen,
  rateLimit,
  reservieren,
  status,
  verarbeiteBestellung,
  verfuegbar,
  type BestellNachricht,
  type KaufStatus,
} from "@kw/core";
import { eventsImVerkauf, ladeEvents } from "@kw/db";

export type Anfrage = {
  method: string;
  query: URLSearchParams;
  body: unknown;
  cookie: (name: string) => string | undefined;
  ip: string;
};
export type Antwort = { status: number; json: unknown; cookies?: string[]; headers?: Record<string, string> };

const COOKIE = "kw_sid";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMIT_SESSION = Number(process.env.RATE_LIMIT_SESSION ?? 10);
const LIMIT_IP = Number(process.env.RATE_LIMIT_IP ?? 300);

function session(req: Anfrage): { sid: string; cookies?: string[] } {
  const sid = req.cookie(COOKIE);
  if (sid && UUID.test(sid)) return { sid };
  const neu = randomUUID();
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return { sid: neu, cookies: [`${COOKIE}=${neu}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secure}`] };
}

function eventIdAus(req: Anfrage): string {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const id = String(b.eventId ?? req.query.get("eventId") ?? "");
  if (!UUID.test(id)) throw new Fehler(400, "eventId fehlt");
  return id;
}

async function geschuetzt(req: Anfrage, fn: (sid: string) => Promise<unknown>): Promise<Antwort> {
  const { sid, cookies } = session(req);
  try {
    // Bot-Schutz: Wer zu oft fragt, bekommt 429 – das kostet uns nur einen Redis-INCR.
    if (!(await rateLimit(`s:${sid}`, LIMIT_SESSION)) || !(await rateLimit(`ip:${req.ip}`, LIMIT_IP))) {
      return { status: 429, json: { fehler: "Zu viele Anfragen" }, cookies, headers: { "retry-after": "1" } };
    }
    return { status: 200, json: await fn(sid), cookies };
  } catch (e) {
    if (e instanceof Fehler) return { status: e.status, json: { fehler: e.message }, cookies };
    console.error(e);
    return { status: 500, json: { fehler: "Interner Fehler" }, cookies };
  }
}

export const http = {
  reservieren: (req: Anfrage) =>
    geschuetzt(req, (sid) => reservieren(eventIdAus(req), sid, Number((req.body as { anzahl?: unknown })?.anzahl ?? 1))),

  status: (req: Anfrage) => geschuetzt(req, (sid) => status(eventIdAus(req), sid)),

  bestellen: (req: Anfrage) =>
    geschuetzt(req, (sid) => {
      const b = (req.body ?? {}) as { name?: string; email?: string };
      return bestellen(eventIdAus(req), sid, String(b.name ?? ""), String(b.email ?? ""));
    }),

  /** Platzhalter-Zahlung ist durch (5 s Spinner im Browser): 2 -> 3, dann in die Queue. */
  bestaetigen: (req: Anfrage) =>
    geschuetzt(req, async (sid): Promise<KaufStatus> => {
      const { status: st, nachricht } = await bestaetigen(eventIdAus(req), sid);
      // Schlägt das Einreihen fehl, bleibt der Eintrag in der Outbox und der Timer legt ihn erneut ein.
      if (nachricht) await inQueueLegen(nachricht).catch((e) => console.error("Queue nicht erreichbar, Outbox übernimmt", e));
      return st;
    }),

  abbrechen: (req: Anfrage) => geschuetzt(req, (sid) => abbrechen(eventIdAus(req), sid)),

  verfuegbar: (req: Anfrage) => geschuetzt(req, () => verfuegbarMitFallback((req.query.get("ids") ?? "").split(",").filter((s) => UUID.test(s)).slice(0, 50))),
};

// Für Events, die (noch) nicht in Redis sind, zählt MySQL – gecacht, damit Polling die DB nicht trifft.
let dbCache: { zeit: number; werte: Record<string, number> } | undefined;
async function verfuegbarMitFallback(ids: string[]) {
  const live = await verfuegbar(ids);
  if (Object.values(live).some((v) => v === null)) {
    if (!dbCache || Date.now() - dbCache.zeit > 5000) {
      const events = await ladeEvents();
      dbCache = { zeit: Date.now(), werte: Object.fromEntries(events.map((e) => [e.id, Math.max(0, e.gesamt - e.verkauft)])) };
    }
    for (const id of ids) if (live[id] === null) live[id] = dbCache.werte[id] ?? 0;
  }
  return live;
}

/** Timer (alle 5 s): Redis für Events im Verkauf aufbauen, Abgelaufenes freigeben, zuteilen, Outbox nachsenden. */
export async function timerAufraeumen(log: (m: string) => void = console.log) {
  for (const e of await eventsImVerkauf()) {
    const r = await aufraeumen(e.id);
    for (const n of r.erneutSenden) await inQueueLegen(n);
    if (r.freigegeben || r.zugeteilt || r.erneutSenden.length)
      log(`${e.name}: ${r.freigegeben} freigegeben, ${r.zugeteilt} zugeteilt, ${r.erneutSenden.length} erneut gesendet`);
  }
}

/** Queue-Trigger. Wirft bei Fehlern, dann stellt die Queue die Nachricht erneut zu (max. 5 Mal, danach Poison-Queue). */
export async function queueVerarbeiten(nachricht: unknown, log: (m: string) => void = console.log) {
  const n = (typeof nachricht === "string" ? JSON.parse(nachricht) : nachricht) as BestellNachricht;
  return verarbeiteBestellung(n, log);
}
