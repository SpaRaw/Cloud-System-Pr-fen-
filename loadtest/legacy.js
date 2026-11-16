// k6-Lasttest gegen das Altsystem: 200 parallele Käufer, alles synchron in einer Anfrage.
//   docker run --rm -i --network host -e BASE=http://localhost:3001 -e EVENT_ID=<uuid> grafana/k6 run - < loadtest/legacy.js
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

const BASE = __ENV.BASE || "http://localhost:3001";
const EVENT = __ENV.EVENT_ID;
const tickets = new Counter("tickets_bestaetigt");
const ausverkauft = new Counter("ausverkauft");

export const options = {
  scenarios: { kaeufer: { executor: "constant-vus", vus: Number(__ENV.VUS || 200), duration: __ENV.DAUER || "2m" } },
};

let fertig = false;
export default function () {
  if (fertig) return sleep(5);
  const anzahl = 1 + Math.floor(Math.random() * 2);
  const r = http.post(`${BASE}/api/kaufen`, JSON.stringify({ eventId: EVENT, anzahl, name: `Last ${__VU}`, email: `vu${__VU}@last.test` }), {
    headers: { "content-type": "application/json" },
    timeout: "60s",
  });
  if (r.status === 200) tickets.add(anzahl);
  if (r.status === 409) {
    ausverkauft.add(1);
    fertig = true;
  }
  check(r, { "200 oder 409": (x) => x.status === 200 || x.status === 409 });
  sleep(1);
}
