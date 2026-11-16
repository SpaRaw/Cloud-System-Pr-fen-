// Registrierung bei Azure Functions (Node-Programmiermodell v4).
import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { http, queueVerarbeiten, timerAufraeumen, type Anfrage, type Antwort } from "./handlers";
import { idempotenzTest } from "./idempotenz-test";

function cookieLeser(header: string | null) {
  const map = new Map<string, string>();
  for (const teil of (header ?? "").split(";")) {
    const [k, ...v] = teil.trim().split("=");
    if (k) map.set(k, v.join("="));
  }
  return (name: string) => map.get(name);
}

function adapter(fn: (r: Anfrage) => Promise<Antwort>) {
  return async (req: HttpRequest): Promise<HttpResponseInit> => {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : undefined;
    const r = await fn({
      method: req.method,
      query: req.query,
      body,
      cookie: cookieLeser(req.headers.get("cookie")),
      ip: (req.headers.get("x-forwarded-for") ?? "unbekannt").split(",")[0].trim(),
    });
    const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store", ...(r.headers ?? {}) });
    for (const c of r.cookies ?? []) headers.append("set-cookie", c);
    return { status: r.status, body: JSON.stringify(r.json), headers };
  };
}

const routen: [string, "GET" | "POST", keyof typeof http][] = [
  ["kauf/reservieren", "POST", "reservieren"],
  ["kauf/status", "GET", "status"],
  ["kauf/bestellen", "POST", "bestellen"],
  ["kauf/bestaetigen", "POST", "bestaetigen"],
  ["kauf/abbrechen", "POST", "abbrechen"],
  ["kauf/verfuegbar", "GET", "verfuegbar"],
];
for (const [route, methode, name] of routen) {
  app.http(name, { route, methods: [methode], authLevel: "anonymous", handler: adapter(http[name]) });
}

app.timer("aufraeumen", {
  schedule: "*/5 * * * * *",
  handler: async (_t, ctx: InvocationContext) => timerAufraeumen((m) => ctx.log(m)),
});

app.storageQueue("verarbeiten", {
  queueName: process.env.QUEUE_NAME ?? "bestellungen",
  connection: "BestellQueue",
  handler: async (nachricht: unknown, ctx: InvocationContext) => {
    const ergebnis = await queueVerarbeiten(nachricht, (m) => ctx.log(m));
    ctx.log(`Ergebnis: ${ergebnis} (Zustellung Nr. ${ctx.triggerMetadata?.dequeueCount ?? "?"})`);
  },
});

// Nachweis 6 in Azure: POST /api/test/idempotenz?eventId=<uuid>&code=<Function-Key>
// authLevel "function": ohne Schlüssel 401, damit kein Fremder Testbestellungen auslösen kann.
app.http("idempotenzTest", {
  route: "test/idempotenz",
  methods: ["POST"],
  authLevel: "function",
  handler: async (req, ctx) => {
    const eventId = req.query.get("eventId") ?? "";
    try {
      return { jsonBody: await idempotenzTest(eventId, (m) => ctx.log(m)) };
    } catch (e) {
      return { status: 400, jsonBody: { fehler: (e as Error).message } };
    }
  },
});
