#!/bin/sh
# Migration Altsystem -> Zielsystem. Läuft im mysql:8.4-Image (Compose-Service „migration“).
# Gleicher Ablauf wie scripts/migrieren.sh: Zählen -> mysqldump -> Import -> 002_azure.sql -> Zählen.
#
# Lokal (Standard):  Quelle mysql-legacy, Ziel mysql-ziel
# Gegen Azure (auf der Altsystem-VM):
#   docker compose run --rm --no-deps -e ZIEL_HOST=<server>.mysql.database.azure.com -e ZIEL_USER=kwadmin \
#     -e ZIEL_PASSWORD='<kennwort>' -e ZIEL_SSL=1 migration
set -eu
QH="${QUELLE_HOST:-mysql-legacy}"; QU="${QUELLE_USER:-klangwerk}"; QP="${QUELLE_PASSWORD:-klangwerk}"
ZH="${ZIEL_HOST:-mysql-ziel}";     ZU="${ZIEL_USER:-klangwerk}";   ZP="${ZIEL_PASSWORD:-klangwerk}"
DB="${DATENBANK:-klangwerk}"
SSL=""; [ "${ZIEL_SSL:-0}" = "1" ] && SSL="--ssl-mode=REQUIRED"

quelle() { MYSQL_PWD="$QP" mysql -h "$QH" -u "$QU" "$@"; }
ziel()   { MYSQL_PWD="$ZP" mysql -h "$ZH" -u "$ZU" $SSL "$@"; }
ZAEHLEN="SELECT CONCAT('  event ', (SELECT COUNT(*) FROM event), ' · kontingent ', (SELECT COUNT(*) FROM kontingent), ' · bestellung ', (SELECT COUNT(*) FROM bestellung), ' · ticket ', (SELECT COUNT(*) FROM ticket))"

if ziel -N "$DB" -e "SELECT 1 FROM schema_version WHERE version='002'" 2>/dev/null | grep -q 1; then
  echo "Ziel ($ZH) ist schon migriert, nichts zu tun."; exit 0
fi
echo "== Vorher: Quelle ($QH)"; quelle -N "$DB" -e "$ZAEHLEN"
MYSQL_PWD="$QP" mysqldump -h "$QH" -u "$QU" --single-transaction --set-gtid-purged=OFF --no-tablespaces "$DB" > /tmp/dump.sql
echo "== Dump: $(wc -l < /tmp/dump.sql) Zeilen, Import ins Ziel ($ZH)"
ziel "$DB" < /tmp/dump.sql
echo "== Schema-Erweiterung 002_azure.sql"
ziel "$DB" < /sql/002_azure.sql
ziel "$DB" -e "INSERT INTO schema_version (version) VALUES ('002')"
echo "== Nachher: Ziel ($ZH)"; ziel -N "$DB" -e "$ZAEHLEN"
