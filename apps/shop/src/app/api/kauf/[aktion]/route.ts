// Backend-for-Frontend: Der Browser spricht nur mit dem Shop (gleiche Domain, Session-Cookie),
// der Shop reicht den Kaufpfad 1:1 an die Functions weiter. FUNCTIONS_URL kommt zur Laufzeit aus der Umgebung.
const erlaubt = new Set(["reservieren", "status", "bestellen", "bestaetigen", "abbrechen", "verfuegbar"]);

async function weiter(req: Request, aktion: string) {
  if (!erlaubt.has(aktion)) return new Response(null, { status: 404 });
  const basis = process.env.FUNCTIONS_URL ?? "http://localhost:7071";
  const url = new URL(req.url);
  const ziel = `${basis}/api/kauf/${aktion}${url.search}`;
  const headers = new Headers({ "content-type": "application/json" });
  const cookie = req.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  // Den letzten Eintrag hat der Ingress von Container Apps gesetzt, die vorderen kann der Client fälschen.
  const xff = (req.headers.get("x-forwarded-for") ?? "unbekannt").split(",").map((s) => s.trim());
  headers.set("x-forwarded-for", xff[xff.length - 1]);
  if (process.env.FUNCTIONS_KEY) headers.set("x-functions-key", process.env.FUNCTIONS_KEY);
  const r = await fetch(ziel, { method: req.method, headers, body: req.method === "POST" ? await req.text() : undefined, cache: "no-store" });
  const aus = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  for (const c of r.headers.getSetCookie()) aus.append("set-cookie", c);
  const ra = r.headers.get("retry-after");
  if (ra) aus.set("retry-after", ra);
  return new Response(await r.text(), { status: r.status, headers: aus });
}

export async function GET(req: Request, { params }: { params: Promise<{ aktion: string }> }) {
  return weiter(req, (await params).aktion);
}
export async function POST(req: Request, { params }: { params: Promise<{ aktion: string }> }) {
  return weiter(req, (await params).aktion);
}
