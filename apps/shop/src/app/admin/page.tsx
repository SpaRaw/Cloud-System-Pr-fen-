import { PlusIcon } from "lucide-react";
import { Badge } from "@kw/ui/components/badge";
import { buttonVariants } from "@kw/ui/components/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@kw/ui/components/table";
import { datum, euro } from "@kw/core/format";
import { ladeEvents } from "@kw/db";

export const dynamic = "force-dynamic";

export default async function Admin() {
  const events = await ladeEvents();
  const jetzt = Date.now();
  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Events verwalten</h1>
        <a href="/admin/neu" className={buttonVariants()}><PlusIcon /> Neues Event</a>
      </div>
      <Table>
        <TableHeader>
          <TableRow><TableHead>Name</TableHead><TableHead>Datum</TableHead><TableHead>Preis</TableHead><TableHead>Verkauft</TableHead><TableHead>Verkauf</TableHead><TableHead /></TableRow>
        </TableHeader>
        <TableBody>
          {events.map((e) => {
            const laeuft = e.verkaufAb.getTime() <= jetzt && e.verkaufBis.getTime() >= jetzt;
            return (
              <TableRow key={e.id}>
                <TableCell className="font-medium">{e.name}</TableCell>
                <TableCell>{datum(e.datum)}</TableCell>
                <TableCell>{euro(e.preisCent)}</TableCell>
                <TableCell className="tabular-nums">{e.verkauft} / {e.gesamt}</TableCell>
                <TableCell>{laeuft ? <Badge>läuft</Badge> : e.verkaufAb.getTime() > jetzt ? <Badge variant="outline">ab {datum(e.verkaufAb)}</Badge> : <Badge variant="secondary">beendet</Badge>}</TableCell>
                <TableCell className="text-right"><a className="text-primary underline" href={`/admin/${e.id}`}>Bearbeiten</a></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
