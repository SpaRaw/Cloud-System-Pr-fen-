"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ClockIcon, CreditCardIcon, MinusIcon, PlusIcon, UsersIcon, XCircleIcon } from "lucide-react";
import type { KaufStatus } from "@kw/core/kauf";
import { Button } from "@kw/ui/components/button";
import { Input } from "@kw/ui/components/input";
import { Label } from "@kw/ui/components/label";
import { Progress } from "@kw/ui/components/progress";
import { Spinner } from "@kw/ui/components/spinner";
import { Alert, AlertDescription, AlertTitle } from "@kw/ui/components/alert";
import { useVerfuegbar } from "./live-verfuegbar";

const ZAHLUNG_SPINNER_MS = 5000;

async function api(aktion: string, eventId: string, body?: Record<string, unknown>): Promise<KaufStatus> {
  const r = await fetch(`/api/kauf/${aktion}${body ? "" : `?eventId=${eventId}`}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify({ eventId, ...body }) : undefined,
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.fehler ?? `Fehler ${r.status}`);
  return j as KaufStatus;
}

function mmss(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function KaufFlow({ eventId, preisText, reservierungSek }: { eventId: string; preisText: string; reservierungSek: number }) {
  const router = useRouter();
  const frei = useVerfuegbar(eventId);
  const [st, setSt] = React.useState<KaufStatus | null>(null);
  const [anzahl, setAnzahl] = React.useState(1);
  const [fehler, setFehler] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [jetzt, setJetzt] = React.useState(() => Date.now());
  const [zahlungSeit, setZahlungSeit] = React.useState<number | null>(null);
  const [form, setForm] = React.useState({ name: "", email: "" });

  const ausfuehren = React.useCallback(
    async (aktion: string, body?: Record<string, unknown>) => {
      setFehler(null);
      try {
        const s = await api(aktion, eventId, body);
        setSt(s);
        return s;
      } catch (e) {
        setFehler((e as Error).message);
        return null;
      }
    },
    [eventId],
  );

  // Beim Laden: Gibt es schon eine Reservierung oder einen Platz in der Schlange? (Reload-fest)
  React.useEffect(() => {
    void ausfuehren("status");
  }, [ausfuehren]);

  // Polling jede Sekunde, solange gewartet oder reserviert wird. Hält den Platz in der Schlange.
  const zustand = st?.zustand;
  React.useEffect(() => {
    if (zustand !== "wartend" && zustand !== "reserviert" && zustand !== "zahlung") return;
    const t = setInterval(() => {
      setJetzt(Date.now());
      void api("status", eventId).then(setSt).catch(() => {});
    }, 1000);
    return () => clearInterval(t);
  }, [zustand, eventId]);

  // Platzhalter-Zahlung: 5 s Spinner, dann bestätigen – außer es wurde abgebrochen.
  React.useEffect(() => {
    if (zustand !== "zahlung") {
      setZahlungSeit(null);
      return;
    }
    const seit = zahlungSeit ?? Date.now();
    if (zahlungSeit === null) setZahlungSeit(seit);
    const t = setTimeout(() => void ausfuehren("bestaetigen", {}), Math.max(0, seit + ZAHLUNG_SPINNER_MS - Date.now()));
    return () => clearTimeout(t);
  }, [zustand, zahlungSeit, ausfuehren]);

  React.useEffect(() => {
    if (st?.zustand === "verkauft") router.push(`/shop/bestellung/${st.bestellungId}`);
  }, [st, router]);

  const klick = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };

  if (!st) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Lade …
      </div>
    );
  }

  if (st.zustand === "nicht_im_verkauf") {
    return <p className="text-sm text-muted-foreground">Für dieses Event läuft gerade kein Verkauf.</p>;
  }

  if (st.zustand === "ausverkauft") {
    return (
      <Alert variant="destructive">
        <XCircleIcon />
        <AlertTitle>Ausverkauft</AlertTitle>
        <AlertDescription>Alle Tickets sind verkauft. Die Warteschlange ist geschlossen.</AlertDescription>
      </Alert>
    );
  }

  if (st.zustand === "wartend") {
    return (
      <div className="grid gap-4">
        <div className="flex items-center gap-3">
          <UsersIcon className="size-8 text-primary" />
          <div>
            <p className="font-heading text-2xl font-semibold tabular-nums">Platz {st.position}</p>
            <p className="text-sm text-muted-foreground">in der Warteschlange für {st.anzahl} Ticket(s)</p>
          </div>
        </div>
        <p className="text-sm">
          Gerade sind alle Tickets reserviert. Sobald eine Reservierung abläuft, bist du dran.
          {st.schaetzungSek !== null && (
            <>
              {" "}
              Geschätzt in <strong className="tabular-nums">{mmss(st.schaetzungSek * 1000)}</strong>.
            </>
          )}
        </p>
        <Progress value={st.schaetzungSek === null ? 5 : 100 - Math.min(100, (st.schaetzungSek / reservierungSek) * 100)} />
        <p className="text-xs text-muted-foreground">Lass diese Seite offen. Ohne Verbindung verlierst du nach 10 Sekunden deinen Platz.</p>
        <Button variant="outline" disabled={busy} onClick={() => klick(() => ausfuehren("abbrechen", {}))}>
          Warteschlange verlassen
        </Button>
      </div>
    );
  }

  if (st.zustand === "reserviert") {
    const rest = st.ablaufMs - jetzt;
    return (
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void klick(() => ausfuehren("bestellen", form));
        }}
      >
        <div className="flex items-center justify-between rounded-lg bg-primary/10 px-3 py-2 text-sm">
          <span className="flex items-center gap-2">
            <ClockIcon className="size-4 text-primary" /> {st.plaetze.length} Ticket(s) für dich reserviert
          </span>
          <span className="font-mono font-semibold tabular-nums">{mmss(rest)}</span>
        </div>
        <Progress value={(rest / (reservierungSek * 1000)) * 100} />
        <p className="text-xs text-muted-foreground">Ticketnummern: {st.plaetze.join(", ")}</p>
        <div className="grid gap-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="email">E-Mail für die Tickets</Label>
          <Input id="email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        {fehler && <p className="text-sm text-destructive">{fehler}</p>}
        <Button type="submit" disabled={busy}>
          <CreditCardIcon /> Zahlungspflichtig bestellen
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => klick(() => ausfuehren("abbrechen", {}))}>
          Reservierung aufheben
        </Button>
      </form>
    );
  }

  if (st.zustand === "zahlung") {
    return (
      <div className="grid justify-items-center gap-4 py-4 text-center">
        <Spinner className="size-10 text-primary" />
        <div>
          <p className="font-medium">Zahlung wird verarbeitet …</p>
          <p className="text-sm text-muted-foreground">Testsystem: kein echter Zahlungsanbieter.</p>
        </div>
        <Button variant="destructive" disabled={busy} onClick={() => klick(() => ausfuehren("abbrechen", {}))}>
          Zahlung abbrechen
        </Button>
      </div>
    );
  }

  // keine | abgelaufen | abgebrochen | verkauft (Weiterleitung läuft)
  return (
    <div className="grid gap-4">
      {(st.zustand === "abgelaufen" || st.zustand === "abgebrochen") && (
        <Alert variant="destructive">
          <XCircleIcon />
          <AlertTitle>Buchung nicht abgeschlossen</AlertTitle>
          <AlertDescription>
            {st.zustand === "abgelaufen"
              ? "Die Reservierung ist abgelaufen. Die Tickets sind wieder frei."
              : "Du hast abgebrochen. Die Tickets gehen an die nächste Person in der Warteschlange."}
          </AlertDescription>
        </Alert>
      )}
      <div className="flex items-center justify-between">
        <Label>Anzahl</Label>
        <div className="flex items-center gap-2">
          <Button type="button" size="icon" variant="outline" aria-label="weniger" onClick={() => setAnzahl(Math.max(1, anzahl - 1))}>
            <MinusIcon />
          </Button>
          <span className="w-6 text-center font-semibold tabular-nums">{anzahl}</span>
          <Button type="button" size="icon" variant="outline" aria-label="mehr" onClick={() => setAnzahl(Math.min(4, anzahl + 1))}>
            <PlusIcon />
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {anzahl} × {preisText} · höchstens 4 pro Bestellung
      </p>
      {fehler && <p className="text-sm text-destructive">{fehler}</p>}
      <Button disabled={busy || st.zustand === "verkauft"} onClick={() => klick(() => ausfuehren("reservieren", { anzahl }))}>
        {busy ? <Spinner /> : null}
        {frei === 0 ? "In die Warteschlange" : "Tickets reservieren"}
      </Button>
      <p className="text-xs text-muted-foreground">Nach dem Reservieren hast du {Math.round(reservierungSek / 60)} Minuten Zeit für die Bestellung.</p>
    </div>
  );
}
