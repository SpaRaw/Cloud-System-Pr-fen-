import { eq } from "drizzle-orm";
import { getDb, ticket } from "@kw/db";
import { blobLesen, CONTAINER_TICKETS } from "@kw/core/storage";

// Ticket-PDF aus Blob Storage (privater Container, Zugriff per Managed Identity).
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t] = await getDb().select({ pfad: ticket.pdfPfad }).from(ticket).where(eq(ticket.bestellungId, id)).limit(1);
  if (!t?.pfad) return new Response("Noch nicht fertig", { status: 404 });
  const datei = await blobLesen(CONTAINER_TICKETS, t.pfad);
  if (!datei) return new Response("Nicht gefunden", { status: 404 });
  return new Response(new Uint8Array(datei.daten), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="tickets-${id}.pdf"` } });
}
