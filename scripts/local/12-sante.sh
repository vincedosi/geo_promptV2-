#!/usr/bin/env bash
# Dit CE QUI est cassé quand l'application ne répond pas, couche par couche.
#
# ── POURQUOI CE SCRIPT EXISTE ────────────────────────────────────────────────
#
# Le 2026-09-22, l'application affichait « Failed to fetch » sur chaque appel.
# Ce message ne dit rien : le serveur de dev tournait, le navigateur affichait
# les pages, et il a fallu une dizaine de minutes pour établir que Docker
# Desktop s'était vidé — zéro image, zéro conteneur, zéro volume.
#
# Le symptôme ment à chaque étage, et c'est la raison d'être de ce script :
#   moteur Docker éteint      -> « Failed to fetch »
#   conteneurs absents        -> « Failed to fetch »
#   Postgres en démarrage     -> « Failed to fetch »
#   GRANTs manquants          -> 401, qui envoie chercher du côté des clés JWT
#   base vide                 -> l'écran répond, avec des tableaux vides
#   pré-calculs absents       -> messages « pas encore construit », eux corrects
#
# Chaque couche est testée PAR LE CHEMIN QUE L'APPLICATION EMPRUNTE. En
# particulier PostgREST, et non `psql` : `05-verifier.sh` porte déjà cette
# leçon — c'est PostgREST que l'app appelle. Et `psql -U postgres` est
# superuser sur sa base, donc ne verra JAMAIS un droit manquant.
set -uo pipefail
cd "$(dirname "$0")/../.."

ok=0; ko=0
dire() { # $1 = ✓|⚠|✗, $2 = couche, $3 = détail
  printf '  %s %-22s %s\n' "$1" "$2" "$3"
  [ "$1" = "✗" ] && ko=$((ko+1)) || ok=$((ok+1))
}
fin() { # affiche la sortie de secours puis s'arrête
  echo ""; echo "→ $1"; echo ""; exit 1
}

echo "── Santé du stack local ────────────────────────────────────────────"

# 1. Le moteur Docker.
if ! docker info >/dev/null 2>&1; then
  dire "✗" "moteur Docker" "ne répond pas"
  fin "Démarrer Docker Desktop, puis : bash scripts/local/00-docker-up.sh"
fi
dire "✓" "moteur Docker" "$(docker info --format '{{.ServerVersion}}' 2>/dev/null)"

# 2. Le VOLUME, avant les conteneurs : c'est lui qui porte les données, et sa
#    disparition est le seul incident dont on ne revient pas sans sauvegarde.
vol=$(docker volume ls --format '{{.Name}}' 2>/dev/null | grep -c . || echo 0)
if [ "$vol" = "0" ]; then
  dire "✗" "volumes Docker" "AUCUN — les données du stack n'existent plus"
  fin "Reprise complète : 01-supabase-up.sh, puis restaurer la dernière sauvegarde
   de _sauvegarde_locale (ou de la copie hors poste), puis 11-reconstruire.sh.
   La marche à suivre est dans ARCHITECTURE.md § « Reprise du 2026-09-22 »."
fi
dire "✓" "volumes Docker" "$vol"

# 3. Les conteneurs.
CONT=$(docker ps --filter "name=supabase_db_" --format '{{.Names}}' | head -1)
nb=$(docker ps --filter "name=supabase_" --format '{{.Names}}' | grep -c . || echo 0)
if [ -z "$CONT" ]; then
  dire "✗" "conteneurs" "$nb actif(s), base absente"
  fin "bash scripts/local/01-supabase-up.sh"
fi
dire "✓" "conteneurs" "$nb actifs"

sql() { MSYS_NO_PATHCONV=1 docker exec -i -e PGPASSWORD=postgres "$CONT" \
          psql -U postgres -d postgres -tAc "$1" 2>/dev/null | tr -d ' \r'; }

# 4. Postgres.
if [ "$(sql 'select 1')" != "1" ]; then
  dire "✗" "Postgres" "n'accepte pas de requête"
  fin "docker logs $CONT --tail 40"
fi
dire "✓" "Postgres" "$(sql 'show server_version') · PostGIS $(sql 'select postgis_lib_version()')"

