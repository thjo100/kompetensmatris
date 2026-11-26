#!/usr/bin/env bash
#
# Installerar eller uppdaterar Kompetensmatris i Docker utan att tappa data.
#
#   scripts/uppgradera.sh 1.1.0                         bygg version 1.1.0 från koden och byt till den
#   scripts/uppgradera.sh --image konto/kompetensmatris 1.1.0   använd en färdig image i stället för att bygga
#   scripts/uppgradera.sh --backup                      gör bara en säkerhetskopia
#   scripts/uppgradera.sh --aterstall backup/fil.json   läs tillbaka en säkerhetskopia
#
# Datan ligger i en Docker-volym som är skild från containern. Skriptet säkerhetskopierar den,
# startar den nya versionen med samma volym och kontrollerar att den svarar. Svarar den inte
# backar skriptet automatiskt till den förra versionen. Se README.md, "Installera och uppdatera".

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ---------- Inställningar (se README) ----------
# Kan stå i kompetensmatris.env (rader som KM_PORT=8080) eller sättas som miljövariabler,
# som då går före filen. Lägg dem i filen, så blir de samma varje gång skriptet körs.
ENV_FILE="${KM_ENV_FILE:-$REPO_DIR/kompetensmatris.env}"
if [[ -f "$ENV_FILE" ]]; then
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^(KM_[A-Z_]+|DOTNET_REGISTRY)$ ]] || continue
    [[ -n "${!key:-}" ]] || printf -v "$key" '%s' "$value"
  done < "$ENV_FILE"
fi
CONTAINER="${KM_CONTAINER:-kompetensmatris}"
VOLUME="${KM_VOLUME:-kompetensdata}"           # namngiven volym, eller en katalog på värden som /srv/kompetensmatris
PORT="${KM_PORT:-8080}"                         # port på värden, eller IP:port som 127.0.0.1:8080
BACKUP_DIR="${KM_BACKUP_DIR:-$REPO_DIR/backup}"
BACKUP_KEEP="${KM_BACKUP_KEEP:-30}"             # så många säkerhetskopior sparas, de äldsta tas bort
LOCAL_IMAGE="${KM_IMAGE:-kompetensmatris}"      # namn på imagen som byggs lokalt
DATA_FILE="/data/kompetensmatris.json"
OLD="$CONTAINER-forra"
APP_UID=1654                                    # användaren som appen kör som i containern

