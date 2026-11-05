#!/usr/bin/env bash
# Restaure un EXPORT COMPLET de la base (les deux fichiers produits pour une
# passation de poste) dans le stack Supabase local fraîchement démarré.
#
# Usage :
#   bash scripts/local/14-restaurer-export.sh <dossier contenant les deux .dump>
#
# Le dossier doit contenir :
#   dentsu-explore-auth-AAAA-MM-JJ.dump    comptes (auth.users + auth.identities)
#   dentsu-explore-public-AAAA-MM-JJ.dump  schéma public COMPLET, données comprises
#
# ── POURQUOI CE SCRIPT ET PAS `10-sauvegarder.sh` / `11-reconstruire.sh` ────
#
# La sauvegarde quotidienne EXCLUT les tables régénérables (carreaux INSEE,
# couverture du module risque) : les reconstruire demande les CSV INSEE, qui ne
# sont pas dans le dépôt, et environ une heure de calcul. Un export de
# passation les INCLUT, pour qu'un poste neuf soit opérationnel en une
# commande. Ce script ne recalcule donc RIEN.
#
# ── CE QU'UN `pg_dump` NE PORTE PAS, ET QUE CE SCRIPT REPOSE ─────────────────
#
# 1. Le rôle `optimisation_service` (sql/342) : un rôle est un objet du
#    CLUSTER, pas de la base. Sans lui, les GRANT du dump qui le nomment
#    échouent. Créé ici SANS LOGIN ; `13-optimisation-up.sh` lui donne un mot
#    de passe le jour où l'on démarre le service Python.
# 2. Les réglages de rôles locaux (délai des requêtes de `service_role`,
#    planificateur de `postgres`) : `ALTER ROLE ... SET` vit lui aussi hors de
#    la base. Ce sont ceux de `03-restore-local.sh`.
# 3. Le schéma `auth` ne se supprime pas : il appartient à `supabase_admin`, et
#    le `postgres` du conteneur n'est pas superuser. On y injecte les COMPTES
#    seuls, en données, avant `public` (des clés étrangères de `public`
#    pointent sur `auth.users`).
#
# ── ERREURS ATTENDUES DE pg_restore ─────────────────────────────────────────
#
#   schema "public" already exists                    — recréé ici avant, avec PostGIS
#   permission denied to change default privileges    — ALTER DEFAULT PRIVILEGES
#                                                       FOR ROLE supabase_admin, sans effet en local
# Toute AUTRE erreur fait échouer le script. Voir `10-sauvegarder.sh` pour le
# détail de ces deux-là, et pour la raison du comptage par marqueur `ERROR:`.
#
# Variable : BASE (défaut `postgres`). Une autre valeur restaure dans une base
# jetable du même conteneur — c'est ainsi que l'export a été vérifié avant
# envoi. Les réglages de rôles et le redémarrage de PostgREST ne sont alors
# PAS appliqués : ils visent la vraie base.
set -euo pipefail
cd "$(dirname "$0")/../.."

DOSSIER="${1:-}"
BASE="${BASE:-postgres}"
CONT="supabase_db_genesis_app"

if [ -z "$DOSSIER" ] || [ ! -d "$DOSSIER" ]; then
  echo "Usage : bash scripts/local/14-restaurer-export.sh <dossier des deux fichiers .dump>" >&2
  exit 1
fi
AUTH=$(ls "$DOSSIER"/dentsu-explore-auth-*.dump 2>/dev/null | sort | tail -1)
PUBLIC=$(ls "$DOSSIER"/dentsu-explore-public-*.dump 2>/dev/null | sort | tail -1)
if [ -z "$AUTH" ] || [ -z "$PUBLIC" ]; then
  echo "⛔ Dans $DOSSIER, il manque dentsu-explore-auth-*.dump ou dentsu-explore-public-*.dump" >&2
  exit 1
