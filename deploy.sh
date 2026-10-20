#!/usr/bin/env bash
# Deploy what is pushed to origin/main to production (https://fdfood.monky-go.com).
# Run from Git Bash in the repo root:  ./deploy.sh
#
# Guarantees:
# - no data loss: the DB is backed up first (deploy aborts if the backup fails),
#   and the db container is never stopped or recreated
# - no downtime: code goes to releases/<hash>/ and an atomic symlink swap makes it live;
#   an image change recreates app then app2 one at a time behind nginx
# - nobody is logged out: sessions live on the "sessions" volume
# - a failed smoke test switches the symlink back to the previous release
set -euo pipefail

SERVER=root@203.170.190.188
DIR=/root/fdfood

cd "$(dirname "$0")"
git fetch -q origin
H=$(git rev-parse --short origin/main)
echo "deploying $H"
TGZ=$(mktemp -u)-fd-$H.tgz
git archive --format=tar.gz -o "$TGZ" origin/main Dockerfile docker-compose.prod.yml db public backup.sh
scp -q "$TGZ" "$SERVER:/root/fd-$H.tgz"
rm -f "$TGZ"

ssh -o BatchMode=yes "$SERVER" H="$H" DIR="$DIR" bash -s <<'REMOTE'
set -euo pipefail
cd "$DIR"
exec 9>"$DIR/.deploy.lock"
flock -n 9 || { echo "another deploy is running"; exit 1; }
C="docker compose -f docker-compose.prod.yml"

IN="$DIR/.incoming"
rm -rf "$IN"; mkdir -p "$IN"
tar xzf "/root/fd-$H.tgz" -C "$IN"; rm -f "/root/fd-$H.tgz"

echo "-- lint (PHP 8.3)"
docker run --rm -v "$IN/public:/app:ro" php:8.3-cli php -l /app/api.php

echo "-- backup DB"
install -m 755 "$IN/backup.sh" ./backup.sh
./backup.sh

echo "-- stage release"
mkdir -p releases
[ -d "releases/$H" ] || cp -a "$IN/public" "releases/$H"
cp -a "$IN/db/." db/
PREV=$(readlink releases/current || true)

# rebuild the image only when the Dockerfile or compose file changed
if ! cmp -s "$IN/Dockerfile" Dockerfile || ! cmp -s "$IN/docker-compose.prod.yml" docker-compose.prod.yml; then
  echo "-- image/compose changed: rolling restart"
  cp "$IN/Dockerfile" "$IN/docker-compose.prod.yml" .
  $C build app
  for s in app app2; do
    $C up -d --no-deps --force-recreate "$s"
    port=$([ "$s" = app ] && echo 3020 || echo 3021)
    for i in $(seq 1 30); do curl -fsS -o /dev/null "http://127.0.0.1:$port/" 2>/dev/null && break; sleep 1; done
  done
fi
rm -rf "$IN"

echo "-- switch $PREV -> $H"
ln -sfn "$H" releases/current.tmp && mv -T releases/current.tmp releases/current
sleep 2 # realpath_cache_ttl=1

smoke() {
  for port in 3020 3021; do
    for p in / /api.php?a=me /js/core.js /css/app.css; do
      code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port$p")
      [ "$code" = 200 ] || { echo "FAIL :$port$p -> $code"; return 1; }
    done
  done
}
if ! smoke; then
  if [ -n "$PREV" ] && [ "$PREV" != "$H" ]; then
    ln -sfn "$PREV" releases/current.tmp && mv -T releases/current.tmp releases/current
    echo "ROLLED BACK to $PREV"
  fi
  exit 1
fi
echo "$H" > DEPLOYED

# keep the 5 newest releases (and always the live one)
ls -1t releases | grep -v '^current' | tail -n +6 | while read -r r; do
  [ "$r" = "$H" ] || rm -rf "releases/$r"
done
$C ps --format '{{.Name}} {{.Status}}'
echo "OK $H live"
REMOTE
