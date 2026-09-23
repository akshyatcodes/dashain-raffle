#!/usr/bin/env bash
# Build (and optionally push or export) the raffle image.
#   scripts/build-image.sh                         -> local image dashain-raffle:<version> for this machine's CPU
#   scripts/build-image.sh --push REGISTRY/NAME    -> multi-arch (amd64+arm64) build pushed to a registry (needs docker buildx)
#   scripts/build-image.sh --save                  -> also writes dashain-raffle-<version>-<arch>.tar.gz you can hand to someone
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
node --check server.js && node --check public/app.js

case "${1:-}" in
  --push)
    REPO=${2:?usage: --push registry.example.com/team/dashain-raffle}
    docker buildx version >/dev/null 2>&1 || { echo "docker buildx is required for multi-arch pushes"; exit 1; }
    docker buildx build --platform linux/amd64,linux/arm64 -t "$REPO:$VERSION" -t "$REPO:latest" --push .
    echo "pushed $REPO:$VERSION (amd64 + arm64)";;
  *)
    docker build -t "dashain-raffle:$VERSION" -t dashain-raffle:latest .
    echo "built dashain-raffle:$VERSION for $(uname -m)"
    if [ "${1:-}" = "--save" ]; then
      OUT="dashain-raffle-$VERSION-$(uname -m).tar.gz"
      docker save "dashain-raffle:$VERSION" | gzip > "$OUT"
      echo "saved $OUT  (load it elsewhere with: docker load < $OUT)"
    fi;;
esac
