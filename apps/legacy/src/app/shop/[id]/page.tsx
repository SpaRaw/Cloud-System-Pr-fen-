import { notFound, redirect } from "next/navigation";
import { Button } from "@kw/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@kw/ui/components/card";
import { Input } from "@kw/ui/components/input";
import { Label } from "@kw/ui/components/label";
import { datum, euro } from "@kw/core/format";
import { einEvent } from "@/lib/events";
import { AusverkauftFehler, kaufen } from "@/lib/kaufen";

export const dynamic = "force-dynamic";

export default async function EventSeite({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fehler?: string }> }) {
  const { id } = await params;
  const { fehler } = await searchParams;
  const e = await einEvent(id);
  if (!e) notFound();
  const frei = Math.max(0, e.gesamt - e.verkauft);

  async function kaufAktion(fd: FormData) {
    "use server";
    let ziel: string;
    try {
      const r = await kaufen({ eventId: id, anzahl: Number(fd.get("anzahl")), name: String(fd.get("name")), email: String(fd.get("email")) });
      ziel = `/shop/bestellung/${r.bestellungId}`;
    } catch (err) {
      ziel = `/shop/${id}?fehler=${encodeURIComponent(err instanceof AusverkauftFehler ? "Leider ausverkauft." : "Kauf fehlgeschlagen.")}`;
    }
    redirect(ziel);
  }

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_360px]">
      <div className="grid gap-4">
        {e.bild_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={e.bild_url} alt="" className="aspect-video w-full rounded-xl object-cover" />
        )}
        <h1 className="text-3xl font-bold">{e.name}</h1>
        <p className="text-muted-foreground">{datum(new Date(e.datum))}</p>
        <p className="whitespace-pre-line">{e.beschreibung}</p>
      </div>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>{euro(e.preis_cent)} pro Ticket</CardTitle>
          <p className="text-sm text-muted-foreground">{frei} von {e.gesamt} frei</p>
        </CardHeader>
        <CardContent>
          {fehler && <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{fehler}</p>}
          <form action={kaufAktion} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="anzahl">Anzahl</Label>
              <Input id="anzahl" name="anzahl" type="number" min={1} max={4} defaultValue={1} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">E-Mail</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <Button type="submit" disabled={!frei}>Kaufen</Button>
            <p className="text-xs text-muted-foreground">Der Kauf dauert einige Sekunden: Kontingent, Buchung, PDF und Mail laufen in einer Anfrage.</p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
