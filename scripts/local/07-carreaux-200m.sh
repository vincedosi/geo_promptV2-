#!/usr/bin/env bash
# Rapatrie public.carreaux_filosofi (2 298 582 lignes, 3 612 Mo de donnees,
# 4 630 Mo avec les index) depuis la prod vers le stack local, PAR TRANCHES.
#
# POURQUOI PAR TRANCHES, ET PAS UN pg_dump D'UN COUP — mesure du 2026-09-17 :
#   un `pg_dump --table=carreaux_filosofi` unique est mort a 730 Mo sur
#   « PQgetCopyData() failed : the server terminated abnormally ». Un COPY de
#   3,6 Go a travers le pooler Supavisor ne tient pas : la connexion tombe, et
#   on perd la totalite du travail deja transfere. Ici chaque tranche est une
#   connexion courte et INDEPENDANTE : une tranche qui echoue se rejoue seule
#   (DEBUT=<n>), et les precedentes sont acquises.
#
# LE TRANSFERT NE TOUCHE PAS LE DISQUE WINDOWS : les deux psql tournent DANS le
#   conteneur et sont chaines par un tube (prod COPY TO STDOUT -> local COPY
#   FROM STDIN). Rien n'est ecrit en fichier intermediaire, donc pas de 3,6 Go
#   a stocker deux fois, et aucun piege de chemin MSYS.
#
# LES INDEX GIST SONT RETIRES PENDANT LE CHARGEMENT puis rebatis a la fin.
#   Maintenir quatre index GIST au fil de 2,3 M insertions coute plusieurs fois
#   le temps de les construire d'un bloc. La cle primaire, elle, est CONSERVEE :
#   c'est elle qui rend chaque tranche idempotente (le DELETE de la plage avant
#   son chargement est alors un parcours d'index, pas un balayage complet).
set -euo pipefail
cd "$(dirname "$0")/../.."

REF="vkkdbygwbrxyogqosten"
HOTE="aws-1-eu-west-3.pooler.supabase.com"
UTIL="${DUMP_USER:-postgres}"
TAILLE_TRANCHE="${TAILLE_TRANCHE:-100000}"
ID_MAX="${ID_MAX:-2298583}"
DEBUT="${DEBUT:-0}"

if [ -z "${SUPABASE_DB_PASSWORD:-}" ] && [ -f .env.local ]; then
  SUPABASE_DB_PASSWORD=$(grep -E '^SUPABASE_DB_PASSWORD=' .env.local | head -1 | tr -d '\r' \
    | sed -E 's/^[^=]+=//; s/^"//; s/"$//' || true)
fi
[ -z "${SUPABASE_DB_PASSWORD:-}" ] && { echo "ARRET : SUPABASE_DB_PASSWORD absent"; exit 1; }

CONT=$(docker ps --filter "name=supabase_db_" --format '{{.Names}}' | head -1)
[ -z "$CONT" ] && { echo "ARRET : conteneur local eteint"; exit 1; }

URI="postgresql://${UTIL}.${REF}@${HOTE}:5432/postgres"

local_sql() {
  MSYS_NO_PATHCONV=1 docker exec -i -e PGPASSWORD=postgres "$CONT" \
    psql -v ON_ERROR_STOP=1 -U postgres -d postgres -q -c "$1"
}

if [ "$DEBUT" = "0" ]; then
  echo "[prep] retrait des index lourds (la cle primaire reste)"
  local_sql "drop index if exists public.idx_carreaux_filosofi_geom;
             drop index if exists public.idx_carreaux_filosofi_geom_3857;
             drop index if exists public.idx_carreaux_filosofi_geom_centroid;
             drop index if exists public.idx_carreaux_filosofi_geom_resolution;
             alter table public.carreaux_filosofi
               drop constraint if exists carreaux_filosofi_idcar_resolution_millesime_key;"
fi

n=0
debut_id=2
while [ "$debut_id" -le "$ID_MAX" ]; do
  n=$((n + 1))
  fin_id=$((debut_id + TAILLE_TRANCHE))
  if [ "$n" -lt "$DEBUT" ]; then debut_id=$fin_id; continue; fi

  printf "[%02d] id %8d -> %8d  " "$n" "$debut_id" "$fin_id"
  local_sql "delete from public.carreaux_filosofi where id >= $debut_id and id < $fin_id;"

  # Les deux psql tournent DANS le conteneur, chaines par un tube.
  MSYS_NO_PATHCONV=1 docker exec -i \
    -e PGPASSWORD_PROD="$SUPABASE_DB_PASSWORD" -e PGCONNECT_TIMEOUT=30 "$CONT" \
    bash -c "PGPASSWORD=\$PGPASSWORD_PROD psql '$URI' -q -c \"\\copy (select * from public.carreaux_filosofi where id >= $debut_id and id < $fin_id) to stdout\" | PGPASSWORD=postgres psql -q -U postgres -d postgres -c \"\\copy public.carreaux_filosofi from stdin\"" \
    || { echo "ECHEC tranche $n — rejouer avec DEBUT=$n"; exit 1; }

  local_sql "select 1" >/dev/null
  echo "ok"
  debut_id=$fin_id
done

echo "[final] reconstruction des index (le plus long : 4 index GIST sur 2,3 M lignes)"
local_sql "create index if not exists idx_carreaux_filosofi_geom on public.carreaux_filosofi using gist (geom);"
echo "       geom ok"
local_sql "create index if not exists idx_carreaux_filosofi_geom_3857 on public.carreaux_filosofi using gist (geom_3857);"
echo "       geom_3857 ok"
local_sql "create index if not exists idx_carreaux_filosofi_geom_centroid on public.carreaux_filosofi using gist (geom_centroid);"
echo "       geom_centroid ok"
local_sql "create index if not exists idx_carreaux_filosofi_geom_resolution on public.carreaux_filosofi using gist (geom) include (resolution);"
echo "       geom_resolution ok"
# Rétabli comme CONTRAINTE, pas comme simple index : c'est sous cette forme
# que la prod la porte (l'index n'en est que le support), et `drop index`
# echouait justement dessus.
local_sql "alter table public.carreaux_filosofi
             add constraint carreaux_filosofi_idcar_resolution_millesime_key
             unique (idcar, resolution, millesime);"
echo "       unicite idcar ok"
local_sql "analyze public.carreaux_filosofi;"

MSYS_NO_PATHCONV=1 docker exec -i -e PGPASSWORD=postgres "$CONT" psql -U postgres -d postgres -At -c \
  "select 'RESULTAT : '||count(*)||' lignes, '||pg_size_pretty(pg_total_relation_size('public.carreaux_filosofi')) from public.carreaux_filosofi;"
