import { EventKarte } from "@kw/ui/components/kw/event-karte";
import { Badge } from "@kw/ui/components/badge";
import { datum, euro } from "@kw/core/format";
import { alleEvents } from "@/lib/events";

export const dynamic = "force-dynamic";

export default async function Shop() {
  const events = await alleEvents();
  return (
    <div className="grid gap-6">
      <h1 className="text-3xl font-bold">Festivals</h1>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {events.map((e) => {
          const frei = Math.max(0, e.gesamt - e.verkauft);
          return (
            <EventKarte
              key={e.id}
              href={`/shop/${e.id}`}
              e={{ id: e.id, name: e.name, beschreibung: e.beschreibung, bildUrl: e.bild_url, datumText: datum(new Date(e.datum)), preisText: euro(e.preis_cent) }}
              verfuegbar={<Badge variant={frei ? "secondary" : "destructive"}>{frei ? `${frei} frei` : "Ausverkauft"}</Badge>}
            />
          );
        })}
      </div>
    </div>
  );
}
