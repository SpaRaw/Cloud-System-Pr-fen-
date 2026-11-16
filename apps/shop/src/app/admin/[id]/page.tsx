import { notFound } from "next/navigation";
import { EventFormular } from "@kw/ui/components/kw/event-formular";
import { zuLokal } from "@kw/core/format";
import { ladeEvent } from "@kw/db";
import { eventAendern } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function Bearbeiten({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const e = await ladeEvent(id);
  if (!e) notFound();
  const gesperrt = e.verkaufAb.getTime() <= Date.now();
  return (
    <div className="grid max-w-2xl gap-6">
      <h1 className="text-3xl font-bold">{e.name} bearbeiten</h1>
      <EventFormular
        action={eventAendern.bind(null, id, gesperrt)}
        mitVerkauf
        kontingentGesperrt={gesperrt}
        werte={{ name: e.name, beschreibung: e.beschreibung, datum: zuLokal(e.datum), preisEuro: (e.preisCent / 100).toFixed(2), kontingent: e.gesamt, bildUrl: e.bildUrl, verkaufAb: zuLokal(e.verkaufAb), verkaufBis: zuLokal(e.verkaufBis) }}
      />
    </div>
  );
}
