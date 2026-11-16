import { notFound } from "next/navigation";
import { CalendarIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@kw/ui/components/card";
import { datum, euro } from "@kw/core/format";
import { ladeEvent } from "@kw/db";
import { KaufFlow } from "@/components/kauf-flow";
import { VerfuegbarBadge, VerfuegbarProvider } from "@/components/live-verfuegbar";

export const dynamic = "force-dynamic";

export default async function EventSeite({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const e = await ladeEvent(id);
  if (!e) notFound();
  const jetzt = Date.now();
  const vorVerkauf = e.verkaufAb.getTime() > jetzt;
  const nachVerkauf = e.verkaufBis.getTime() < jetzt;
  return (
    <VerfuegbarProvider ids={[e.id]} start={{ [e.id]: Math.max(0, e.gesamt - e.verkauft) }}>
      <div className="grid gap-8 md:grid-cols-[1fr_380px]">
        <div className="grid h-fit gap-4">
          {e.bildUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={e.bildUrl} alt="" className="aspect-video w-full rounded-xl object-cover" />
          ) : (
            <div className="aspect-video w-full rounded-xl bg-gradient-to-br from-primary/80 to-chart-3/70" />
          )}
          <h1 className="text-3xl font-bold">{e.name}</h1>
          <p className="flex items-center gap-2 text-muted-foreground">
            <CalendarIcon className="size-4" /> {datum(e.datum)}
          </p>
          <p className="whitespace-pre-line">{e.beschreibung}</p>
        </div>
        <Card className="h-fit md:sticky md:top-6">
          <CardHeader>
            <CardTitle>{euro(e.preisCent)} pro Ticket</CardTitle>
            <VerfuegbarBadge id={e.id} gesamt={e.gesamt} />
          </CardHeader>
          <CardContent>
            {vorVerkauf ? (
              <p className="text-sm">Der Vorverkauf startet am <strong>{datum(e.verkaufAb)}</strong>.</p>
            ) : nachVerkauf ? (
              <p className="text-sm text-muted-foreground">Der Vorverkauf ist beendet.</p>
            ) : (
              <KaufFlow eventId={e.id} preisText={euro(e.preisCent)} reservierungSek={Number(process.env.RESERVIERUNG_MS ?? 120_000) / 1000} />
            )}
          </CardContent>
        </Card>
      </div>
    </VerfuegbarProvider>
  );
}
