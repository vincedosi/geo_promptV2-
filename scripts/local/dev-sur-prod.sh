#!/usr/bin/env bash
# Lance `npm run dev` contre la base de PRODUCTION, sans toucher aux fichiers
# d'environnement.
#
# ── POURQUOI CE SCRIPT EXISTE ────────────────────────────────────────────────
#
# Le geste evident — renommer `.env.development.local` pour que Next retombe
# sur `.env.local` — a un effet de bord qui ne se voit pas : `npm test` lit LE
# MEME fichier, avec la meme regle de repli. Le renommer envoie donc AUSSI la
# suite d'integration sur la production, avec la cle `service_role`. C'est
# exactement la regression corrigee le 2026-09-18 au matin, re-introduite le
# meme jour l'apres-midi par une bascule faite a la main.
#
# Ici, les valeurs de production sont passees par l'ENVIRONNEMENT du processus.
# Next.js ne remplace jamais une variable deja posee dans `process.env` : elles
# priment donc sur `.env.development.local`, qui reste en place et continue de
# pointer `npm test` sur le stack local.
#
# Usage :  bash scripts/local/dev-sur-prod.sh
#
# ⚠ L'application servie parle alors a la PROD. Les lectures sont sans danger ;
#   les routes qui ecrivent (dont `/api/risques/[siteId]/exposition`, qui
#   alimente son cache) ecrivent pour de vrai.
set -euo pipefail
cd "$(dirname "$0")/../.."

[ -f .env.local ] || { echo "ERREUR : .env.local introuvable." >&2; exit 1; }

# Une seule lecture du fichier, sans l'exporter en entier : on ne prend que les
# trois variables qui designent la base.
val() { grep -E "^$1=" .env.local | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r"; }

NEXT_PUBLIC_SUPABASE_URL="$(val NEXT_PUBLIC_SUPABASE_URL)"
NEXT_PUBLIC_SUPABASE_ANON_KEY="$(val NEXT_PUBLIC_SUPABASE_ANON_KEY)"
SUPABASE_SERVICE_ROLE_KEY="$(val SUPABASE_SERVICE_ROLE_KEY)"
export NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY

case "$NEXT_PUBLIC_SUPABASE_URL" in
  *127.0.0.1*|*localhost*)
    echo "ERREUR : .env.local pointe une base LOCALE, pas la production." >&2
    exit 1;;
esac

echo "▶ dev sur la PRODUCTION : $NEXT_PUBLIC_SUPABASE_URL"
echo "  (.env.development.local reste en place — npm test continue en local)"
exec npm run dev
