import { notFound } from "next/navigation";
import { EventFormular } from "@kw/ui/components/kw/event-formular";
import { zuLokal } from "@kw/core/format";
import { einEvent } from "@/lib/events";
import { eventAendern } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function Bearbeiten({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const e = await einEvent(id);
  if (!e) notFound();
  return (
    <div className="grid max-w-2xl gap-6">
      <h1 className="text-3xl font-bold">{e.name} bearbeiten</h1>
      <EventFormular
        action={eventAendern.bind(null, id)}
        werte={{ name: e.name, beschreibung: e.beschreibung, datum: zuLokal(new Date(e.datum)), preisEuro: (e.preis_cent / 100).toFixed(2), kontingent: e.gesamt, bildUrl: e.bild_url }}
      />
    </div>
  );
}
