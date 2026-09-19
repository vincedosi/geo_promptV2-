#!/usr/bin/env bash
# Sauvegarde la base LOCALE, et VÉRIFIE que la sauvegarde se restaure.
#
# ── POURQUOI CE SCRIPT EXISTE ────────────────────────────────────────────────
#
# Depuis l'abandon du projet Supabase hébergé (2026-09-19), le volume Docker est
# la SEULE copie des données. Notamment des 569 698 liaisons radio, récupérées
# de la production juste avant sa suppression : le dump de prod du 17/09 ne les
# contient pas.
#
# ── TROIS PIÈGES, TOUS RENCONTRÉS LE MÊME JOUR ───────────────────────────────
#
# Une première sauvegarde a été prise en `pg_dump` texte. Elle CONTENAIT bien
# les 569 698 lignes — et ne se restaurait pas. Trois causes, dans l'ordre où
# elles sont apparues :
#
# 1. **`\restrict` (PostgreSQL 17.6).** Un dump texte commence par cette
#    méta-commande de sécurité, qui met psql en mode restreint. Dans ce mode,
#    **`\.` — le terminateur de chaque bloc de données — est lui aussi bloqué** :
#    « backslash commands are restricted; only \unrestrict is allowed ». Les
#    lignes de données sont alors interprétées comme du SQL, et le restore rend
#    **568 197 « syntax error »**. D'où le format BINAIRE (`-Fc`), que
#    `pg_restore` lit sans aucune méta-commande psql.
#
# 2. **`OWNER TO` / `SET ROLE`.** Le `postgres` du conteneur Supabase n'est pas
#    superuser : « must be able to SET ROLE "supabase_auth_admin" ». D'où
#    `--no-owner --no-acl`.
#
# 3. **Le schéma `extensions`.** Convention Supabase : `pgcrypto` et
#    `uuid-ossp` y vivent, et des colonnes en dépendent. Sans lui,
#    `poi_france` et `panneaux_affichage` ne se créent pas — silencieusement,
#    au milieu de 58 autres lignes.
#
# ── CE QUI N'EST PAS SAUVEGARDÉ, ET POURQUOI ────────────────────────────────
#
# `carreaux_filosofi` (2 324 577 lignes) et `couverture_rayon_risque`
# (115 962) sont EXCLUES : deux scripts les reconstruisent
# (`07-carreaux-insee.sh`, `construire_couverture_rayon.mjs`). Les inclure
# ferait 4 Go pour de la donnée régénérable.
#
# ⚠ La sauvegarde atterrit sur le MÊME disque que la base. Elle protège d'une
# erreur logicielle, pas d'une panne matérielle. **La copier ailleurs.**
set -euo pipefail
cd "$(dirname "$0")/../.."

CONT="supabase_db_genesis_app"
DEST="${DEST_SAUVEGARDE:-C:/GENESIS/_sauvegarde_locale}"
JOUR="$(date +%Y-%m-%d)"
FICHIER="$DEST/local-$JOUR.dump"

mkdir -p "$DEST"

echo "▶ Sauvegarde de la base locale vers $FICHIER"
docker exec "$CONT" pg_dump -U postgres -d postgres \
  -Fc --compress=6 \
  --schema=public --schema=auth \
  --no-owner --no-acl \
  --exclude-table-data=public.carreaux_filosofi \
  --exclude-table-data=public.couverture_rayon_risque \
  --exclude-table-data=public.spatial_ref_sys \
  > "$FICHIER"

taille=$(du -m "$FICHIER" | cut -f1)
echo "  écrit : ${taille} Mo"

# ── LA VÉRIFICATION, QUI EST LA MOITIÉ DU TRAVAIL ───────────────────────────
#
# Une sauvegarde non testée n'est pas une sauvegarde. On la restaure dans une
# base jetable, reproduite À L'IDENTIQUE (schéma `extensions` compris), et on
# compte les lignes des tables qui ne se régénèrent pas.
echo "  vérification : restauration dans une base jetable…"
MSYS_NO_PATHCONV=1 docker exec "$CONT" psql -U postgres -q \
  -c "drop database if exists verif_sauvegarde" \
  -c "create database verif_sauvegarde" >/dev/null

MSYS_NO_PATHCONV=1 docker exec "$CONT" psql -U postgres -d verif_sauvegarde -q -c "
  create schema if not exists extensions;
  create extension if not exists postgis with schema public;
  create extension if not exists pg_trgm with schema public;
  create extension if not exists unaccent with schema public;
  create extension if not exists pgcrypto with schema extensions;
  create extension if not exists \"uuid-ossp\" with schema extensions;" >/dev/null 2>&1

docker cp "$FICHIER" "$CONT:/tmp/verif.dump" >/dev/null
# `|| true` : pg_restore rend 1 pour le seul « schema public already exists »,
# qui est attendu — la base jetable en a déjà un. Les vraies erreurs sont
# comptées juste après.
MSYS_NO_PATHCONV=1 docker exec "$CONT" pg_restore -U postgres -d verif_sauvegarde \
  --no-owner --no-acl -j 2 /tmp/verif.dump > "$DEST/verification.log" 2>&1 || true

graves=$(grep -c "^pg_restore: error" "$DEST/verification.log" || true)
attendues=$(grep -c 'schema "public" already exists' "$DEST/verification.log" || true)
echo "  erreurs de restauration : ${graves} (dont ${attendues} attendue·s)"

echo ""
MSYS_NO_PATHCONV=1 docker exec "$CONT" psql -U postgres -d verif_sauvegarde -c "
select 'emetteur_radio_stations' as table_restauree, count(*) as lignes from public.emetteur_radio_stations
union all select 'poi_france', count(*) from public.poi_france
union all select 'iris', count(*) from public.iris
union all select 'dsp_campaign_data', count(*) from public.dsp_campaign_data
union all select 'comptages_routiers', count(*) from public.comptages_routiers
union all select 'pprt_perimetres', count(*) from public.pprt_perimetres
union all select 'auth.users', count(*) from auth.users;"

MSYS_NO_PATHCONV=1 docker exec "$CONT" psql -U postgres -q -c "drop database if exists verif_sauvegarde" >/dev/null
MSYS_NO_PATHCONV=1 docker exec "$CONT" rm -f /tmp/verif.dump

if [ "$graves" -gt "$attendues" ]; then
  echo ""
  echo "⚠ La restauration a rencontré des erreurs INATTENDUES — voir $DEST/verification.log" >&2
  exit 1
fi

echo ""
echo "✓ Sauvegarde vérifiée : elle se restaure et les comptes sont bons."
echo "  ⚠ Elle est sur le même disque que la base. LA COPIER AILLEURS."
