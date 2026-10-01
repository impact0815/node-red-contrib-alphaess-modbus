#!/usr/bin/env bash
# Installs the current state of this folder into the Node-RED Docker container (for testing unpublished versions).
#   ./update-nodered.sh [container]   (default: node-red)
set -euo pipefail
CONTAINER="${1:-node-red}"
cd "$(dirname "$0")"
NAME=$(sed -n 's/.*"name": *"\([^"]*\)".*/\1/p' package.json | head -1)
VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)
# npm pack: "@scope/pkg" -> "scope-pkg-<version>.tgz"
TGZ="$(echo "$NAME" | sed 's|^@||; s|/|-|')-${VERSION}.tgz"
OLD="node-red-contrib-alphaess-modbus"
echo "Installing ${NAME}@${VERSION} into container ${CONTAINER} ..."

tar -cf - --exclude=.git --exclude=node_modules --exclude='*Zone.Identifier' . \
  | docker exec -i "$CONTAINER" sh -c 'rm -rf /tmp/aem && mkdir /tmp/aem && tar -C /tmp/aem -xf -'

# the unscoped package of versions < 0.4.0 registers the same node types and must be removed first
if [ "$NAME" != "$OLD" ]; then
  docker exec "$CONTAINER" sh -c "cd /data && if npm ls --depth=0 $OLD >/dev/null 2>&1; then npm uninstall --no-audit --no-fund $OLD; fi"
fi

docker exec "$CONTAINER" sh -c "
  cd /tmp/aem && npm pack --pack-destination /data >/dev/null &&
  cd /data && npm install --no-audit --no-fund ./${TGZ} &&
  ls *alphaess-modbus-*.tgz 2>/dev/null | grep -vx '${TGZ}' | xargs -r rm -f;
  rm -rf /tmp/aem"

docker restart "$CONTAINER"
docker exec "$CONTAINER" npm ls --prefix /data "$NAME"
