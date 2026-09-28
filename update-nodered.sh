#!/usr/bin/env bash
# Installiert den aktuellen Stand dieses Ordners in den Node-RED-Container.
#   ./update-nodered.sh [container]   (Standard: node-red)
set -euo pipefail
CONTAINER="${1:-node-red}"
cd "$(dirname "$0")"
VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)
TGZ="node-red-contrib-alphaess-modbus-${VERSION}.tgz"
echo "Installiere Version ${VERSION} in Container ${CONTAINER} ..."

tar -cf - --exclude=.git --exclude=node_modules . \
  | docker exec -i "$CONTAINER" sh -c 'rm -rf /tmp/aem && mkdir /tmp/aem && tar -C /tmp/aem -xf -'

docker exec "$CONTAINER" sh -c "
  cd /tmp/aem && npm pack --pack-destination /data >/dev/null &&
  cd /data && npm install --no-audit --no-fund ./${TGZ} &&
  ls node-red-contrib-alphaess-modbus-*.tgz | grep -v '${TGZ}' | xargs -r rm -f;
  rm -rf /tmp/aem"

docker restart "$CONTAINER"
docker exec "$CONTAINER" npm ls --prefix /data node-red-contrib-alphaess-modbus
