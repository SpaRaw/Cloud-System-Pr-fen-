import { EventKarte } from "@kw/ui/components/kw/event-karte";
import { datum, euro } from "@kw/core/format";
import { ladeEvents } from "@kw/db";
import { VerfuegbarBadge, VerfuegbarProvider } from "@/components/live-verfuegbar";

export const dynamic = "force-dynamic";

export default async function Shop() {
  const events = await ladeEvents();
  const start = Object.fromEntries(events.map((e) => [e.id, Math.max(0, e.gesamt - e.verkauft)]));
  return (
    <VerfuegbarProvider ids={events.map((e) => e.id)} start={start}>
      <div className="grid gap-6">
        <div>
          <h1 className="text-3xl font-bold">Festivals</h1>
          <p className="text-muted-foreground">Freie Tickets aktualisieren sich live.</p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((e) => (
            <EventKarte
              key={e.id}
              href={`/shop/${e.id}`}
              e={{ id: e.id, name: e.name, beschreibung: e.beschreibung, bildUrl: e.bildUrl, datumText: datum(e.datum), preisText: euro(e.preisCent) }}
              verfuegbar={<VerfuegbarBadge id={e.id} gesamt={e.gesamt} />}
            />
          ))}
        </div>
      </div>
    </VerfuegbarProvider>
  );
}
