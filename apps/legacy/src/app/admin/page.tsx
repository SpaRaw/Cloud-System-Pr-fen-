import { PlusIcon } from "lucide-react";
import { buttonVariants } from "@kw/ui/components/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@kw/ui/components/table";
import { datum, euro } from "@kw/core/format";
import { alleEvents } from "@/lib/events";

export const dynamic = "force-dynamic";

export default async function Admin() {
  const events = await alleEvents();
  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Events verwalten</h1>
        <a href="/admin/neu" className={buttonVariants()}><PlusIcon /> Neues Event</a>
      </div>
      <Table>
        <TableHeader>
          <TableRow><TableHead>Name</TableHead><TableHead>Datum</TableHead><TableHead>Preis</TableHead><TableHead>Verkauft</TableHead><TableHead /></TableRow>
        </TableHeader>
        <TableBody>
          {events.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="font-medium">{e.name}</TableCell>
              <TableCell>{datum(new Date(e.datum))}</TableCell>
              <TableCell>{euro(e.preis_cent)}</TableCell>
              <TableCell>{e.verkauft} / {e.gesamt}</TableCell>
              <TableCell className="text-right"><a className="text-primary underline" href={`/admin/${e.id}`}>Bearbeiten</a></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
