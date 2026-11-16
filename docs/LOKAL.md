# Lokaler Stack: Altsystem und Zielsystem in Docker Compose

Ein Befehl startet beide Systeme. Das Zielsystem ist dem Azure-Setup (`infra/main.bicep`) nachgebaut: dieselben
Images, dieselben Umgebungsvariablen, dieselbe Functions-Runtime, dieselbe Migration.

```bash
docker compose up -d --build     # erster Start: ca. 3–5 min Build
docker compose ps                # legacy-init und migration enden mit „Exited (0)“, alles andere „Up“
```

| URL | Was |
| --- | --- |
| http://localhost:3000 | Zielsystem: Shop, Buchungsflow, Warteschlange · `/admin` mit Login |
| http://localhost:3001 | Altsystem · `/admin` mit `admin` / `admin` |
| http://localhost:8025 | Mailpit: alle Mails beider Systeme mit PDF-Anhang |
| http://localhost:7071/api/kauf/… | Functions direkt (wie die Function-App-URL in Azure) |
| localhost:3307 / 3308 | MySQL Altsystem / Zielsystem (`klangwerk` / `klangwerk`) |

Zurücksetzen auf den Anfangszustand: `docker compose down -v && docker compose up -d`.

## Was beim Start passiert

1. `mysql-legacy` startet, `legacy-init` legt das Altschema (001) und erfundene Testdaten an
   (Sommerklang 500, Herbstrauschen 200, Winterlicht 100 Tickets).
2. `migration` macht genau das, was `scripts/migrieren.sh` gegen Azure macht: Zählabfrage Altsystem →
   `mysqldump` → Import in `mysql-ziel` → Erweiterung `002_azure.sql` → Zählabfrage Ziel
   (`docker compose logs migration`).
3. `functions`, `shop` und `ingress` starten erst danach.

## Azure ↔ lokal

| Azure (main.bicep) | Lokal (docker-compose.yml) | Gleich / anders |
| --- | --- | --- |
| Container App `shop-klangwerk` (0,5 vCPU, 1 GiB) | `shop`, gleiches Image, gleiche Limits | gleich |
| Ingress von Container Apps | `ingress` (kleiner Proxy) | hängt Client-IP an `X-Forwarded-For` an wie in Azure |
| Easy Auth mit Entra ID, „anonym zulassen“ | `ingress` mit Login-Seite unter `/.auth/login/aad` | gleiche Header (`x-ms-client-principal-name`), aber kein echter Microsoft-Login |
| Functions on Container Apps (`kw-functions`-Image) | `functions`, gleiches Image, echte Functions-Runtime | gleich; Timer, Queue-Trigger, Function-Keys wie in Azure |
| Container App `redis-klangwerk` (0,25 vCPU, Kennwort, ohne Persistenz) | `redis`, gleicher Befehl und Limits | gleich |
| Storage Account (Queue + Blob) per Managed Identity | Azurite per Verbindungszeichenfolge | Authentifizierung anders, API gleich |
| MySQL Flexible Server 8.0 mit TLS | `mysql-ziel` 8.4 ohne TLS | Schema und Daten gleich |
| Azure Communication Services Email | Mailpit (SMTP) | Mail-Inhalt gleich, Versandweg anders |
| Shop skaliert 0–10, Functions bis 10 Instanzen | je 1 Container | **kein Scale-out** – der lokale Lasttest ist die untere Grenze |

## Lasttest im Stack

```bash
# Rate-Limit pro IP anheben: alle k6-Käufer kommen von derselben Adresse
RATE_LIMIT_IP=100000 docker compose up -d functions

DATABASE_URL=mysql://klangwerk:klangwerk@127.0.0.1:3308/klangwerk ./loadtest/run.sh ziel
DATABASE_URL=mysql://klangwerk:klangwerk@127.0.0.1:3307/klangwerk ./loadtest/run.sh legacy

docker compose up -d functions   # danach wieder normales Rate-Limit
```

Ergebnis am 16.11.2026 (200 Käufer, 500 Tickets, 2 min, gleiche Rechner-Limits für beide):

| | Altsystem | Zielsystem |
| - | - | - |
| Verkaufte Tickets | 1.512 | 500 |
| Doppelt vergebene Plätze | 1.459 | 0 |
| Bestellungen verloren | 0 | 0 |
| Antwortzeit Mittel / p95 | 25 s / 33 s | 2,0 s / 3,5 s |
| Über die Warteschlange gekauft | – | 146 Käufer |

Idempotenz (Nachweis 6) gegen den Stack (legt eine echte Bestellung an und spielt die Nachricht zweimal ein,
die Function im Container verarbeitet sie):

```bash
EVENT=$(docker compose exec -T mysql-ziel mysql -N -uklangwerk -pklangwerk klangwerk -e "SELECT id FROM event WHERE name='Sommerklang Festival'" 2>/dev/null)
DATABASE_URL=mysql://klangwerk:klangwerk@127.0.0.1:3308/klangwerk \
REDIS_URL=redis://:lokal-redis@127.0.0.1:6380 \
STORAGE_CONNECTION_STRING=UseDevelopmentStorage=true \
EVENT_ID=$EVENT pnpm --filter @kw/functions idempotenz
# -> { bestellungen: 1, tickets: 1, status: 'versendet', ok: true }
```
