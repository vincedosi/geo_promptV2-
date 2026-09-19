#!/usr/bin/env bash
# Rapatrie les DEUX tables que 02-dump-prod.sh exclut volontairement :
#   public.carreaux_filosofi   4 630 Mo — carreaux INSEE 200 m, tuiles z>=12
#   public.comptages_routiers    701 Mo — calque flux routier
#
# A lancer seulement si l'on veut un local VRAIMENT complet : sans elles,
# `get_tile(12,...)` rend 0 octet et le calque flux routier est vide — ce qui
# est le comportement attendu, pas un bug.
#
# Chaque table est dumpee ENTIEREMENT (schema + donnees) avec --clean
# --if-exists : le fichier commence donc par un DROP TABLE, puis recree la
# table, charge les donnees, et ne pose ses INDEX QU'APRES. C'est capital ici :
# construire un index GIST au fil de 2,3 M insertions coute plusieurs fois le
# temps de le batir d'un coup a la fin. Verifie avant d'ecrire ce script :
# aucune vue ni vue materialisee ne depend de ces deux tables, le DROP est donc
# sans effet de bord.
#
# Memes contraintes que 02 : pooler aws-1 en mode session (port 5432), role
# avec BYPASSRLS, mot de passe par PGPASSWORD.
set -euo pipefail
cd "$(dirname "$0")/../.."

DUMP_DIR="${DUMP_DIR:-/c/GENESIS/_dump_prod}"
REF="vkkdbygwbrxyogqosten"
HOTE="aws-1-eu-west-3.pooler.supabase.com"
UTIL="${DUMP_USER:-postgres}"
TABLES="${TABLES:-public.carreaux_filosofi public.comptages_routiers}"

if [ -z "${SUPABASE_DB_PASSWORD:-}" ] && [ -f .env.local ]; then
  SUPABASE_DB_PASSWORD=$(grep -E '^SUPABASE_DB_PASSWORD=' .env.local | head -1 | tr -d '\r' \
    | sed -E 's/^[^=]+=//; s/^"//; s/"$//' || true)
fi
[ -z "${SUPABASE_DB_PASSWORD:-}" ] && { echo "ARRET : SUPABASE_DB_PASSWORD absent"; exit 1; }

CONT=$(docker ps --filter "name=supabase_db_" --format '{{.Names}}' | head -1)
[ -z "$CONT" ] && { echo "ARRET : conteneur local eteint"; exit 1; }

URI="postgresql://${UTIL}.${REF}@${HOTE}:5432/postgres"
mkdir -p "$DUMP_DIR"

for t in $TABLES; do
  court="${t#public.}"
  echo "[dump] $t"
  docker exec -i -e PGPASSWORD="$SUPABASE_DB_PASSWORD" -e PGCONNECT_TIMEOUT=30 "$CONT" \
    pg_dump "$URI" --no-owner --clean --if-exists --table="$t" > "$DUMP_DIR/$court.sql"
  echo "       $(du -h "$DUMP_DIR/$court.sql" | cut -f1)"
done

for t in $TABLES; do
  court="${t#public.}"
  echo "[restore] $court (donnees puis index — peut prendre 20-40 min sur le 200 m)"
  docker cp "$DUMP_DIR/$court.sql" "$CONT:/tmp/restore.sql" >/dev/null
  MSYS_NO_PATHCONV=1 docker exec -i -e PGPASSWORD=postgres "$CONT" \
    psql -v ON_ERROR_STOP=1 -U postgres -d postgres -q -f /tmp/restore.sql
  MSYS_NO_PATHCONV=1 docker exec -i "$CONT" rm -f /tmp/restore.sql
  MSYS_NO_PATHCONV=1 docker exec -i -e PGPASSWORD=postgres "$CONT" \
    psql -U postgres -d postgres -At -c "select '       $court : '||count(*)||' lignes, '||pg_size_pretty(pg_total_relation_size('public.$court')) from public.$court;"
done
