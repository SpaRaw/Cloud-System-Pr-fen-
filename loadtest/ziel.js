// k6-Lasttest gegen das Zielsystem: echter Kaufablauf mit Warteschlange.
//   docker run --rm -i --network host -e BASE=http://localhost:3000 -e EVENT_ID=<uuid> grafana/k6 run - < loadtest/ziel.js
// Standard: 200 virtuelle Käufer, 2 Minuten. Jede Iteration ist eine neue Session (neuer Cookie).
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

const BASE = __ENV.BASE || "http://localhost:3000";
const EVENT = __ENV.EVENT_ID;
const tickets = new Counter("tickets_bestaetigt");
const bestellungen = new Counter("bestellungen_bestaetigt");
const ausverkauft = new Counter("ausverkauft");
const abgelaufen = new Counter("abgelaufen");
const gewartet = new Counter("in_warteschlange");

export const options = {
  scenarios: {
    kaeufer: { executor: "constant-vus", vus: Number(__ENV.VUS || 200), duration: __ENV.DAUER || "2m", gracefulStop: "60s" },
  },
  thresholds: { http_req_failed: ["rate<0.01"] },
};

const json = { headers: { "content-type": "application/json" } };
const post = (a, body) => http.post(`${BASE}/api/kauf/${a}`, JSON.stringify(Object.assign({ eventId: EVENT }, body)), json);
const status = () => http.get(`${BASE}/api/kauf/status?eventId=${EVENT}`);

let fertig = false;

export default function () {
  if (fertig) return sleep(5);
  http.cookieJar().clear(BASE); // neue Session
  const anzahl = 1 + Math.floor(Math.random() * 2);
  let r = post("reservieren", { anzahl });
  check(r, { "reservieren 200": (x) => x.status === 200 });
  let s = r.json();
  if (s.zustand === "wartend") gewartet.add(1);
  const start = Date.now();
  while (s.zustand === "wartend" && Date.now() - start < 150000) {
    sleep(1);
    r = status();
    if (r.status === 200) s = r.json();
  }
  if (s.zustand === "ausverkauft") {
    ausverkauft.add(1);
    fertig = true;
    return;
  }
  if (s.zustand !== "reserviert") return;

  sleep(2 + Math.random() * 6); // Formular ausfüllen
  r = post("bestellen", { name: `Last ${__VU}-${__ITER}`, email: `vu${__VU}@last.test` });
  if (r.json().zustand !== "zahlung") return abgelaufen.add(1);
  sleep(5); // Zahlungs-Spinner
  r = post("bestaetigen", {});
  const b = r.json();
  if (check(b, { "verkauft": (x) => x.zustand === "verkauft" })) {
    tickets.add(b.plaetze.length);
    bestellungen.add(1);
  }
}