if [[ -t 1 ]]; then BOLD=$'\033[1m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
else BOLD=''; RED=''; YELLOW=''; GREEN=''; RESET=''; fi
say()  { printf '%s==> %s%s\n' "$BOLD" "$*" "$RESET"; }
ok()   { printf '%s==> %s%s\n' "$GREEN" "$*" "$RESET"; }
warn() { printf '%sVarning: %s%s\n' "$YELLOW" "$*" "$RESET" >&2; }
die()  { printf '%sFel: %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

usage() {
  cat <<EOF
Användning:
  $0 <version>                     Bygg imagen från koden i $REPO_DIR och byt till den
  $0 --image <namn> <version>      Använd en färdig image (<namn>:<version>), hämtas om den saknas
  $0 --backup                      Gör bara en säkerhetskopia av datan
  $0 --aterstall <fil>             Läs tillbaka en säkerhetskopia (den nuvarande sparas först)

Exempel:
  $0 1.1.0
  $0 --image minorg/kompetensmatris 1.1.0
  $0 --image kompetensmatris 1.0.0          (backa till en äldre lokal version)

Inställningar (i $ENV_FILE eller som miljövariabler):
  KM_CONTAINER=$CONTAINER  KM_VOLUME=$VOLUME  KM_PORT=$PORT
  KM_ENV_FILE=$ENV_FILE
  KM_BACKUP_DIR=$BACKUP_DIR  KM_BACKUP_KEEP=$BACKUP_KEEP  KM_IMAGE=$LOCAL_IMAGE
  DOTNET_REGISTRY=<spegel>   intern spegel av mcr.microsoft.com vid bygget
EOF
}

# ---------- Hjälpfunktioner ----------

exists()  { docker container inspect "$1" >/dev/null 2>&1; }
running() { [[ "$(docker container inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" == true ]]; }
env_value() { [[ -f "$ENV_FILE" ]] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 || true; }

health_url() {
  local host=127.0.0.1 port="$PORT" base
  if [[ "$PORT" == *:* ]]; then
    host="${PORT%:*}"
    port="${PORT##*:}"
    [[ "$host" == 0.0.0.0 ]] && host=127.0.0.1
  fi
  base="$(env_value PATH_BASE)"
  base="${base%/}"
  [[ -n "$base" && "$base" != /* ]] && base="/$base"
  echo "http://$host:$port$base/health"
}

# Väntar upp till en minut på att appen svarar "ok" på /health.
wait_healthy() {
  local c="$1" url
  url="$(health_url)"
  for _ in $(seq 1 30); do
    sleep 2
    running "$c" || continue
    if command -v curl >/dev/null 2>&1; then
      curl -fsS --max-time 2 "$url" 2>/dev/null | grep -q '^ok' && return 0
    elif command -v wget >/dev/null 2>&1; then
      wget -qO- --timeout=2 "$url" 2>/dev/null | grep -q '^ok' && return 0
    else
      docker logs "$c" 2>&1 | grep -q 'Application started' && return 0
    fi
  done
  return 1
}

LAST_BACKUP=""
backup() {
  local c="$1" stamp file n=1
  mkdir -p "$BACKUP_DIR"
  stamp="$(date +%Y-%m-%d_%H%M%S)"
  file="$BACKUP_DIR/kompetensmatris-$stamp.json"
  while [[ -e "$file" ]]; do n=$((n + 1)); file="$BACKUP_DIR/kompetensmatris-${stamp}_$n.json"; done
  if docker cp "$c:$DATA_FILE" "$file" >/dev/null 2>&1 && [[ -s "$file" ]]; then
    touch "$file" # docker cp behåller datafilens tid; filen ska visa när kopian togs
    LAST_BACKUP="$file"
    ok "Säkerhetskopia: $file"
    # Behåll bara de senaste säkerhetskopiorna (nyast först, efter när kopian togs).
    ls -1t "$BACKUP_DIR"/kompetensmatris-*.json 2>/dev/null | tail -n +$((BACKUP_KEEP + 1)) |
      while IFS= read -r f; do rm -f -- "$f"; done
  else
    rm -f -- "$file"
    LAST_BACKUP=""
    warn "Hittade ingen datafil i $c att säkerhetskopiera (är installationen tom?)."
  fi
}

check_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker är inte installerat (kommandot docker saknas)."
  docker info >/dev/null 2>&1 || die "Docker svarar inte. Kör Docker, och är du med i gruppen docker (annars: sudo $0 ...)?"
}

ensure_env_file() {
  if [[ ! -f "$ENV_FILE" ]]; then
    if exists "$CONTAINER"; then
      say "Skapar $ENV_FILE med inställningarna från den befintliga containern"
      (umask 077
       docker container inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$CONTAINER" |
         grep -E '^(ADMIN_PASSWORD|PATH_BASE|ASPNETCORE_FORWARDEDHEADERS_ENABLED)=' > "$ENV_FILE" || true)
    else
      (umask 077
       cat > "$ENV_FILE" <<'EOF'
# Inställningar för Kompetensmatris. Läses av scripts/uppgradera.sh och skickas in i containern.
# Filen innehåller lösenordet: den finns inte i git och bara du kan läsa den.

# Lösenordet för adminläget. Byt det innan du kör skriptet.
ADMIN_PASSWORD=byt-till-ett-eget-ord

# Bakom en omvänd proxy (IIS, nginx, Traefik ...) som sköter https:
#ASPNETCORE_FORWARDEDHEADERS_ENABLED=true

# Under en undersökväg, t.ex. https://intranat/kompetens/, om proxyn INTE tar bort prefixet:
#PATH_BASE=/kompetens

# Inställningar för skriptet. Ändra bara om standardvärdena inte passar, och ändra dem
# inte efter installationen: en annan volym betyder en annan (tom) datamängd.
#KM_PORT=8080
#KM_VOLUME=kompetensdata
#KM_CONTAINER=kompetensmatris
#KM_BACKUP_KEEP=30
# Intern spegel av mcr.microsoft.com vid bygget:
#DOTNET_REGISTRY=
EOF
      )
      die "Skapade $ENV_FILE. Byt ADMIN_PASSWORD i den filen och kör skriptet igen."
    fi
  fi
  local pw
  pw="$(env_value ADMIN_PASSWORD)"
  [[ -n "$pw" ]] || die "ADMIN_PASSWORD saknas i $ENV_FILE."
  [[ "$pw" != byt-till-ett-eget-ord && "$pw" != admin ]] || die "Byt ADMIN_PASSWORD i $ENV_FILE till ett eget lösenord."
}

check_volume() {
  # En katalog på värden måste ägas av appens användare, annars kan den inte spara.
  [[ "$VOLUME" == /* || "$VOLUME" == .* ]] || return 0
  [[ -d "$VOLUME" ]] || die "Katalogen $VOLUME finns inte. Skapa den: sudo mkdir -p $VOLUME && sudo chown $APP_UID:$APP_UID $VOLUME"
  [[ "$(stat -c %u "$VOLUME")" == "$APP_UID" ]] ||
    die "Appen (uid $APP_UID) får inte skriva i $VOLUME. Kör: sudo chown -R $APP_UID:$APP_UID $VOLUME"
}

IMAGE=""
prepare_image() {
  local version="$1" repo="$2"
  [[ "$version" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || die "Ogiltig version: '$version' (t.ex. 1.1.0)."
  if [[ -n "$repo" ]]; then
    IMAGE="$repo:$version"
    if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
      say "Hämtar $IMAGE"
      docker pull "$IMAGE"
    fi
    return
  fi
  IMAGE="$LOCAL_IMAGE:$version"
  local rev=""
  if command -v git >/dev/null 2>&1 && git -C "$REPO_DIR" rev-parse --git-dir >/dev/null 2>&1; then
    rev="$(git -C "$REPO_DIR" rev-parse --short HEAD)"
    [[ -z "$(git -C "$REPO_DIR" status --porcelain)" ]] ||
      warn "Det finns ändringar i koden som inte är incheckade. De kommer med i imagen."
  fi
  say "Bygger $IMAGE från $REPO_DIR${rev:+ (commit $rev)}"
  local args=(--pull -t "$IMAGE" --label "org.opencontainers.image.version=$version")
  [[ -n "$rev" ]] && args+=(--label "org.opencontainers.image.revision=$rev")
  [[ -n "${DOTNET_REGISTRY:-}" ]] && args+=(--build-arg "DOTNET_REGISTRY=$DOTNET_REGISTRY")
  docker build "${args[@]}" "$REPO_DIR"
}

run_container() {
  docker run -d --name "$CONTAINER" \
    -p "$PORT:8080" \
    --env-file "$ENV_FILE" \
    -v "$VOLUME:/data" \
    --restart unless-stopped \
    "$1" >/dev/null
}

# ---------- Kommandon ----------

do_upgrade() {
  local version="$1" repo="$2"
  check_docker
  ensure_env_file
  check_volume
  exists "$OLD" && die "Containern $OLD finns kvar från en körning som inte blev klar. Kontrollera med 'docker ps -a' och ta bort den med 'docker rm $OLD' när du vet att den inte behövs."
  prepare_image "$version" "$repo"

  local had_old=false old_image=""
  if exists "$CONTAINER"; then
    had_old=true
    old_image="$(docker container inspect -f '{{.Config.Image}}' "$CONTAINER")"
    [[ "$old_image" != "$IMAGE" ]] || warn "$CONTAINER kör redan $IMAGE. Den startas om med samma version."
    backup "$CONTAINER"
    say "Stoppar $CONTAINER ($old_image) och behåller den som $OLD tills den nya versionen svarar"
    docker stop "$CONTAINER" >/dev/null
    docker rename "$CONTAINER" "$OLD"
  else
    say "Ingen container som heter $CONTAINER: installerar för första gången"
  fi

  say "Startar $CONTAINER med $IMAGE (volym $VOLUME, port $PORT)"
  if run_container "$IMAGE" && wait_healthy "$CONTAINER"; then
    if $had_old; then docker rm "$OLD" >/dev/null; fi
    ok "Klart. $IMAGE kör och svarar på $(health_url)"
    if $had_old; then
      echo "Förra versionen var $old_image. Backa vid behov med:"
      echo "  $0 --image ${old_image%:*} ${old_image##*:}"
    fi
    return 0
  fi

  warn "Den nya versionen startade inte eller svarade inte på $(health_url)."
  echo "--- Sista raderna i loggen för $IMAGE ---"
  docker logs --tail 40 "$CONTAINER" 2>&1 || true
  echo "---"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  if $had_old; then
    say "Backar till $old_image"
    # Lägg tillbaka datan precis som den var före bytet.
    [[ -n "$LAST_BACKUP" ]] && docker cp "$LAST_BACKUP" "$OLD:$DATA_FILE"
    docker rename "$OLD" "$CONTAINER"
    docker start "$CONTAINER" >/dev/null
    if wait_healthy "$CONTAINER"; then
      ok "Förra versionen ($old_image) kör igen med datan som den var före bytet."
    else
      warn "Förra versionen svarar inte heller. Se: docker logs $CONTAINER"
    fi
  fi
  exit 1
}

do_backup() {
  check_docker
  exists "$CONTAINER" || die "Det finns ingen container som heter $CONTAINER."
  backup "$CONTAINER"
  [[ -n "$LAST_BACKUP" ]] || exit 1
}

do_restore() {
  local file="$1"
  check_docker
  [[ -s "$file" ]] || die "Hittar inte filen $file."
  grep -q '"nodes"' "$file" || die "$file ser inte ut som en säkerhetskopia av Kompetensmatris."
  exists "$CONTAINER" || die "Det finns ingen container som heter $CONTAINER. Installera först."
  backup "$CONTAINER"
  local before="$LAST_BACKUP"
  say "Läser tillbaka $file"
  docker stop "$CONTAINER" >/dev/null
  docker cp "$file" "$CONTAINER:$DATA_FILE"
  docker start "$CONTAINER" >/dev/null
  if wait_healthy "$CONTAINER"; then
    ok "Klart. Datan från $file är tillbaka${before:+ (datan från före återläsningen finns i $before)}."
    return 0
  fi
  warn "Appen startade inte med $file. Lägger tillbaka datan som den var."
  docker logs --tail 20 "$CONTAINER" 2>&1 || true
  if [[ -n "$before" ]]; then
    docker stop "$CONTAINER" >/dev/null
    docker cp "$before" "$CONTAINER:$DATA_FILE"
    docker start "$CONTAINER" >/dev/null
    wait_healthy "$CONTAINER" && ok "Datan är som före återläsningen." || warn "Appen svarar inte. Se: docker logs $CONTAINER"
  fi
  exit 1
}

# ---------- Start ----------

MODE=upgrade
VERSION=""
IMAGE_REPO=""
RESTORE_FILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --image)     [[ $# -ge 2 ]] || die "--image behöver ett namn, t.ex. --image minorg/kompetensmatris"; IMAGE_REPO="$2"; shift 2 ;;
    --backup)    MODE=backup; shift ;;
    --aterstall) [[ $# -ge 2 ]] || die "--aterstall behöver en fil"; MODE=restore; RESTORE_FILE="$2"; shift 2 ;;
    -h|--help|--hjalp) usage; exit 0 ;;
    -*)          die "Okänt alternativ: $1 (se $0 --hjalp)" ;;
    *)           [[ -z "$VERSION" ]] || die "Ange bara en version."; VERSION="$1"; shift ;;
  esac
done

case "$MODE" in
  backup)  do_backup ;;
  restore) do_restore "$RESTORE_FILE" ;;
  upgrade)
    [[ -n "$VERSION" ]] || { usage; echo; die "Ange vilken version du installerar, t.ex. $0 1.1.0"; }
    do_upgrade "$VERSION" "$IMAGE_REPO" ;;
esac
