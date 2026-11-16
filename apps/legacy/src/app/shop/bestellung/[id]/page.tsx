import { notFound } from "next/navigation";
import type { RowDataPacket } from "mysql2";
import { CheckCircle2Icon } from "lucide-react";
import { getPool } from "@kw/db";
import { euro } from "@kw/core/format";
import { Card, CardContent, CardHeader, CardTitle } from "@kw/ui/components/card";

export const dynamic = "force-dynamic";

export default async function Bestellung({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT b.*, e.name AS event_name FROM bestellung b JOIN event e ON e.id = b.event_id WHERE b.id = ?",
    [id],
  );
  const b = rows[0];
  if (!b) notFound();
  const [tickets] = await getPool().query<RowDataPacket[]>("SELECT platz_nr FROM ticket WHERE bestellung_id = ? ORDER BY platz_nr", [id]);
  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CheckCircle2Icon className="size-8 text-primary" />
        <CardTitle>Danke, {b.name}!</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <p>{b.anzahl} Ticket(s) für <strong>{b.event_name}</strong>, zusammen {euro(b.summe_cent)}.</p>
        <p>Plätze: {tickets.map((t) => t.platz_nr).join(", ")}</p>
        <p className="text-muted-foreground">Bestellnummer {b.id}</p>
        <a className="text-primary underline" href={`/api/tickets/${b.id}`}>Tickets als PDF</a>
      </CardContent>
    </Card>
  );
}
