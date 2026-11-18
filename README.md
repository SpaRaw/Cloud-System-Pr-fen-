# KlangWerk Tickets – vom überlasteten Server zur elastischen Plattform

Prüfungsleistung Cloud Computing, Fall A. Monorepo mit Altsystem (Ist-Zustand) und Zielsystem in Azure.

- Architektur und alle Entscheidungen: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md)
- Pflicht-Nachweise, lokale Ergebnisse, Demo-Ablauf, Antworten auf Prüfungsfragen: [docs/DEMO.md](docs/DEMO.md)
- Deployment auf Azure (Altsystem-VM + Zielsystem): [infra/SETUP.md](infra/SETUP.md)
- Deployment über das Azure-Portal (Ressourcengruppe vorhanden): [infra/PORTAL.md](infra/PORTAL.md)

```
apps/legacy      Altsystem: Next.js-Monolith, Kauf synchron und ohne Sperre        :3001
apps/shop        Zielsystem: Next.js-Shop + Admin (Container Apps)                  :3000
apps/functions   Kaufpfad als Azure Functions (HTTP, Queue, Timer)                  :7071
packages/core    Redis-Lua-Skripte (Reservierung, Warteschlange), PDF, Mail, Storage, Queue-Verarbeitung
packages/db      Schema (SQL + Drizzle), Migration, Seed, Zählabfragen
packages/ui      shadcn-Komponenten im Stil des Presets b1fLLNJijq
infra            Bicep für das komplette Zielsystem
loadtest         k6-Skripte für beide Systeme
scripts          Migration Altsystem -> Azure
```

## Lokal starten

Voraussetzung: Docker. Ein Befehl startet Altsystem und Zielsystem, das Zielsystem wie in Azure aufgebaut
(Details, Azure-Vergleich und Lasttest: [docs/LOKAL.md](docs/LOKAL.md)).

```bash
docker compose up -d --build
# Zielsystem  http://localhost:3000   (Admin: lokaler Entra-Login)
# Altsystem   http://localhost:3001   (Admin: admin / admin)
# Mails       http://localhost:8025
```

Für die Entwicklung ohne Container: `pnpm install`, dann `pnpm dev:functions` und `pnpm dev:shop` mit den
Variablen aus `.env.ziel.example` gegen die Datenbanken und Redis aus dem Stack (Redis-URL dann
`redis://:lokal-redis@127.0.0.1:6380`).

## Tests

```bash
redis-server --daemonize yes      # oder: docker run -d -p 6379:6379 redis:7-alpine
pnpm --filter @kw/core test       # Redis-Logik: Überverkauf, Ablauf, Warteschlange, First-Fit, Outbox
pnpm typecheck
DATABASE_URL=… ./loadtest/run.sh legacy|ziel
EVENT_ID=<uuid> pnpm --filter @kw/functions idempotenz
```

## Hinweis zu den UI-Komponenten

Die shadcn-Registry war aus der Entwicklungsumgebung nicht erreichbar. Die Komponenten in `packages/ui` sind
deshalb von Hand im Stil des Presets nachgebaut (base-nova, stone, teal, Raleway/Roboto, Radius medium).
Wer die Originale will: in `packages/ui` einmal `pnpm dlx shadcn@latest add -o button card input label textarea badge progress alert table separator spinner`.