# 5. Le schéma.
tables=$(sql "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")
if [ "${tables:-0}" -lt 50 ]; then
  dire "✗" "schéma public" "${tables:-0} tables — la base est vide ou partielle"
  fin "Restaurer la dernière sauvegarde, puis bash scripts/local/11-reconstruire.sh"
fi
dire "✓" "schéma public" "$tables tables · $(sql "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'") fonctions"

# 6. PostgREST — le chemin réel de l'application, clé anon comprise.
#    Un 401 ici ne vient presque jamais des clés : il vient des GRANTs.
ENVF=.env.development.local
if [ -f "$ENVF" ]; then
  URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' "$ENVF" | cut -d'"' -f2)
  ANON=$(grep '^SUPABASE_ANON_KEY=' "$ENVF" | cut -d'"' -f2)
  code=$(curl -s -o /dev/null -w '%{http_code}' "$URL/rest/v1/profiles?select=id&limit=1" \
           -H "apikey: $ANON" -H "Authorization: Bearer $ANON" 2>/dev/null)
  case "$code" in
    200) dire "✓" "PostgREST (anon)" "200" ;;
    401|403)
      dire "✗" "PostgREST (anon)" "$code — droits manquants, PAS les clés"
      fin "Les GRANTs n'ont pas survécu à la restauration. Les reposer :
   bash scripts/local/11-reconstruire.sh   (son étape 0 ne fait que ça, en 2 s)" ;;
    *) dire "⚠" "PostgREST (anon)" "$code" ;;
  esac
else
  dire "⚠" "PostgREST" "$ENVF absent — lancer 04-env-local.sh"
fi

# 7. Les données qui ne se régénèrent pas. Leur absence n'empêche pas l'app de
#    démarrer : elle la rend muette, ce qui est plus difficile à voir.
echo ""
echo "── Données ─────────────────────────────────────────────────────────"
vol_table() { # $1 = table, $2 = attendu, $3 = régénérable ?
  local v; v=$(sql "select count(*) from public.$1")
  if [ "${v:-0}" -ge "$2" ]; then printf '  ✓ %-26s %s\n' "$1" "$v"
  elif [ "${v:-0}" = "0" ]; then printf '  ✗ %-26s VIDE  (%s)\n' "$1" "$3"
  else printf '  ⚠ %-26s %s  (attendu ~%s)\n' "$1" "$v" "$2"; fi
}
vol_table emetteur_radio_stations  569698 "IRREMPLAÇABLE — seule la sauvegarde la porte"
vol_table iris                      49448 "restaurer la sauvegarde"
vol_table poi_france               290877 "restaurer la sauvegarde"
vol_table carreaux_filosofi       2324577 "07-carreaux-insee.sh"
vol_table carreau_risque_distance  883451 "11-reconstruire.sh"
vol_table carreau_risque_nature   1446552 "11-reconstruire.sh"
vol_table couverture_rayon_risque   115962 "11-reconstruire.sh"
vol_table unite_population_totale    35031 "11-reconstruire.sh"

# 8. Les sauvegardes. Une base saine sans sauvegarde récente est le seul état
#    qui a l'air normal et ne l'est pas.
echo ""
echo "── Sauvegardes ─────────────────────────────────────────────────────"
DEST="${DEST_SAUVEGARDE:-C:/GENESIS/_sauvegarde_locale}"
COPIE="${COPIE_SAUVEGARDE:-$HOME/OneDrive/MAGELIAN_sauvegardes}"
compter() { ls -1 "$1"/local-*.dump 2>/dev/null | wc -l | tr -d ' '; }
recente() { ls -1t "$1"/local-*.dump 2>/dev/null | head -1; }
for d in "$DEST" "$COPIE"; do
  nbf=$(compter "$d"); r=$(recente "$d")
  if [ "${nbf:-0}" = "0" ]; then
    printf '  ✗ %-26s aucune\n' "$(basename "$d")"
  else
    jours=$(( ( $(date +%s) - $(date -r "$r" +%s) ) / 86400 ))
    sym="✓"; [ "$jours" -gt 2 ] && sym="⚠"
    printf '  %s %-26s %s fichier(s), la plus récente a %s jour(s)\n' "$sym" "$(basename "$d")" "$nbf" "$jours"
  fi
done

echo ""
[ "$ko" = "0" ] && echo "✓ Stack sain." || echo "✗ $ko couche(s) en défaut."
echo "  Sauvegarder maintenant : npm run sauvegarder"
