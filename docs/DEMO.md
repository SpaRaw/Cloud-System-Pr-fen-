# Pflicht-Nachweise: was zeigen, womit, welcher Screenshot

| # | Nachweis | So zeigst du ihn | Screenshot aus dem Azure-Abo |
| - | -------- | ---------------- | ---------------------------- |
| 1 | Altsystem nachgestellt | `docker compose --profile legacy up -d --build`, Shop auf `localhost:3001` | – (lokal), Terminal + Browser |
| 2 | Datenbank migriert | `./scripts/migrieren.sh` – Zählabfrage vorher/nachher | MySQL Flexible Server, Datenbank `klangwerk` |
| 3 | Shop als PaaS | Container App `shop-klangwerk`, Konfiguration nur über Secrets/Umgebung | Container App → Secrets (geschwärzt), Revisionen |
| 4 | Kauf entkoppelt | Kauf im Shop → Queue `bestellungen` → Function `verarbeiten` → PDF in Blob `tickets` | Storage → Queue, Blob-Container mit PDF, Function-Log |
| 5 | Lasttest | `./loadtest/run.sh ziel` (200 Käufer, 500 Tickets, 2 min) | Container-Apps-Metriken (Replikas), Ausgabe des Skripts |
| 6 | Idempotenz | `POST /api/test/idempotenz` (Function-Key) | Antwort + Log der zwei Zustellungen |

Dazu laut Aufgabe: Ressourcengruppe `rg-pruefung-<nachname>`, Budget mit Alarmen, Preisrechner-Export.

## Lokale Ergebnisse (16.11.2026, Docker in der Entwicklungsumgebung)

Gleiches Skript, gleiche Last: 200 virtuelle Käufer, je 1–2 Tickets, 2 Minuten, 500 Tickets Kontingent.

| | Altsystem | Zielsystem (lokal emuliert) |
| - | - | - |
| Verkaufte Tickets | **3.752** | **500** |
| Doppelt vergebene Plätze | 3.668 | 0 |
| Bestellungen verloren | 0 | 0 (k6 bestätigt 500 = MySQL 500) |
| Antwortzeit Mittel / p95 | 9,2 s / 10,9 s | 0,33 s / 0,69 s |
| Über die Warteschlange gekauft | – | 196 Käufer |

Idempotenz: dieselbe Nachricht 2× in die Queue → 1 Bestellung, 1 Ticket, 1 Mail. Die zweite Zustellung
meldet „wird parallel verarbeitet“ bzw. „schon versendet“.

## Live-Demo (ca. 6 Minuten)

1. **Altsystem, 30 s**: Lasttest-Ergebnis zeigen (`✘ ÜBERVERKAUFT`). Das ist der 3. März im Kleinen.
2. **Shop in Azure, 1 min**: `/shop`, Zähler läuft live. Event öffnen, 2 Tickets reservieren, Countdown.
3. **Warteschlange, 1,5 min**: Event „Mini-Demo“ mit 2 Tickets im Admin anlegen (Entra-Login zeigen).
   Browser A reserviert beide, Browser B (privates Fenster) landet auf Platz 1 mit geschätzter Wartezeit.
   A bricht ab → B ist sofort dran.
4. **Entkopplung, 1,5 min**: B bestellt, Spinner, Abbrechen-Knopf erwähnen. Bestätigungsseite „in
   Verarbeitung“, dann Mail (ACS) mit PDF. Im Portal: Blob `tickets/<event>/<bestellung>.pdf`.
5. **Idempotenz, 1 min**: `curl` auf den Test-Endpunkt, Antwort `tickets: 1`.
6. **Lasttest, 30 s**: Ergebnis des Laufs gegen Azure (vorher aufgezeichnet) mit `✔`.

Rückfallebene: Screenshots in `docs/screens/` bzw. aufgezeichnetes Video. Lokal lässt sich alles mit `docker compose up -d` proben (siehe `docs/LOKAL.md`).

## Antworten auf die typischen Fragen

**„Die Function stürzt nach dem Speichern, aber vor dem Bestätigen ab. Was passiert?“**
Die Nachricht wird nicht gelöscht und kommt nach dem Visibility-Timeout wieder. Beim zweiten Mal schlägt das
Einfügen der Bestellung am Primärschlüssel fehl (`ER_DUP_ENTRY`), die Function erkennt „schon vorhanden“ und
erzeugt nur noch PDF und Mail. Ein zweites Ticket entsteht nie. Im ungünstigsten Fall (Absturz zwischen Mail
und Status-Update) geht die Mail zweimal raus: at-least-once. Nach 5 Fehlversuchen landet die Nachricht in
`bestellungen-poison`.

**„Der Vorverkauf wird von 10 auf 2 Minuten verdichtet. Was skaliert, was bricht?“**
Skaliert: Shop (Container Apps, HTTP-Regel), Functions (Queue-Länge per KEDA), Queue (praktisch unbegrenzt).
Engpass: Redis ist ein einzelner Container (1 Replik). Lua-Skripte sind O(1) bis O(Warteschlange), ein Redis
schafft zehntausende Operationen pro Sekunde, das 1-s-Polling von 200.000 Besuchern aber nicht mehr. Dann:
Polling-Intervall dynamisch erhöhen (2–5 s), Warteraum vor dem Shop, oder verwalteter Redis mit mehr CPU.
MySQL ist entlastet: Es sieht nur die bestätigten Bestellungen in Queue-Geschwindigkeit, nicht den Ansturm.
Die Mail-Frist (15 min) hält, solange die Queue schneller abgebaut wird, als sie wächst.

**„Ein Bot ruft deine Kauf-API eine Million Mal auf. Wer zahlt?“**
Jede Anfrage trifft zuerst das Rate-Limit in Redis (10/s pro Session, konfigurierbar pro IP) und kostet nur einen
`INCR`. Eine Session kann höchstens eine Reservierung bzw. einen Platz in der Schlange halten, also kann ein
Bot Tickets höchstens 2 Minuten blockieren. Bezahlt wird trotzdem: Container-Apps-Requests und
Rechenzeit. Wer's ernst meint, stellt Front Door mit WAF und Bot-Schutz davor (Kosten auf Backup-Folie).

**„Warum Redis im Container und nicht verwaltet?“**
Kosten: Der kleinste verwaltete Redis kostet um 16 $/Monat, der Container ein paar Cent am Tag. Weil MySQL die
Quelle der Wahrheit ist, ist der Verlust bei einem Neustart verkraftbar: Offene Reservierungen (max. 2 min)
verfallen, alles andere baut sich aus MySQL wieder auf. Restrisiko: Bestellungen, die gerade in der Queue
stecken, sind nach einem Neustart noch nicht in MySQL. Greift dann jemand denselben Platz, verhindert der
Unique-Key das doppelte Ticket, und die Bestellung wird als `konflikt` markiert.
