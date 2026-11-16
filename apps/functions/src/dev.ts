// Lokaler Ersatz für die Functions-Runtime: HTTP-Server + Timer + Queue-Polling gegen Azurite.
// Gleiche Handler wie in Azure, nur ohne `func`-CLI.   pnpm dev:functions  ->  http://localhost:7071
import { createServer } from "node:http";
import { bestellQueue } from "@kw/core";
import { http, queueVerarbeiten, timerAufraeumen, type Anfrage } from "./handlers";

const routen: Record<string, (r: Anfrage) => ReturnType<(typeof http)["status"]>> = {
  "POST /api/kauf/reservieren": http.reservieren,
  "GET /api/kauf/status": http.status,
  "POST /api/kauf/bestellen": http.bestellen,
  "POST /api/kauf/bestaetigen": http.bestaetigen,
  "POST /api/kauf/abbrechen": http.abbrechen,
  "GET /api/kauf/verfuegbar": http.verfuegbar,
};

const port = Number(process.env.PORT ?? 7071);
createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const fn = routen[`${req.method} ${url.pathname}`];
  if (!fn) {
    res.writeHead(404).end();
    return;
  }
  let text = "";
  for await (const chunk of req) text += chunk;
  const cookies = new Map(
    (req.headers.cookie ?? "").split(";").map((c) => {
      const [k, ...v] = c.trim().split("=");
      return [k, v.join("=")] as [string, string];
    }),
  );
  const r = await fn({
    method: req.method ?? "GET",
    query: url.searchParams,
    body: text ? JSON.parse(text) : undefined,
    cookie: (n) => cookies.get(n),
    ip: String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0],
  });
  res.writeHead(r.status, { "content-type": "application/json", "cache-control": "no-store", ...(r.cookies ? { "set-cookie": r.cookies } : {}), ...(r.headers ?? {}) });
  res.end(JSON.stringify(r.json));
}).listen(port, () => console.log(`Functions (dev) auf http://localhost:${port}`));

// Timer wie in Azure: alle 5 s
setInterval(() => timerAufraeumen().catch((e) => console.error("Timer", e)), 5000);

// Queue-Trigger nachgebaut: Nachrichten holen, verarbeiten, erst danach löschen (at-least-once).
async function queueSchleife() {
  const q = bestellQueue();
  await q.createIfNotExists();
  for (;;) {
    try {
      const { receivedMessageItems } = await q.receiveMessages({ numberOfMessages: 16, visibilityTimeout: 30 });
      await Promise.all(
        receivedMessageItems.map(async (m) => {
          try {
            await queueVerarbeiten(Buffer.from(m.messageText, "base64").toString("utf8"));
            await q.deleteMessage(m.messageId, m.popReceipt);
          } catch (e) {
            console.error(`Nachricht ${m.messageId} fehlgeschlagen (Zustellung ${m.dequeueCount}), kommt wieder`, e);
          }
        }),
      );
      if (!receivedMessageItems.length) await new Promise((r) => setTimeout(r, 500));
    } catch (e) {
      console.error("Queue", e);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
void queueSchleife();
