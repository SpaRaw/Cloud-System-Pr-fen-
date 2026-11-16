#!/usr/bin/env bash
# Nachweis 2: Daten vom Altsystem in die verwaltete Datenbank übertragen.
#
#   QUELLE_URL=mysql://klangwerk:klangwerk@127.0.0.1:3307/klangwerk \
#   ZIEL_URL='mysql://adminuser:***@<server>.mysql.database.azure.com:3306/klangwerk?ssl=true' \
#   ./scripts/migrieren.sh
#
# Ablauf: Zählabfrage Quelle -> mysqldump -> Import ins Ziel -> Schema-Erweiterung 002 -> Zählabfrage Ziel.
# mysqldump läuft im offiziellen MySQL-Container, lokal muss also nur Docker installiert sein.
set -euo pipefail
: "${QUELLE_URL:?QUELLE_URL fehlt}"
: "${ZIEL_URL:?ZIEL_URL fehlt}"

zerlege() { # mysql://user:pass@host:port/db?ssl=true -> Variablen
  local url="${1#mysql://}"; url="${url%%\?*}"
  local cred="${url%%@*}" rest="${url#*@}"
  U="${cred%%:*}"; P="${cred#*:}"; H="${rest%%:*}"; rest="${rest#*:}"; PORT="${rest%%/*}"; DB="${rest#*/}"
}
mysql_img() { docker run --rm -i --network host -e MYSQL_PWD="$P" mysql:8.4 "$@"; }

echo "== Vorher: Quelle"
DATABASE_URL="$QUELLE_URL" pnpm -s --filter @kw/db zaehlen

zerlege "$QUELLE_URL"
echo "== Dump der Quelle ($H:$PORT/$DB)"
mysql_img mysqldump -h "$H" -P "$PORT" -u "$U" --single-transaction --set-gtid-purged=OFF --no-tablespaces "$DB" > /tmp/klangwerk-dump.sql
echo "   $(wc -l < /tmp/klangwerk-dump.sql) Zeilen"

zerlege "$ZIEL_URL"
SSL=""; [[ "$ZIEL_URL" == *"ssl=true"* ]] && SSL="--ssl-mode=REQUIRED"
echo "== Import ins Ziel ($H)"
mysql_img mysql -h "$H" -P "$PORT" -u "$U" $SSL "$DB" < /tmp/klangwerk-dump.sql

echo "== Schema-Erweiterung für das Zielsystem"
DATABASE_URL="$ZIEL_URL" pnpm -s --filter @kw/db migrate

echo "== Nachher: Ziel"
DATABASE_URL="$ZIEL_URL" pnpm -s --filter @kw/db zaehlen
