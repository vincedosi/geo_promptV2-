#!/usr/bin/env bash
# Restaure le dump de prod dans le Postgres local (port 54322).
#
# Le psql utilise est celui du conteneur de la base : aucune installation
# Postgres n'est requise sur Windows.
#
# Ordre imperatif : remise a zero + extensions -> comptes auth -> public
# (schema, donnees puis contraintes, dans cet ordre-la par pg_dump lui-meme).
#
# Les fichiers sont COPIES dans le conteneur (docker cp) puis joues avec
# psql -f, plutot que pousses dans stdin de docker exec : sur 1,1 Go depuis
# Git Bash sous Windows, la redirection stdin est fragile — et muette quand
# elle tronque.
#
# Tolerance aux erreurs : auth.sql seul passe en ON_ERROR_STOP=0 (il rejoue des
# lignes que GoTrue cree deja lui-meme en local). Sur public.sql, une erreur
# DOIT arreter : un restore partiel qui se croit fini est pire qu'un restore
# rate.
set -euo pipefail
cd "$(dirname "$0")/../.."

DUMP_DIR="${DUMP_DIR:-/c/GENESIS/_dump_prod}"
CONTENEUR=$(docker ps --filter "name=supabase_db_" --format '{{.Names}}' | head -1)

if [ -z "$CONTENEUR" ]; then
  echo "ARRET : conteneur de base introuvable — lancer scripts/local/01-supabase-up.sh"
  exit 1
fi
echo "-> restore vers $CONTENEUR depuis $DUMP_DIR"

# PIEGE WINDOWS : Git Bash (MSYS) reecrit tout argument qui ressemble a un
# chemin absolu Unix. `psql -f /tmp/restore.sql` arrivait dans le conteneur
# sous la forme C:/Users/.../Temp/restore.sql, et psql repondait « No such file
# or directory » en citant un chemin qui n'a jamais existe la-bas.
# MSYS_NO_PATHCONV=1 desactive cette traduction — mais SEULEMENT sur ce qui
# s'execute DANS le conteneur. Le docker cp, lui, doit la GARDER : sa source est
# un vrai chemin Windows. Sa destination conteneur:/tmp/... n'est de toute facon
# jamais traduite, a cause du deux-points.
jouer() { # $1 = fichier, $2 = 1 pour tolerer les erreurs
  local f="$1" stop=1
  [ "${2:-0}" = "1" ] && stop=0
  if [ ! -s "$f" ]; then echo "  (ignore : $(basename "$f") absent ou vide)"; return 0; fi
  echo "  $(basename "$f") — $(du -h "$f" | cut -f1)"
  docker cp "$f" "$CONTENEUR:/tmp/restore.sql" >/dev/null
  MSYS_NO_PATHCONV=1 docker exec -i -e PGPASSWORD=postgres "$CONTENEUR" \
    psql -v ON_ERROR_STOP="$stop" -U postgres -d postgres -q -f /tmp/restore.sql
  MSYS_NO_PATHCONV=1 docker exec -i "$CONTENEUR" rm -f /tmp/restore.sql
}
sql() {
  MSYS_NO_PATHCONV=1 docker exec -i -e PGPASSWORD=postgres "$CONTENEUR" \
    psql -v ON_ERROR_STOP=1 -U postgres -d postgres -q -c "$1"
}

echo "[1/3] remise a zero de public + extensions aux versions de la prod"
# DESTRUCTIF, mais UNIQUEMENT sur la base LOCALE : on repart d'un `public` vide
# pour que ce script soit rejouable. Sans ca, un second passage echoue des le
# premier CREATE TYPE (« already exists ») et laisse une base a moitie chargee,
# l'etat le plus penible a diagnostiquer.
#
# Les extensions ne sont PAS dans le dump, et PostGIS habite `public` en prod :
# elles doivent etre recreees APRES le drop et AVANT le schema, sinon le type
# `geometry` n'existe pas et tout le reste tombe.
echo "      (base LOCALE reinitialisee — la prod n'est pas touchee)"
sql "drop schema if exists public cascade;
     create schema public;
     create extension if not exists postgis with schema public;
     create extension if not exists pg_trgm with schema public;
     create extension if not exists unaccent with schema public;
     create extension if not exists http with schema extensions;"

# Les comptes AVANT `public` : mesure en base, DIX-HUIT contraintes de `public`
# pointent vers auth.users (created_by, user_id, profiles.id...). Elles sont
# posees en fin de public.sql et leur validation echoue si les comptes ne sont
# pas deja la.
echo "[2/3] comptes auth"
jouer "$DUMP_DIR/auth.sql" 1