fi
if ! docker ps --format '{{.Names}}' | grep -qx "$CONT"; then
  echo "⛔ Conteneur $CONT introuvable : lancer d'abord scripts/local/00-docker-up.sh puis 01-supabase-up.sh" >&2
  exit 1
fi

sql() { # $1 = base, $2 = requête
  MSYS_NO_PATHCONV=1 docker exec -i "$CONT" psql -v ON_ERROR_STOP=1 -U postgres -d "$1" -q -c "$2"
}
compter() { # $1 = requête qui rend un nombre
  MSYS_NO_PATHCONV=1 docker exec -i "$CONT" psql -U postgres -d "$BASE" -tAc "$1" | tr -d '[:space:]'
}

echo "▶ Restauration de l'export dans la base « $BASE » du conteneur $CONT"
echo "  comptes : $(basename "$AUTH") ($(du -h "$AUTH" | cut -f1))"
echo "  public  : $(basename "$PUBLIC") ($(du -h "$PUBLIC" | cut -f1))"

if [ "$BASE" != "postgres" ]; then
  echo "[0/6] base jetable $BASE"
  sql postgres "drop database if exists $BASE"
  sql postgres "create database $BASE"
fi

echo "[1/6] rôle optimisation_service (sans login)"
sql postgres "do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'optimisation_service') then
    create role optimisation_service nologin;
  end if; end \$\$;"

echo "[2/6] remise à zéro du schéma public + extensions"
existantes=$(compter "select count(*) from pg_tables where schemaname = 'public' and tablename <> 'spatial_ref_sys'")
if [ "$BASE" = "postgres" ] && [ "${existantes:-0}" != "0" ] && [ "${FORCER:-0}" != "1" ]; then
  echo "⛔ La base contient déjà $existantes tables dans public. Les écraser : FORCER=1 bash $0 $DOSSIER" >&2
  exit 1
fi
sql "$BASE" "drop schema if exists public cascade;
  create schema public;
  grant usage on schema public to anon, authenticated, service_role;
  create schema if not exists extensions;
  create extension if not exists postgis with schema public;
  create extension if not exists pg_trgm with schema public;
  create extension if not exists unaccent with schema public;
  create extension if not exists pgcrypto with schema extensions;
  create extension if not exists \"uuid-ossp\" with schema extensions;
  create extension if not exists http with schema extensions;"

docker cp "$AUTH" "$CONT:/tmp/export-auth.dump" >/dev/null
docker cp "$PUBLIC" "$CONT:/tmp/export-public.dump" >/dev/null

JOURNAL="$DOSSIER/restauration-$BASE.log"
: > "$JOURNAL"

echo "[3/6] comptes (auth.users puis auth.identities)"
if [ "$BASE" = "postgres" ]; then
  comptes=$(compter "select count(*) from auth.users")
  if [ "${comptes:-0}" != "0" ]; then
    echo "  $comptes compte(s) déjà présent(s) : remplacés par ceux de l'export"
    sql "$BASE" "delete from auth.identities; delete from auth.users;"
  fi
fi
# Une base jetable n'a pas de schéma auth (il naît de GoTrue dans `postgres`) :
# on n'y restaure que public, les clés étrangères vers auth.users sont alors
# créées sans cible et échouent — d'où la restauration de la STRUCTURE auth
# dans ce seul cas.
if [ "$BASE" != "postgres" ]; then
  MSYS_NO_PATHCONV=1 docker exec "$CONT" sh -c \
    "pg_dump -U postgres -d postgres --schema-only --schema=auth --no-owner --no-acl | psql -U postgres -d $BASE -q" \
    > "$DOSSIER/structure-auth-$BASE.log" 2>&1 || true
fi
MSYS_NO_PATHCONV=1 docker exec "$CONT" pg_restore -U postgres -d "$BASE" --data-only \
  -t users /tmp/export-auth.dump >> "$JOURNAL" 2>&1 || true
MSYS_NO_PATHCONV=1 docker exec "$CONT" pg_restore -U postgres -d "$BASE" --data-only \
  -t identities /tmp/export-auth.dump >> "$JOURNAL" 2>&1 || true
