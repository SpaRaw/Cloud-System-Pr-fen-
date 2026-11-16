// Testet die Lua-Logik gegen einen echten Redis (REDIS_URL, Standard localhost:6379).
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.RESERVIERUNG_MS = "400";
  process.env.ZAHLUNG_MS = "400";
  process.env.WARTE_TIMEOUT_MS = "1000";
  process.env.SPITZE_MS = "300";
  process.env.REDIS_URL ??= "redis://localhost:6379/15";
});

const kontingent = { gesamt: 10, verkauft: [] as number[] };
vi.mock("@kw/db", () => ({
  ladeEvent: async () => ({
    gesamt: kontingent.gesamt,
    verkaufAb: new Date(Date.now() - 1000),
    verkaufBis: new Date(Date.now() + 3_600_000),
  }),
  verkauftePlaetze: async () => kontingent.verkauft,
}));

const k = await import("../src/kauf");
const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));
let E = "";

beforeEach(async () => {
  await k.getRedis().flushdb();
  kontingent.gesamt = 10;
  kontingent.verkauft = [];
  E = `test-${Math.random().toString(36).slice(2)}`;
});
afterAll(() => k.closeRedis());

describe("Reservierung", () => {
  it("reserviert alles oder nichts und zählt nur freie Plätze", async () => {
    const s = await k.reservieren(E, "a", 4);
    expect(s.zustand).toBe("reserviert");
    if (s.zustand === "reserviert") expect(s.plaetze).toHaveLength(4);
    expect((await k.verfuegbar([E]))[E]).toBe(6);
  });

  it("baut nach einem Neustart aus MySQL auf und übernimmt verkaufte Plätze", async () => {
    kontingent.verkauft = [1, 2, 3];
    expect((await k.status(E, "x")).frei).toBe(7);
  });

  it("verkauft bei 300 parallelen Käufern nie mehr als das Kontingent", async () => {
    kontingent.gesamt = 50;
    const res = await Promise.all(Array.from({ length: 300 }, (_, i) => k.reservieren(E, `s${i}`, 1 + (i % 4))));
    const plaetze = res.flatMap((r) => (r.zustand === "reserviert" ? r.plaetze : []));
    expect(new Set(plaetze).size).toBe(plaetze.length);
    expect(plaetze.length).toBeLessThanOrEqual(50);
    expect(res.filter((r) => r.zustand === "wartend").length).toBeGreaterThan(0);
  });

  it("lehnt mehr als 4 Tickets ab", async () => {
    await expect(k.reservieren(E, "a", 5)).rejects.toThrow();
  });
});

describe("Kaufablauf", () => {
  it("reserviert -> zahlung -> verkauft, mit Outbox und idempotenter Bestätigung", async () => {
    await k.reservieren(E, "a", 2);
    expect((await k.bestellen(E, "a", "Erika Test", "erika@example.test")).zustand).toBe("zahlung");
    const b = await k.bestaetigen(E, "a");
    expect(b.status.zustand).toBe("verkauft");
    expect(b.nachricht?.plaetze).toHaveLength(2);
    expect(b.nachricht?.email).toBe("erika@example.test");
    // Doppelklick liefert dieselbe Bestellung
    const b2 = await k.bestaetigen(E, "a");
    expect(b2.nachricht?.bestellungId).toBe(b.nachricht?.bestellungId);
    expect(await k.getRedis().zcard(`kw:{${E}}:outbox`)).toBe(1);
    await k.outboxQuittieren(E, b.nachricht!.bestellungId);
    expect(await k.getRedis().zcard(`kw:{${E}}:outbox`)).toBe(0);
  });

  it("gibt abgelaufene Reservierungen frei", async () => {
    await k.reservieren(E, "a", 3);
    await warte(500);
    const s = await k.status(E, "a");
    expect(s.zustand).toBe("abgelaufen");
    expect(s.frei).toBe(10);
  });

  it("bestellen nach Ablauf schlägt fehl", async () => {
    await k.reservieren(E, "a", 1);
    await warte(500);
    expect((await k.bestellen(E, "a", "A", "a@b.de")).zustand).toBe("abgelaufen");
  });

  it("Abbruch in der Zahlung gibt frei", async () => {
    await k.reservieren(E, "a", 2);
    await k.bestellen(E, "a", "A", "a@b.de");
    const s = await k.abbrechen(E, "a");
    expect(s.zustand).toBe("abgebrochen");
    expect(s.frei).toBe(10);
  });

  it("hängende Outbox-Einträge werden vom Timer zurückgegeben", async () => {
    await k.reservieren(E, "a", 1);
    await k.bestellen(E, "a", "A", "a@b.de");
    await k.bestaetigen(E, "a");
    await k.getRedis().zadd(`kw:{${E}}:outbox`, Date.now() - 120_000, (await k.status(E, "a") as { bestellungId: string }).bestellungId);
    const r = await k.aufraeumen(E);
    expect(r.erneutSenden).toHaveLength(1);
  });
});