# Deux neutralisations, sur une COPIE (le dump d'origine reste intact) :
#  1. CREATE SCHEMA public; — le schema existe deja ici, et c'est lui qui porte
#     PostGIS ; on ne peut pas le recreer sans emporter l'extension dont toutes
#     les colonnes `geometry` dependent.
#  2. les 24 ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin de la fin du
#     fichier : le `postgres` du conteneur Supabase n'est pas superuser et ne
#     peut pas fixer les privileges par defaut D'UN AUTRE ROLE. Sans
#     consequence — ces lignes ne regissent que des objets crees PLUS TARD par
#     ce role, et rien ne cree de table en local. Celles FOR ROLE postgres sont
#     conservees et s'appliquent.
echo "[3/3] public : schema, donnees, puis contraintes et index"
sed -E 's|^CREATE SCHEMA public;$|-- CREATE SCHEMA public; neutralise par 03-restore-local.sh|; s|^(ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin.*)$|-- \1|' \
  "$DUMP_DIR/public.sql" > "$DUMP_DIR/public.local.sql"
jouer "$DUMP_DIR/public.local.sql"


# ── Delai d'expiration des requetes, cote LOCAL SEULEMENT ────────────────────
#
# Mesure du 2026-09-18 : en local, le role `authenticator` (celui par lequel
# PostgREST ouvre ses connexions) porte `statement_timeout=8s`, et `service_role`
# n'en declare aucun — il herite donc des 8 s. C'est BIEN PLUS SERRE que la
# production, ou le meme chemin dispose de 2 min.
#
# Consequence concrete : les outils de CONSTRUCTION (pre-calcul de couverture
# par rayon, materialisation d'indicateurs) travaillent par lots de 20 a 30 s et
# etaient annules a chaque fois, sans jamais pouvoir aboutir — le message parle
# d'un delai depasse, pas d'un lot trop gros, et on cherche longtemps du cote du
# volume.
#
# 30 min et pas 0 : un plafond desserre reste un plafond. Une requete partie en
# vrille sur un poste de dev doit finir par rendre la main.
#
# ⚠ Ne JAMAIS porter cette ligne en production. Le delai de 2 min y est un
# garde-fou du budget d'I/O, pas une gene.
echo
echo "-> delai des requetes PostgREST porte a 30 min (LOCAL uniquement)"
MSYS_NO_PATHCONV=1 docker exec -i -e PGPASSWORD=postgres "$CONTENEUR" psql -U postgres -d postgres -q -c   "alter role service_role set statement_timeout = '30min'"
# Les connexions deja dans le pool gardent l'ancienne valeur : elle est lue au
# SET ROLE, donc a l'ouverture de la session.
docker restart supabase_rest_genesis_app >/dev/null 2>&1 || true

# ── Le planificateur local croit tourner sur un disque mecanique sans cache ──
#
# Mesure du 2026-09-18, base locale : `effective_cache_size` = 128 Mo, soit
# EXACTEMENT `shared_buffers`. Le planificateur en deduit qu'aucun cache systeme
# n'existe et prefere le balayage sequentiel a l'index sur a peu pres tout. La
# production annonce 768 Mo. Et `random_page_cost` vaut 4.0, le defaut d'un
# disque a plateaux, alors que le volume Docker est sur SSD.
#
# Consequence mesuree : 14 Go de fichiers temporaires ecrits pendant le
# pre-calcul de couverture, et 79 % seulement de succes de cache.
#
# `effective_cache_size` n'ALLOUE rien — c'est une estimation, pas une
# reservation. Les deux sont poses sur le ROLE et non par ALTER SYSTEM : le
# `postgres` du conteneur Supabase n'est pas superuser et se voit refuser
# « permission denied to set parameter ».
echo "-> planificateur local : effective_cache_size 1,5 Go, random_page_cost 1.1"
MSYS_NO_PATHCONV=1 docker exec -i -e PGPASSWORD=postgres "$CONTENEUR" psql -U postgres -d postgres -q   -c "alter role postgres set effective_cache_size = '1536MB'"
MSYS_NO_PATHCONV=1 docker exec -i -e PGPASSWORD=postgres "$CONTENEUR" psql -U postgres -d postgres -q   -c "alter role postgres set random_page_cost = 1.1"

echo
echo "-> controle : tables les plus grosses en local"
MSYS_NO_PATHCONV=1 docker exec -i -e PGPASSWORD=postgres "$CONTENEUR" psql -U postgres -d postgres -c "
select c.relname, pg_size_pretty(pg_total_relation_size(c.oid)) as taille
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','m')
order by pg_total_relation_size(c.oid) desc limit 12;"
