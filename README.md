# KlangWerk Tickets – vom überlasteten Server zur elastischen Plattform

Prüfungsleistung Cloud Computing, Fall A. Monorepo mit Altsystem (Ist-Zustand) und Zielsystem in Azure.

- Architektur und alle Entscheidungen: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md)
- Pflicht-Nachweise, lokale Ergebnisse, Demo-Ablauf, Antworten auf Prüfungsfragen: [docs/DEMO.md](docs/DEMO.md)
- Azure einrichten: [infra/SETUP.md](infra/SETUP.md)

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

Voraussetzungen: Node 22, pnpm (`corepack enable`), Docker.

```bash
pnpm install

# Altsystem
docker compose --profile legacy up -d mysql-legacy mailpit
DATABASE_URL=mysql://klangwerk:klangwerk@127.0.0.1:3307/klangwerk pnpm db:migrate -- --bis 001
DATABASE_URL=mysql://klangwerk:klangwerk@127.0.0.1:3307/klangwerk pnpm db:seed
docker compose --profile legacy up -d --build legacy          # http://localhost:3001  (Admin: admin/admin)

# Zielsystem, lokal emuliert (MySQL, Redis, Azurite statt Azure Storage, Mailpit statt ACS)
docker compose --profile ziel up -d
QUELLE_URL=mysql://klangwerk:klangwerk@127.0.0.1:3307/klangwerk \
ZIEL_URL=mysql://klangwerk:klangwerk@127.0.0.1:3308/klangwerk ./scripts/migrieren.sh
cp .env.ziel.example .env && set -a && . ./.env && set +a
pnpm dev:functions &                                             # http://localhost:7071
pnpm dev:shop                                                    # http://localhost:3000

# Mails ansehen: http://localhost:8025
```

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
