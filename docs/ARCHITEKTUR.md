# KlangWerk Tickets – Architektur und Entscheidungen

Stand: 16.11.2026. Ergebnis des Design-Interviews, vom Auftraggeber abgenommen.

## Ziel

Vom überlasteten Einzelserver (Node-Monolith + MySQL) zu einer elastischen Plattform in Azure, die einen
Vorverkaufsansturm (200.000 Besucher in 10 Minuten, 40.000 Tickets) ohne Überverkauf übersteht und im
Normalbetrieb unter 150 €/Monat kostet.

## Altsystem (Ist-Zustand, nachgestellt)

- `apps/legacy`: Next.js-Monolith. Seiten, Logik, DB-Zugriff, PDF und Mail in **einem** Prozess.
- Der Kauf läuft synchron in **einer** Anfrage: Kontingent lesen → buchen → PDF erzeugen → Mail senden.
- **Absichtlich ohne Sperre** (read-then-write), damit parallele Käufe dasselbe Kontingent lesen und der
  Doppelverkauf im Lasttest sichtbar wird.
- Läuft lokal mit Docker Compose: MySQL 8, Mailpit (SMTP-Fänger).
- Testdaten erfunden: mindestens ein Event mit 500 Tickets.

## Zielsystem (Azure)

```
Browser ──► Container Apps: apps/shop (Next.js, /shop, Buchungsflow, /admin mit Easy Auth / Entra ID)
   │                │
   │  Polling 1 s   ▼
   └──────► Functions (gleiche Container-Apps-Umgebung)
              reservieren · bestellen · bezahlen-bestaetigen · abbrechen · warteschlange · verfuegbar
              aufraeumen (Timer) · verarbeiten (Queue-Trigger) · init (Redis-Hash aufbauen)
                │                │                         │
                ▼                ▼                         ▼
        Redis (Container,   Storage Queue ──► verarbeiten ──► MySQL Flexible (Quelle der Wahrheit)
        1 Replica)                              │──► Blob Storage (Ticket-PDF, Event-Bilder)
                                                └──► Azure Communication Services Email
```

| Komponente       | 6R              | Azure-Dienst                                      |
| ---------------- | --------------- | ------------------------------------------------- |
| Shop             | Refactor        | Container Apps (Revisions → Updates ohne Ausfall) |
| Kaufverarbeitung | Refactor        | Azure Functions in Container Apps + Storage Queue |
| Datenbank        | Replatform      | Azure Database for MySQL Flexible Server          |
| PDF-Erzeugung    | Refactor        | Function `verarbeiten` (`pdf-lib` + QR), Blob     |
| Mailversand      | Repurchase      | Azure Communication Services Email                |
| Reservierung     | neu             | Redis als Container (Container Apps)              |

### Entscheidungen im Einzelnen

1. **Primärschlüssel**: immer UUID.
2. **Schema** bleibt gleich (`event`, `kontingent`, `bestellung`, `ticket`), Migration MySQL (Docker) →
   MySQL Flexible per `mysqldump`, Nachweis per Zählabfrage vorher/nachher. Ergänzungen:
   `event.verkauf_ab`, `event.verkauf_bis`, `event.bild_url`, `ticket.platz_nr` mit
   Unique-Key `(event_id, platz_nr)`.
3. **Reservierung in Redis** als Hash pro Event (`event:{id}:plaetze`, Feld = `platz_nr`).
   Zustände: `0` frei · `1` reserviert (2 min) · `2` in Zahlung (60 s Frist) · `3` verkauft.
   Alle Übergänge atomar per Lua-Skript, alles oder nichts, höchstens 4 Tickets pro Bestellung.
4. **MySQL ist die Quelle der Wahrheit.** `verarbeiten` schreibt pro Bestellung sofort `bestellung` und
   `ticket`. Redis hält nur den Live-Zustand.
5. **Neustart von Redis**: Hash wird aus MySQL neu aufgebaut, nur für Events im Verkauf
   (`verkauf_ab ≤ jetzt ≤ verkauf_bis`). Verkaufte Plätze → `3`, alle anderen → `0`. Offene Reservierungen
   gehen verloren (vertretbar bei 2 min).