describe("Warteschlange", () => {
  it("gibt frei werdende Plätze direkt an den Ersten in der Schlange", async () => {
    kontingent.gesamt = 2;
    await k.reservieren(E, "a", 2);
    const w = await k.reservieren(E, "b", 1);
    expect(w).toMatchObject({ zustand: "wartend", position: 1 });
    await k.abbrechen(E, "a");
    expect((await k.status(E, "b")).zustand).toBe("reserviert");
  });

  it("First-Fit: Kleine Bestellung überholt eine große", async () => {
    kontingent.gesamt = 4;
    await k.reservieren(E, "a", 4);
    await k.reservieren(E, "gross", 3);
    await k.reservieren(E, "klein", 1);
    // a gibt nur einen Platz frei? Nein: alles oder nichts. Daher: a bricht ab, 4 frei -> gross (3) + klein (1).
    await k.abbrechen(E, "a");
    expect((await k.status(E, "gross")).zustand).toBe("reserviert");
    expect((await k.status(E, "klein")).zustand).toBe("reserviert");
  });

  it("First-Fit mit Schutz: Wer zu lange vorne steht, wird nicht mehr übersprungen", async () => {
    kontingent.gesamt = 2;
    await k.reservieren(E, "a", 1);
    await k.reservieren(E, "b", 1);
    await k.reservieren(E, "gross", 2); // Spitze
    await k.reservieren(E, "klein", 1);
    await k.abbrechen(E, "a"); // 1 frei, Spitze erst kurz da -> klein überholt
    expect((await k.status(E, "klein")).zustand).toBe("reserviert");
    await k.reservieren(E, "klein2", 1);
    await warte(350); // Spitze wartet jetzt länger als SPITZE_MS
    await k.status(E, "gross");
    await k.status(E, "klein2");
    await k.abbrechen(E, "b"); // 1 frei, aber gross steht zu lange vorne -> klein2 darf nicht überholen
    expect((await k.status(E, "klein2")).zustand).toBe("wartend");
    await k.abbrechen(E, "klein"); // jetzt 2 frei -> gross
    expect((await k.status(E, "gross")).zustand).toBe("reserviert");
  });

  it("wirft Wartende nach Timeout ohne Polling raus", async () => {
    kontingent.gesamt = 1;
    await k.reservieren(E, "a", 1);
    await k.reservieren(E, "b", 1);
    await k.reservieren(E, "c", 1);
    // b hat seit 2 s nicht mehr gepollt (Tab geschlossen)
    await k.getRedis().zadd(`kw:{${E}}:wq:seen`, Date.now() - 2000, "b");
    await k.abbrechen(E, "a");
    expect((await k.status(E, "c")).zustand).toBe("reserviert");
  });

  it("meldet ausverkauft, wenn alles verkauft ist", async () => {
    kontingent.gesamt = 1;
    await k.reservieren(E, "a", 1);
    await k.reservieren(E, "b", 1);
    await k.bestellen(E, "a", "A", "a@b.de");
    await k.bestaetigen(E, "a");
    expect((await k.status(E, "b")).zustand).toBe("ausverkauft");
    expect((await k.reservieren(E, "c", 1)).zustand).toBe("ausverkauft");
  });
});
