#!/usr/bin/env bash
# Controle de bon fonctionnement du stack local, APRES restore.
# Verifie trois choses distinctes, parce qu'elles cassent independamment :
#   1. les conteneurs tournent          (Docker / WSL2)
#   2. la base porte bien les donnees   (restore reussi)
#   3. PostgREST expose la base         (c'est CELA que l'app appelle, pas psql)
set -euo pipefail
cd "$(dirname "$0")/../.."

CONTENEUR=$(docker ps --filter "name=supabase_db_" --format '{{.Names}}' | head -1)
[ -z "$CONTENEUR" ] && { echo "⛔ base locale eteinte — scripts/local/01-supabase-up.sh"; exit 1; }

echo "[1/3] conteneurs"
docker ps --filter "name=supabase" --format '  {{.Names}}  {{.Status}}'

echo "[2/3] volumetrie en base"
docker exec -i -e PGPASSWORD=postgres "$CONTENEUR" psql -U postgres -d postgres -At -c "
select format('  %-24s %s lignes', t, n) from (
  select 'iris'              as t, count(*) as n from iris
  union all select 'ref_codes_postaux',  count(*) from ref_codes_postaux
  union all select 'poi_france',         count(*) from poi_france
  union all select 'carreaux_1km',       count(*) from carreaux_1km
  union all select 'carreaux_filosofi',  count(*) from carreaux_filosofi
  union all select 'dsp_campaigns',      count(*) from dsp_campaigns
  union all select 'campaign_cp_rollup', count(*) from campaign_cp_rollup
  union all select 'auth.users',         count(*) from auth.users
) x;" 2>&1 || echo "  ⚠ tables absentes — le restore (03) a-t-il tourne ?"

# `carreaux_filosofi` merite un verdict et pas seulement un compte : c'est la
# SEULE table dont un remplissage partiel ne casse rien visiblement. Tout marche,
# la carte s'affiche, les calculs aboutissent — et les populations exposees sont
# simplement trop basses. Le 2026-09-18, une base a 8,7 % rendait « 5 804
# habitants exposes en France » la ou le chiffre est de 421 214.
n_car=$(docker exec -i -e PGPASSWORD=postgres "$CONTENEUR" psql -U postgres -d postgres -At   -c "select count(*) from carreaux_filosofi" 2>/dev/null || echo 0)
if [ "${n_car:-0}" -ge 2324577 ]; then
  echo "  ✓ carreaux 200 m complets (metropole + Martinique + Reunion)"
elif [ "${n_car:-0}" -ge 2298582 ]; then
  echo "  ✓ carreaux 200 m complets pour la metropole ; DROM absents"
  echo "    (les charger : scripts/local/07-carreaux-insee.sh)"
else
  echo "  ⚠ carreaux 200 m INCOMPLETS : ${n_car} sur 2 324 577 attendus."
  echo "    Les populations exposees seront trop basses SANS aucun message d'erreur."
  echo "    Charger la source INSEE : scripts/local/07-carreaux-insee.sh"
fi

echo "[3/3] PostgREST (ce que l'app appelle)"
ANON=$(npx supabase status -o env | grep -E '^ANON_KEY=' | sed -E 's/^[^=]+=//; s/^"//; s/"$//')
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  "http://127.0.0.1:54321/rest/v1/ref_codes_postaux?select=code_postal&limit=1")
echo "  GET /rest/v1/ref_codes_postaux -> HTTP $code"
[ "$code" = "200" ] && echo "  ✓ la couche PostgREST repond" || echo "  ⚠ PostgREST ne sert pas la table (RLS ? schema absent ?)"

echo
echo "Studio : http://127.0.0.1:54323 · mails : http://127.0.0.1:54324"
echo "Ensuite : npm run dev  (avec .env.development.local en place)"
