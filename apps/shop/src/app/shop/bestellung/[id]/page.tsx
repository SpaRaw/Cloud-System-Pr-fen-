import { eq } from "drizzle-orm";
import { CheckCircle2Icon, MailIcon } from "lucide-react";
import { bestellung, event, getDb, ticket } from "@kw/db";
import { euro } from "@kw/core/format";
import { Card, CardContent, CardHeader, CardTitle } from "@kw/ui/components/card";
import { Spinner } from "@kw/ui/components/spinner";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";

export default async function Bestellung({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const [b] = await db
    .select({ name: bestellung.name, email: bestellung.email, anzahl: bestellung.anzahl, summe: bestellung.summeCent, status: bestellung.status, eventName: event.name })
    .from(bestellung)
    .innerJoin(event, eq(event.id, bestellung.eventId))
    .where(eq(bestellung.id, id));

  if (!b) {
    // Die Queue-Function hat die Bestellung noch nicht in MySQL geschrieben.
    return (
      <Card className="mx-auto max-w-lg">
        <AutoRefresh sekunden={2} />
        <CardHeader>
          <CheckCircle2Icon className="size-8 text-primary" />
          <CardTitle>Bestellung angenommen</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p>Deine Tickets sind sicher. Wir erzeugen gerade die PDFs, die Mail kommt in wenigen Minuten.</p>
          <p className="flex items-center gap-2 text-muted-foreground"><Spinner /> In Verarbeitung …</p>
          <p className="text-xs text-muted-foreground">Bestellnummer {id}</p>
        </CardContent>
      </Card>
    );
  }

  const tickets = await db.select({ platz: ticket.platzNr, pdf: ticket.pdfPfad }).from(ticket).where(eq(ticket.bestellungId, id));
  const fertig = b.status === "versendet";
  return (
    <Card className="mx-auto max-w-lg">
      {!fertig && <AutoRefresh sekunden={2} />}
      <CardHeader>
        <CheckCircle2Icon className="size-8 text-primary" />
        <CardTitle>{b.status === "konflikt" ? "Bestellung konnte nicht ausgeführt werden" : `Danke, ${b.name}!`}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {b.status === "konflikt" ? (
          <p>Ein Platz war bereits vergeben. Es wurde nichts berechnet.</p>
        ) : (
          <>
            <p>{b.anzahl} Ticket(s) für <strong>{b.eventName}</strong>, zusammen {euro(b.summe)}.</p>
            <p>Ticketnummern: {tickets.map((t) => t.platz).sort((a, c) => a - c).join(", ")}</p>
            {fertig ? (
              <>
                <p className="flex items-center gap-2"><MailIcon className="size-4 text-primary" /> Mail an {b.email} ist raus.</p>
                <a className="text-primary underline" href={`/api/tickets/${id}`}>Tickets als PDF</a>
              </>
            ) : (
              <p className="flex items-center gap-2 text-muted-foreground"><Spinner /> PDF und Mail werden erstellt …</p>
            )}
          </>
        )}
        <p className="text-xs text-muted-foreground">Bestellnummer {id}</p>
      </CardContent>
    </Card>
  );
}