echo "  comptes restaurés : $(compter "select count(*) from auth.users")"

echo "[4/6] schéma public, données comprises (2 min mesurées le 2026-11-05, davantage sur un poste plus lent)"
debut=$(date +%s)
MSYS_NO_PATHCONV=1 docker exec "$CONT" pg_restore -U postgres -d "$BASE" \
  --no-owner -j 2 /tmp/export-public.dump >> "$JOURNAL" 2>&1 || true
echo "  terminé en $(( ($(date +%s) - debut) / 60 )) min"
MSYS_NO_PATHCONV=1 docker exec "$CONT" rm -f /tmp/export-auth.dump /tmp/export-public.dump

graves=$(grep -o 'ERROR:' "$JOURNAL" | wc -l | tr -d ' ')
attendues=$(grep -oE 'ERROR:  (schema "public" already exists|permission denied to change default privileges)' \
              "$JOURNAL" | wc -l | tr -d ' ')
echo "  erreurs : $graves (dont $attendues attendue·s) — journal : $JOURNAL"

# Le déclencheur qui crée le profil d'un nouveau compte vit sur `auth.users`,
# donc HORS du schéma public exporté — et `drop schema public cascade` l'a
# emporté avec `handle_new_user()`. Posé APRÈS la restauration des comptes :
# présent avant, il aurait créé des profils en double de ceux du dump.
sql "$BASE" "drop trigger if exists on_auth_user_created on auth.users;
  create trigger on_auth_user_created after insert on auth.users
    for each row execute function public.handle_new_user();"

if [ "$BASE" = "postgres" ]; then
  echo "[5/6] réglages locaux des rôles + rechargement de PostgREST"
  sql postgres "alter role service_role set statement_timeout = '30min'"
  sql postgres "alter role postgres set effective_cache_size = '1536MB'"
  sql postgres "alter role postgres set random_page_cost = 1.1"
  sql postgres "analyze"
  docker restart supabase_rest_genesis_app >/dev/null 2>&1 || true
else
  echo "[5/6] base jetable : réglages de rôles et PostgREST non touchés"
fi

echo "[6/6] contrôle"
MSYS_NO_PATHCONV=1 docker exec "$CONT" psql -U postgres -d "$BASE" -c "
select 'auth.users' as table_restauree, count(*) as lignes from auth.users
union all select 'iris', count(*) from public.iris
union all select 'poi_france', count(*) from public.poi_france
union all select 'emetteur_radio_stations', count(*) from public.emetteur_radio_stations
union all select 'dsp_campaign_data', count(*) from public.dsp_campaign_data
union all select 'carreaux_filosofi', count(*) from public.carreaux_filosofi
union all select 'couverture_rayon_risque', count(*) from public.couverture_rayon_risque
union all select 'carreau_risque_distance', count(*) from public.carreau_risque_distance;"

# Les droits, et non les seules lignes : c'est PostgREST que l'application
# appelle, et `psql -U postgres` ne verrait jamais un GRANT manquant.
manquants=$(compter "select count(*) from (
  select 1 from (values ('anon'),('authenticated'),('service_role')) r(rolname)
  cross join (values ('public.profiles'),('public.poi_france'),('public.dsp_campaign_data')) t(tbl)
  where not has_table_privilege(r.rolname, t.tbl, 'select')) x")
echo "  droits manquants (3 rôles × 3 tables) : $manquants"

if [ "$BASE" != "postgres" ] && [ "${GARDER:-0}" != "1" ]; then
  sql postgres "drop database if exists $BASE"
fi

if [ "$graves" != "$attendues" ] || [ "${manquants:-9}" != "0" ]; then
  echo "" >&2
  echo "⛔ Restauration INCOMPLÈTE : erreurs inattendues ou droits manquants. Lire $JOURNAL" >&2
  exit 1
fi
echo ""
echo "✓ Export restauré. Suite : bash scripts/local/04-env-local.sh, puis npm run dev."
