#!/bin/zsh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE_NAME="facilities-dashboard-windows-builder:local"
OUTPUT_DIR="$REPO_DIR/dist/windows-docker"
APP_VERSION="${1:-0.0.0-dev+local}"
CONTAINER_ID=""

cleanup() {
  if [[ -n "$CONTAINER_ID" ]]; then
    docker rm -f "$CONTAINER_ID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

if ! docker info >/dev/null 2>&1; then
  print -u2 "Docker is not running or this terminal cannot access the Docker daemon."
  exit 1
fi

print "Building Windows x64 executable under Wine. This can take several minutes on Apple Silicon."
docker build \
  --platform linux/amd64 \
  --build-arg "APP_VERSION=$APP_VERSION" \
  --file "$REPO_DIR/packaging/windows/Dockerfile.windows" \
  --tag "$IMAGE_NAME" \
  "$REPO_DIR"

CONTAINER_ID="$(docker create --platform linux/amd64 "$IMAGE_NAME")"
mkdir -p "$OUTPUT_DIR"
docker cp "$CONTAINER_ID:/workspace/dist/facilities_dashboard.exe" "$OUTPUT_DIR/facilities_dashboard.exe"
docker cp "$CONTAINER_ID:/workspace/dist/facilities_dashboard.exe.sha256" "$OUTPUT_DIR/facilities_dashboard.exe.sha256"

print "Built: $OUTPUT_DIR/facilities_dashboard.exe"
print "Checksum: $OUTPUT_DIR/facilities_dashboard.exe.sha256"