6. **Doppelte Sicherung gegen Überverkauf**: Lua-Skript in Redis + Unique-Key `(event_id, platz_nr)` in MySQL.
7. **Idempotenz**: Storage Queue liefert mindestens einmal. Die Bestellung trägt ihre UUID von Anfang an;
   `verarbeiten` schreibt mit `INSERT … ON DUPLICATE KEY` bzw. prüft vorhandene Tickets. Zweimal
   eingespielt → genau ein Ticket.
8. **Functions** laufen in derselben Container-Apps-Umgebung wie Redis (ein Netz, KEDA-Skalierung).
9. **Echtzeit-Zähler**: Polling jede Sekunde auf `verfuegbar` (zählt nur Zustand `0`). Push (SignalR) wäre
   bei 200.000 Besuchern zu teuer.
10. **Kunde**: kein Konto, anonyme Session-UUID im Cookie, Mailadresse an der Kasse. Eine Session hat
    höchstens eine Reservierung bzw. einen Platz in der Warteschlange. Rate-Limit pro Session/IP in Redis.
11. **Warteschlange** (wenn kein passender Platz frei ist):
    - First-Fit: Wer zu den frei werdenden Plätzen passt, kommt dran.
    - Absicherung gegen Verhungern: Wer länger als 2 min an der Spitze steht, wird nicht mehr übersprungen.
    - Frei werdende Plätze werden direkt für den Nächsten reserviert, seine 2 min starten.
    - Positionsanzeige mit Schätzung nach der ältesten Reservierung (läuft zuerst ab).
    - Raus nach 10 s ohne Polling. Bei Ausverkauf (alle Plätze `3`) wird die Schlange geschlossen.
12. **Kaufablauf**: reservieren (2 min) → „zahlungspflichtig bestellen“ (1→2, 60 s Frist) → 5 s Spinner mit
    Abbruch → bestätigen (2→3, Nachricht in die Queue) → `verarbeiten`: MySQL, PDF in Blob, Mail.
    Abbruch oder Fristablauf: 2→0, Platz geht an die Warteschlange, Seite „Buchung nicht abgeschlossen“.
13. **Zahlung**: kein Anbieter, nur Platzhalter.
14. **Admin**: Easy Auth mit Entra ID. Pflege von Name, Beschreibung, Bild (Blob), Kontingent, Preis,
    Verkaufszeitraum.
15. **Geheimnisse**: Container-Apps-Secrets (MySQL, Redis), Managed Identity für Storage. Key Vault als
    Ausbaustufe.
16. **Werkzeuge**: Drizzle (ORM), `pdf-lib` + `qrcode` (PDF), k6 (Lasttest), Bicep (Infrastruktur).
17. **Virtueller Warteraum vor dem Shop**: nicht gebaut, Kostenvergleich (Front Door / Queue-it) auf
    einer Backup-Folie.

## Umschaltung und Rückweg

1. Ruhige Phase wählen, Altsystem für ca. 10 min auf „nur lesen“.
2. `mysqldump` → Import nach MySQL Flexible → Zählabfrage vorher/nachher.
3. DNS auf Azure umstellen.
4. Rückweg: Der alte Server läuft bis Vertragsende weiter. DNS zurückstellen, Bestellungen aus der
   Zwischenzeit per Export zurückspielen.

## Repo-Aufbau

```
apps/legacy      Next.js-Monolith (Altsystem)
apps/shop        Neues Next.js-Frontend inkl. Admin
apps/functions   Azure Functions (Kaufpfad)
packages/db      Drizzle-Schema, Migrationen, Seed
packages/core    Gemeinsame Logik: Redis-Lua-Skripte, PDF, Mail
packages/ui      shadcn-Komponenten (Preset b1fLLNJijq)
infra            Bicep + Setup-Anleitung
loadtest         k6-Skripte + Prüfabfragen
```
