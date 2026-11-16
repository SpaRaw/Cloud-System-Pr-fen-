"use client";
import * as React from "react";
import { Badge } from "@kw/ui/components/badge";

// Ein Polling pro Seite (jede Sekunde) für alle sichtbaren Events.
const Ctx = React.createContext<Record<string, number | null>>({});

export function VerfuegbarProvider({ ids, start, children }: { ids: string[]; start: Record<string, number>; children: React.ReactNode }) {
  const [werte, setWerte] = React.useState<Record<string, number | null>>(start);
  const schluessel = ids.join(",");
  React.useEffect(() => {
    let aktiv = true;
    const holen = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch(`/api/kauf/verfuegbar?ids=${schluessel}`, { cache: "no-store" });
        if (r.ok && aktiv) setWerte(await r.json());
      } catch {
        /* nächster Versuch in 1 s */
      }
    };
    void holen();
    const t = setInterval(holen, 1000);
    return () => {
      aktiv = false;
      clearInterval(t);
    };
  }, [schluessel]);
  return <Ctx.Provider value={werte}>{children}</Ctx.Provider>;
}

export function useVerfuegbar(id: string) {
  return React.useContext(Ctx)[id] ?? null;
}

export function VerfuegbarBadge({ id, gesamt }: { id: string; gesamt: number }) {
  const frei = useVerfuegbar(id);
  if (frei === null) return <Badge variant="outline">…</Badge>;
  if (frei === 0) return <Badge variant="destructive">Gerade alles vergeben</Badge>;
  return (
    <Badge variant="secondary" className="tabular-nums">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-primary" />
      </span>
      {frei} / {gesamt} frei
    </Badge>
  );
}
