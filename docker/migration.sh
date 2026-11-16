#!/bin/sh
# Läuft im mysql:8.4-Image. Gleicher Ablauf wie scripts/migrieren.sh gegen Azure:
# Zählen -> mysqldump Altsystem -> Import Ziel -> 002_azure.sql -> Zählen.
set -eu
Q="-h mysql-legacy -uklangwerk -pklangwerk klangwerk"
Z="-h mysql-ziel -uklangwerk -pklangwerk klangwerk"
zaehlen() { mysql $1 -N -e "SELECT CONCAT('  event ', (SELECT COUNT(*) FROM event), ' · kontingent ', (SELECT COUNT(*) FROM kontingent), ' · bestellung ', (SELECT COUNT(*) FROM bestellung), ' · ticket ', (SELECT COUNT(*) FROM ticket))" 2>/dev/null; }

if mysql $Z -N -e "SELECT 1 FROM schema_version WHERE version='002'" 2>/dev/null | grep -q 1; then
  echo "Ziel ist schon migriert, nichts zu tun."; exit 0
fi
echo "== Vorher (Altsystem)"; zaehlen "$Q"
mysqldump -h mysql-legacy -uklangwerk -pklangwerk --single-transaction --set-gtid-purged=OFF --no-tablespaces klangwerk 2>/dev/null > /tmp/dump.sql
echo "== Dump: $(wc -l < /tmp/dump.sql) Zeilen, Import ins Ziel"
mysql $Z < /tmp/dump.sql 2>/dev/null
mysql $Z < /sql/002_azure.sql 2>/dev/null
mysql $Z -e "INSERT INTO schema_version (version) VALUES ('002')" 2>/dev/null
echo "== Nachher (Ziel)"; zaehlen "$Z"
