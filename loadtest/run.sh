#!/usr/bin/env bash
# Nachweis 5: verkleinerter Ansturm. Legt ein frisches Event mit 500 Tickets an, startet k6 und prüft danach die DB.
#   ./loadtest/run.sh legacy  (DATABASE_URL des Altsystems, BASE=http://localhost:3001)
#   ./loadtest/run.sh ziel    (DATABASE_URL des Zielsystems, BASE=https://<shop>.azurecontainerapps.io)
# Für das Zielsystem vorher RATE_LIMIT_IP in den Functions hochsetzen (alle k6-Käufer kommen von einer IP).
set -euo pipefail
MODUS="${1:?legacy oder ziel}"
: "${DATABASE_URL:?DATABASE_URL fehlt}"
BASE="${BASE:-$([ "$MODUS" = legacy ] && echo http://localhost:3001 || echo http://localhost:3000)}"
cd "$(dirname "$0")/.."

EVENT_ID=$(pnpm -s --filter @kw/db lasttest-event -- "${KONTINGENT:-500}")
echo "Event $EVENT_ID, Ziel $BASE"
docker run --rm -i --network host -e BASE="$BASE" -e EVENT_ID="$EVENT_ID" -e VUS="${VUS:-200}" -e DAUER="${DAUER:-2m}" \
  grafana/k6 run --summary-trend-stats "avg,p(95),max" - < "loadtest/$MODUS.js" | tee "/tmp/k6-$MODUS.txt"

if [ "$MODUS" = ziel ]; then echo "Warte 20 s, bis die Queue leer ist …"; sleep 20; fi
BESTAETIGT=$(grep -E "^\s*tickets_bestaetigt" "/tmp/k6-$MODUS.txt" | awk '{print $2}')
echo; echo "== Prüfung in MySQL (Event $EVENT_ID)"
DATABASE_URL="$DATABASE_URL" EVENT_ID="$EVENT_ID" BESTAETIGT="${BESTAETIGT:-0}" pnpm -s --filter @kw/db pruefen
