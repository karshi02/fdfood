#!/bin/sh
# Production DB backup (Linux server). Windows dev machines use backup.bat.
# Daily at 03:00 via cron (crontab -e):
#   0 3 * * * /root/fdfood/backup.sh >> /root/fdfood/backups/backup.log 2>&1
set -eu
umask 077 # dumps hold every bill and password hash: owner-only
cd "$(dirname "$0")"
mkdir -p backups
ts=$(date +%Y-%m-%d_%H%M%S) # seconds: a deploy right after a backup must not collide
out="backups/fdfood-$ts.sql"

# MariaDB 11 images ship only mariadb-dump; MySQL ships only mysqldump.
# MYSQL_PWD keeps the password out of the process list.
# Dump to a plain file first: sh has no pipefail, so a pipe into gzip would hide a failed dump.
if docker compose -f docker-compose.prod.yml exec -T db sh -c \
  'D=mysqldump; command -v mariadb-dump >/dev/null && D=mariadb-dump; MYSQL_PWD="$MYSQL_ROOT_PASSWORD" $D -uroot --single-transaction fdfood' \
  > "$out.tmp" && grep -q 'Dump completed' "$out.tmp"; then
  mv "$out.tmp" "$out"
  gzip "$out"
  out="$out.gz"
else
  rm -f "$out.tmp"
  echo "$(date '+%F %T') backup failed" >&2
  exit 1
fi

# keep 60 days of backups
find backups -name 'fdfood-*.sql.gz' -mtime +60 -delete
echo "$(date '+%F %T') saved $out"
