#!/usr/bin/env bash
# Weave Studio in Docker, on Linux or a Mac (on Windows, use run.ps1 or run.cmd). Run it from anywhere:
#   ./run.sh start            build and start the studio on http://localhost:5173 (private: this computer only)
#   ./run.sh start --https    the same, plus Caddy: HTTPS and a password on STUDIO_DOMAIN (a server with ports 80 and 443)
#   ./run.sh start --demo     also the demo studio (sample data, no key) on http://localhost:8090
#   ./run.sh start --mock     also the mock bank API on http://localhost:4400
#   ./run.sh stop             stop everything this folder started
#   ./run.sh status           what is running, and whether the studio answers
#   ./run.sh logs [service]   follow the logs (studio, caddy, studio-demo, mock-api)
#   ./run.sh export           build, then save every image this folder uses to docker-images/weave-studio-images.tar
#   ./run.sh import           on another computer: load that file and start without building (same options as start)
#   ./run.sh export-windows   build the Windows-container images into docker-images/windows (for a Windows host;
#                             there, .\run.cmd import loads and starts them with docker-compose.windows.yml)
# The settings are in .env.docker (made from .env.docker.example the first time) and who may sign in in credentials.txt.
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=.env.docker
IMAGES=docker-images/weave-studio-images.tar
command=${1:-start}
[ $# -gt 0 ] && shift

say() { printf '%s\n' "$*"; }
fail() {
  printf 'Stopped: %s\n' "$*" >&2
  exit 1
}

# one setting's value from .env.docker (the last line that sets it), without quotes; empty when unset
setting() {
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^[[:space:]]*$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

# a port from .env.docker, else its default
port_of() {
  local value
  value=$(setting "$1")
  printf '%s' "${value:-$2}"
}

need_docker() {
  command -v docker >/dev/null 2>&1 || fail "Docker is not installed (https://docs.docker.com/engine/install/)."
  # inside WSL, a docker under /mnt/ is Docker Desktop's pointer from Windows, not an engine in this Linux
  case "$(command -v docker)" in
    /mnt/*) fail "Docker Engine is not installed in this WSL Linux (the docker here is Docker Desktop's, switched off for it). Install it: curl -fsSL https://get.docker.com | sudo sh, then sudo usermod -aG docker \$USER, then wsl --shutdown in Windows and open Ubuntu again." ;;
  esac
  docker info >/dev/null 2>&1 || fail "Docker is installed but not running, or this user may not use it (try: sudo usermod -aG docker \$USER, then log in again)."
  docker compose version >/dev/null 2>&1 || fail "The Docker Compose plugin is missing (https://docs.docker.com/compose/install/linux/)."
  [ "$(docker info --format '{{.OSType}}' 2>/dev/null)" != windows ] || fail "This Docker runs Windows containers: use .\\run.cmd here (it uses docker-compose.windows.yml and the Windows images)."
}

# builds one Windows image on this Linux engine (its Windows part only copies files in) and saves it to
# docker-images/windows/<name>.tar for the Windows host: tag, Dockerfile, folder, then build arguments
build_windows() {
  local tag=$1 file=$2 context=$3 arg
  shift 3
  local args=(--build-arg "WINDOWS_VERSION=$(port_of WINDOWS_VERSION ltsc2022)")
  for arg in "$@"; do args+=(--build-arg "$arg"); done
  say "Building $tag (Windows $(port_of WINDOWS_VERSION ltsc2022))..."
  docker buildx build --builder weave-windows --platform windows/amd64 -f "$file" "${args[@]}" \
    --output "type=docker,name=$tag,dest=docker-images/windows/${tag%%:*}.tar" "$context"
}

# the settings and the sign-in file, checked before anything is built
check_files() {
  if [ ! -f "$ENV_FILE" ]; then
    cp .env.docker.example "$ENV_FILE"
    fail "$ENV_FILE was missing, so it was made from .env.docker.example. Fill in AGENT_BUILDER_API_KEY (and the rest as the file says), then run this again."
  fi
  [ -n "$(setting AGENT_BUILDER_API_KEY)" ] || fail "AGENT_BUILDER_API_KEY is empty in $ENV_FILE."
  if [ -d credentials.txt ]; then
    fail "credentials.txt is a folder (Docker makes one when the file is missing). Delete it (rmdir credentials.txt), create the file, then run this again."
  fi
  [ -f credentials.txt ] || fail "credentials.txt is missing: create it, one person per line (email, a space, the password)."
}

check_https() {
  local name
  for name in STUDIO_DOMAIN STUDIO_USER STUDIO_PASSWORD_HASH; do
    [ -n "$(setting "$name")" ] || fail "$name is empty in $ENV_FILE (needed for --https; see DEPLOY.md)."
  done
}

# waits for the studio's health check: healthy, or why not
wait_healthy() {
  local id state i
  id=$(docker compose ps -q studio)
  [ -n "$id" ] || fail "the studio container did not start (./run.sh logs studio)."
  for i in $(seq 1 45); do
    state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo gone)
    case "$state" in
      healthy) return 0 ;;
      unhealthy | exited | dead | gone) fail "the studio is $state (./run.sh logs studio)." ;;
    esac
    sleep 2
  done
  fail "the studio did not become healthy in 90 seconds (./run.sh logs studio)."
}

profiles=()
for arg in "$@"; do
  case "$arg" in
    --https) profiles+=(--profile https) ;;
    --demo) profiles+=(--profile demo) ;;
    --mock) profiles+=(--profile mock) ;;
    *) [ "$command" = logs ] || fail "unknown option $arg (./run.sh start|import [--https] [--demo] [--mock])" ;;
  esac
done

case "$command" in
  start | import)
    need_docker
    check_files
    case " ${profiles[*]-} " in *" https "*) check_https ;; esac
    if [ "$command" = import ]; then
      [ -f "$IMAGES" ] || fail "$IMAGES is missing: on the computer that built the images, run ./run.sh export, then copy the file here."
      say "Loading the images from $IMAGES..."
      docker load -i "$IMAGES"
      say "Starting (nothing is built)..."
      docker compose ${profiles[@]+"${profiles[@]}"} up -d --no-build
    else
      say "Building and starting (the first build takes a few minutes)..."
      docker compose ${profiles[@]+"${profiles[@]}"} up --build -d
    fi
    wait_healthy
    port=$(port_of STUDIO_PORT 5173)
    say ""
    say "Weave Studio is running: http://localhost:$port (on this computer; from elsewhere, an SSH tunnel: ssh -L $port:localhost:$port <user>@<this server>)"
    case " ${profiles[*]-} " in *" https "*) say "  and on https://$(setting STUDIO_DOMAIN) (Caddy gets the certificate; give it a minute the first time)" ;; esac
    case " ${profiles[*]-} " in *" demo "*) say "  the demo studio: http://localhost:$(port_of STUDIO_DEMO_PORT 8090)" ;; esac
    case " ${profiles[*]-} " in *" mock "*) say "  the mock bank API: http://localhost:$(port_of MOCK_API_PORT 4400)" ;; esac
    say "Sign in with a line of credentials.txt. Stop it with: ./run.sh stop"
    ;;
  export)
    need_docker
    say "Building from these files first, so the saved images are current..."
    docker compose build
    images=()
    for image in $(docker compose --profile https --profile demo --profile mock config --images); do
      # Caddy comes from Docker Hub: fetched here, so the file also works on a computer without internet
      case "$image" in caddy:*) docker image inspect "$image" >/dev/null 2>&1 || docker pull "$image" ;; esac
      if docker image inspect "$image" >/dev/null 2>&1; then images+=("$image"); else say "  left out (not built here): $image"; fi
    done
    mkdir -p docker-images
    say "Saving ${images[*]} to $IMAGES..."
    docker save -o "$IMAGES" "${images[@]}"
    say ""
    say "Saved $IMAGES ($(du -h "$IMAGES" | cut -f1))."
    say "On the other computer: copy this folder (with that file; without node_modules), fill in .env.docker, then ./run.sh import (or .\run.cmd import on Windows)."
    ;;
  export-windows)
    need_docker
    docker buildx inspect weave-windows >/dev/null 2>&1 || docker buildx create --name weave-windows --driver docker-container >/dev/null
    mkdir -p docker-images/windows
    build_windows weave-studio:windows Dockerfile.windows .
    build_windows weave-studio-demo:windows Dockerfile.windows . VITE_DEMO_MODE=true
    build_windows weave-mock-api:windows mock-api/Dockerfile.windows mock-api
    build_windows caddy-nano:windows Dockerfile.caddy.windows .
    say ""
    for tar in docker-images/windows/*.tar; do say "Saved $tar ($(du -h "$tar" | cut -f1))"; done
    say "On the Windows host (Docker in Windows-containers mode): copy this folder with docker-images/windows, fill in the settings, then .\\run.cmd import."
    ;;
  stop)
    need_docker
    docker compose --profile https --profile demo --profile mock down
    say "Stopped. Settings, sign-ins and certificates are kept; ./run.sh start brings it back."
    ;;
  status)
    need_docker
    docker compose --profile https --profile demo --profile mock ps
    id=$(docker compose ps -q studio)
    if [ -n "$id" ]; then
      say "studio: $(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")"
    else
      say "studio: not running"
    fi
    ;;
  logs)
    need_docker
    docker compose --profile https --profile demo --profile mock logs -f --tail 100 "$@"
    ;;
  *)
    fail "unknown command $command (start, stop, status, logs, export, import or export-windows)"
    ;;
esac
