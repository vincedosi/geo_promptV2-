#!/usr/bin/env bash
# Rapatrie `carreaux_filosofi` de la production vers la base LOCALE.
#
# ── POURQUOI CETTE TABLE, ET POURQUOI MAINTENANT ─────────────────────────────
#
# Elle est la SEULE lacune réelle du dump local. Mesuré le 2026-09-18 :
#
#     table                local        prod          écart
#     carreaux_filosofi    199 846      2 298 582     -91 %
#     poi_france           389 852        383 453     local en avance
#     iris                  49 448         49 448     identiques
#     dsp_campaign_data    477 879        477 879     identiques
#
# `02-dump-prod.sh` l'exclut volontairement (4 630 Mo). C'était défendable tant
# qu'on ne faisait que de la carte — les paliers 1/2/5/20 km suffisent jusqu'à
# z11. Ça ne l'est plus : tout calcul de POPULATION passe par ces carreaux, et
# sur 8,7 % des données il rend des chiffres faux sans le dire. C'est pour cela
# que le module « population à risque » a dû être développé contre la
# PRODUCTION, jusqu'à ce que Supabase signale l'épuisement du budget d'I/O.
#
# ── CE QUE CE SCRIPT COÛTE À LA PRODUCTION ───────────────────────────────────
#
# UNE lecture séquentielle de 4,6 Go. À ~195 Mo/s (mesure du 2026-09-13), une
# trentaine de secondes de disque.
#
# À comparer à ce qu'on évite : le pré-calcul de couverture relit les mêmes
# carreaux à chaque bande, et c'est CE martèlement qui a vidé le budget. Copier
# une fois coûte donc moins cher que calculer une fois.
#
# ── PAR LOTS, ET C'EST STRUCTUREL ────────────────────────────────────────────
#
# La VM WSL2 est plafonnée à 3 Go de RAM (`~/.wslconfig`). Un `pg_dump | psql`
# d'un bloc y tient parce que le flux n'est jamais matérialisé — mais l'index
# GIST se reconstruit alors sur 2,3 M géométries d'un coup, ce qui, lui, ne
# tient pas.
#
# On copie donc les DONNÉES seules, index déjà en place côté local, et par
# tranches d'identifiants. Chaque tranche est une transaction : une coupure
# réseau ne coûte que la tranche en cours, et le script se relance.
set -euo pipefail
cd "$(dirname "$0")/../.."

CONT="supabase_db_genesis_app"
REF="vkkdbygwbrxyogqosten"
HOTE="aws-1-eu-west-3.pooler.supabase.com"
UTIL="${DUMP_USER:-postgres}"
TABLE="carreaux_filosofi"
# 24 tranches : ~96 000 lignes chacune, soit ~190 Mo. Assez petit pour tenir en
# mémoire de la VM, assez gros pour que le coût par aller-retour reste marginal.
TRANCHES="${TRANCHES:-24}"

if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
  if [ -f .env.local ]; then
    SUPABASE_DB_PASSWORD="$(grep -E '^SUPABASE_DB_PASSWORD=' .env.local | head -1 | cut -d= -f2- | tr -d '"' | tr -d '\r')"
  fi
fi
if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
  echo "ERREUR : SUPABASE_DB_PASSWORD absent de l'environnement et de .env.local." >&2
  echo "         (le mot de passe n'est dans aucun fichier suivi par git)" >&2
  exit 1
fi

URI="postgresql://${UTIL}.${REF}@${HOTE}:5432/postgres"

# `psql` DU CONTENEUR : aucun Postgres n'est installé sous Windows, et le mot de
# passe passe par PGPASSWORD plutôt que dans l'URI — donc rien à
# percent-encoder.
distant() {
  docker exec -i -e PGPASSWORD="$SUPABASE_DB_PASSWORD" -e PGCONNECT_TIMEOUT=30 "$CONT" \
    psql "$URI" "$@"
}
local_() {
  MSYS_NO_PATHCONV=1 docker exec -i "$CONT" psql -U postgres -d postgres "$@"
}

echo "▶ Rapatriement de ${TABLE} : production -> local"

avant=$(local_ -tAc "select count(*) from public.${TABLE}")
echo "  local avant : ${avant} lignes"

total=$(distant -tAc "select count(*) from public.${TABLE}")
echo "  prod        : ${total} lignes"

if [ "$avant" = "$total" ]; then
  echo "✓ Déjà à jour, rien à faire."
  exit 0
fi

# On repart de zéro plutôt que de compléter : compléter demanderait de savoir
# QUELLES lignes manquent, donc de comparer 2,3 M identifiants entre deux bases.
# Vider et recopier est plus simple, et l'unique coût est la relecture.
echo "  purge locale…"
local_ -c "truncate public.${TABLE}"

t0=$(date +%s)
for i in $(seq 0 $((TRANCHES - 1))); do
  # Tranche par HACHAGE de l'identifiant : `id` est un uuid, donc sans ordre
  # exploitable pour un BETWEEN. `hashtext` répartit uniformément et le même
  # calcul des deux côtés garantit qu'aucune ligne n'est copiée deux fois ni
  # oubliée.
  filtre="abs(hashtext(id::text)) % ${TRANCHES} = ${i}"
  distant -c "\\copy (select * from public.${TABLE} where ${filtre}) to stdout" \
    | local_ -c "\\copy public.${TABLE} from stdin"
  n=$(local_ -tAc "select count(*) from public.${TABLE}")
  pct=$(( (i + 1) * 100 / TRANCHES ))
  printf '  [%3d %%] tranche %2d/%d · %s lignes en local · %s s\n' \
    "$pct" "$((i + 1))" "$TRANCHES" "$n" "$(( $(date +%s) - t0 ))"
done

apres=$(local_ -tAc "select count(*) from public.${TABLE}")
echo ""
if [ "$apres" = "$total" ]; then
  echo "✓ ${apres} lignes rapatriées en $(( $(date +%s) - t0 )) s — identique à la production."
else
  echo "⚠ ${apres} lignes en local contre ${total} en production. Relancer le script." >&2
  exit 1
fi

echo "  analyse de la table (les statistiques du planificateur sont vides après un COPY)…"
local_ -c "analyze public.${TABLE}"
echo "✓ Terminé."
