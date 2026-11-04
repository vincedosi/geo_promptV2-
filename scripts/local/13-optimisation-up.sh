#!/usr/bin/env bash
# Démarre le service d'optimisation Python (services/optimisation/) sur le stack local.
#
# À lancer APRÈS 00-docker-up.sh et 01-supabase-up.sh : le conteneur rejoint le
# réseau `supabase_network_genesis_app` créé par `supabase start` et parle à
# Postgres par `supabase_db_genesis_app:5432`.
#
# Étapes :
#   1. vérifie le moteur Docker, le réseau et le conteneur Postgres ;
#   2. si services/optimisation/.env n'existe pas, l'ÉCRIT avec un mot de passe
#      et une clé interne tirés au hasard (fichier ignoré par git, jamais affiché) ;
#   3. applique sql/342 (rôle optimisation_service, idempotent) avec le mot de
#      passe de .env — chaque passage réaligne le rôle sur le fichier. Le mot de
#      passe n'atteint JAMAIS Postgres en clair : haché en SCRAM-SHA-256 côté
#      client (optimisation.outils.scram, lu sur stdin), seul le vérificateur
#      part dans ALTER ROLE — la base journalise le DDL (log_statement = ddl) et
#      pg_stat_statements garde le texte (relecture A, I1) ;
#   4. construit et démarre le conteneur (docker compose up -d --build) ;
#   5. interroge GET /sante avec la clé interne, jusqu'à 30 s.
#
# Arrêt : docker compose -f services/optimisation/compose.yaml down
set -euo pipefail
cd "$(dirname "$0")/../.."

SERVICE=services/optimisation
ENV_FICHIER="$SERVICE/.env"
CONTENEUR_PG="${CONTENEUR_PG:-supabase_db_genesis_app}"
RESEAU=supabase_network_genesis_app

echo "── Service d'optimisation ──────────────────────────────────────────"

docker info >/dev/null 2>&1 || { echo "✗ moteur Docker éteint → bash scripts/local/00-docker-up.sh"; exit 1; }
docker network inspect "$RESEAU" >/dev/null 2>&1 \
  || { echo "✗ réseau $RESEAU absent → bash scripts/local/01-supabase-up.sh"; exit 1; }
docker exec "$CONTENEUR_PG" pg_isready -U postgres >/dev/null 2>&1 \
  || { echo "✗ Postgres ($CONTENEUR_PG) ne répond pas → bash scripts/local/01-supabase-up.sh"; exit 1; }
echo "  ✓ Docker, réseau et Postgres"

aleatoire() { # $1 = longueur ; alphanumérique, sans caractère à échapper dans une URL
  # Pas de `tr < /dev/urandom | head` : sous pipefail, le SIGPIPE de tr arrête le script.
  local brut
  brut="$(head -c 4096 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9')"
  printf '%s' "${brut:0:$1}"
}

if [ ! -f "$ENV_FICHIER" ]; then
  umask 077
  MDP_NEUF="$(aleatoire 40)"
  CLE_NEUVE="$(aleatoire 48)"
  {
    echo "# Écrit par scripts/local/13-optimisation-up.sh le $(date +%F). NE PAS COMMITER."
    echo "OPTIMISATION_DATABASE_URL=postgresql://optimisation_service:${MDP_NEUF}@${CONTENEUR_PG}:5432/postgres"
    echo "OPTIMISATION_CLE_INTERNE=${CLE_NEUVE}"
    echo "TZ=Europe/Paris"
  } > "$ENV_FICHIER"
  echo "  ✓ $ENV_FICHIER écrit (mot de passe et clé tirés au hasard)"
fi

lire_env() { # $1 = nom ; dernière valeur de la variable dans .env
  sed -n "s/^$1=//p" "$ENV_FICHIER" | tail -n 1 | tr -d '\r'
}
URL="$(lire_env OPTIMISATION_DATABASE_URL)"
CLE="$(lire_env OPTIMISATION_CLE_INTERNE)"
[ -n "$URL" ] || { echo "✗ OPTIMISATION_DATABASE_URL vide dans $ENV_FICHIER"; exit 1; }
[ -n "$CLE" ] || { echo "✗ OPTIMISATION_CLE_INTERNE vide dans $ENV_FICHIER"; exit 1; }
# postgresql://optimisation_service:MOTDEPASSE@hote:port/base
MDP="$(printf '%s' "$URL" | sed -n 's#^postgres\(ql\)\{0,1\}://optimisation_service:\([^@]*\)@.*#\2#p')"
[ -n "$MDP" ] || { echo "✗ OPTIMISATION_DATABASE_URL doit être postgresql://optimisation_service:<mdp>@..."; exit 1; }

# Haché côté client : le mot de passe entre par stdin, le vérificateur SCRAM sort. Rien en argument (visible dans `ps`).
VERIF="$(printf '%s' "$MDP" | uv run --quiet --project "$SERVICE" python -m optimisation.outils.scram)"
case "$VERIF" in
  'SCRAM-SHA-256$'*) ;;
  *) echo "✗ vérificateur SCRAM non calculé (uv run --project $SERVICE python -m optimisation.outils.scram)"; exit 1 ;;
esac
# La variable psql est posée par la PREMIÈRE ligne de stdin (\set), pas par `-v` : rien en argument.
{ printf "\\\\set optimisation_mdp '%s'\n" "$VERIF"; cat sql/342_role_optimisation_service.sql; } \
  | docker exec -i "$CONTENEUR_PG" psql -U postgres -q -v ON_ERROR_STOP=1
unset VERIF MDP
echo "  ✓ sql/342 appliqué (rôle optimisation_service, vérificateur SCRAM)"

docker compose -f "$SERVICE/compose.yaml" up -d --build
echo "  … attente de /sante"

# L'en-tête de la clé est lu sur stdin (`-H @-`), jamais passé en argument.
sante() { printf 'X-Optimisation-Cle: %s\n' "$CLE" | curl -s -H @- "$@" http://127.0.0.1:8090/sante; }
for _ in $(seq 1 30); do
  CODE="$(sante -o /dev/null -w '%{http_code}' || true)"
  if [ "$CODE" = "200" ]; then
    echo "  ✓ /sante : $(sante)"
    exit 0
  fi
  sleep 1
done
echo "✗ /sante ne répond pas 200 (dernier code : ${CODE:-aucun}) → docker logs optimisation_api"
exit 1
