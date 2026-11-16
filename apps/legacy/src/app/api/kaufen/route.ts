import { AusverkauftFehler, kaufen } from "@/lib/kaufen";

// JSON-Schnittstelle für den Lasttest (k6). Gleicher Code wie das Formular.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    const r = await kaufen({ eventId: String(body.eventId), anzahl: Number(body.anzahl ?? 1), name: String(body.name ?? "Lasttest"), email: String(body.email ?? "last@test.invalid") });
    return Response.json(r);
  } catch (e) {
    if (e instanceof AusverkauftFehler) return Response.json({ fehler: "ausverkauft" }, { status: 409 });
    console.error(e);
    return Response.json({ fehler: "fehlgeschlagen" }, { status: 500 });
  }
}
