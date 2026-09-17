#!/usr/bin/env bash
# Dump du projet Supabase de prod (vkkdbygwbrxyogqosten) vers $DUMP_DIR.
#
# Produit DEUX fichiers :
#   auth.sql    — comptes (auth.users + auth.identities), pour se connecter en local
#   public.sql  — schema ET donnees de `public`, dans le MEME fichier
#
# UN SEUL FICHIER POUR public, ET C'EST STRUCTUREL — ne pas re-separer schema
#   et donnees. Un dump --data-only emet les COPY dans l'ordre ALPHABETIQUE des
#   tables, contraintes actives : `activation_cibles` se charge avant
#   `activation_lots` qu'elle reference, et le restore casse. Un dump COMPLET
#   ordonne pre-data (tables) -> data (COPY) -> post-data (contraintes, index,
#   policies, triggers) : aucune cle etrangere n'est verifiee pendant le
#   chargement, et les index sont batis APRES, donc bien plus vite. Effet de
#   bord bienvenu : l'auto-reference de `radios`, que pg_dump signale comme
#   circulaire, ne demande plus aucun bricolage.
#
# PERIMETRE (arbitrage du 2026-09-17, « socle fonctionnel ») : on exclut les
# DONNEES de trois tables, leur STRUCTURE reste (--exclude-table-data) —
#   public.carreaux_filosofi  4 630 Mo — ne sert que les tuiles z>=12 ; les
#                             paliers 1/2/5/20 km sont conserves, donc la carte
#                             fonctionne jusqu'a z11.
#   public.comptages_routiers   701 Mo — dont 99,7 % est le proxy OSM a 11
#                             valeurs constantes, pas du TMJA mesure.
#   public.spatial_ref_sys      — table systeme PostGIS, deja peuplee en local.
# Reste ~1,1 Go : IRIS, POI, campagnes DSP, radio, referentiels, carreaux agreges.
#
# POURQUOI PAS `supabase db dump` (le CLI) : il execute un SET ROLE "postgres"
#   en tete de session. Un role de dump restreint n'a pas ce droit et le dump
#   echoue en « permission denied to set role ». pg_dump appele directement ne
#   fait rien de tel — et c'est celui du CONTENEUR LOCAL, en 17.6, donc aucune
#   installation Postgres sur Windows.
#
# SEULS `public` ET DEUX TABLES D'`auth` SONT DUMPES. Verifie en base : les 109
#   objets applicatifs sont tous dans `public` ; `auth`, `storage`, `realtime`,
#   `vault`, `extensions` et `supabase_migrations` appartiennent au stack, qui
#   les recree lui-meme en local. Les EXTENSIONS ne sont pas dans le dump
#   (niveau base, pas niveau schema) : le script 03 les cree explicitement, aux
#   versions exactes de la prod.
#
# ON GARDE LES GRANTs (pas de --no-privileges) : `anon`, `authenticated` et
#   `service_role` en dependent, et c'est par eux que PostgREST — donc l'app —
#   lit les tables. Sans les GRANTs, la base serait pleine et l'app vide.
#
# CHEMIN RESEAU — mesure le 2026-09-17, ne pas le « simplifier » :
#   * db.vkkdbygwbrxyogqosten.supabase.co n'a QU'UN enregistrement AAAA (IPv6)
#     et n'est PAS joignable depuis ce poste (IPv4 directe = option payante).
#   * Des deux hotes de pooler de la region, seul `aws-1` sert ce projet :
#     `aws-0` repond « tenant/user not found ». C'est ainsi qu'il a ete
#     identifie, sans connaitre le mot de passe.
#   * PORT 5432 = mode SESSION, obligatoire : en 6543 (mode transaction),
#     pg_dump ne peut pas travailler.
#
# LE ROLE DU DUMP DOIT AVOIR BYPASSRLS : 91 tables de `public` ont RLS actif et
#   143 policies existent. Sans ce droit, pg_dump ramene des tables partielles
#   ou VIDES sans aucune erreur.
#
# Identifiants : mot de passe dans SUPABASE_DB_PASSWORD (env, ou .env.local qui
#   est gitignore), utilisateur dans DUMP_USER (defaut `postgres`). Passe par
#   PGPASSWORD, jamais dans l'URI — donc aucun souci de percent-encoding.
set -euo pipefail
cd "$(dirname "$0")/../.."

DUMP_DIR="${DUMP_DIR:-/c/GENESIS/_dump_prod}"
REF="vkkdbygwbrxyogqosten"
HOTE="aws-1-eu-west-3.pooler.supabase.com"
UTIL="${DUMP_USER:-postgres}"

if [ -z "${SUPABASE_DB_PASSWORD:-}" ] && [ -f .env.local ]; then
  SUPABASE_DB_PASSWORD=$(grep -E '^SUPABASE_DB_PASSWORD=' .env.local | head -1 | tr -d '\r' \
    | sed -E 's/^[^=]+=//; s/^"//; s/"$//' || true)
fi
if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
  echo "ARRET : SUPABASE_DB_PASSWORD absent (.env.local ou environnement)."
  echo "        Dashboard Supabase > Project Settings > Database > Reset database password."
  exit 1
fi

CONT=$(docker ps --filter "name=supabase_db_" --format '{{.Names}}' | head -1)
[ -z "$CONT" ] && { echo "ARRET : conteneur de base local eteint — lancer 01-supabase-up.sh"; exit 1; }

URI="postgresql://${UTIL}.${REF}@${HOTE}:5432/postgres"
pgdump() { docker exec -i -e PGPASSWORD="$SUPABASE_DB_PASSWORD" -e PGCONNECT_TIMEOUT=30 "$CONT" pg_dump "$@"; }

mkdir -p "$DUMP_DIR"
echo "-> dump dans $DUMP_DIR (utilisateur $UTIL, via $HOTE, mode session)"

echo "[1/2] comptes auth"
pgdump "$URI" --data-only --no-owner --table=auth.users --table=auth.identities \
  > "$DUMP_DIR/auth.sql" || echo "      dump auth refuse — compte local a creer a la main"
echo "      $(du -h "$DUMP_DIR/auth.sql" | cut -f1)"

echo "[2/2] public : schema ET donnees dans un seul fichier"
pgdump "$URI" --schema=public --no-owner \
  --exclude-table-data=public.carreaux_filosofi \
  --exclude-table-data=public.comptages_routiers \
  --exclude-table-data=public.spatial_ref_sys > "$DUMP_DIR/public.sql"
echo "      $(du -h "$DUMP_DIR/public.sql" | cut -f1)"

ls -lh "$DUMP_DIR"
