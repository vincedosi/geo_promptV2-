#!/usr/bin/env bash
# Ecrit .env.development.local pour faire pointer l'app sur le Supabase LOCAL.
#
# Pourquoi ce fichier et pas .env.local : Next.js charge
# `.env.development.local` AVANT `.env.local` en mode dev, donc il SURCHARGE
# les variables Supabase sans qu'on touche au fichier qui porte les cles de
# prod. Repasser sur la prod = renommer ce fichier, rien d'autre.
#
# ⚠ Il n'est lu qu'en dev (`npm run dev`). `npm run build` et `npm test`
# continuent de parler a la PROD — c'est voulu, mais il faut le savoir.
set -euo pipefail
cd "$(dirname "$0")/../.."

STATUS=$(npx supabase status -o env)
extraire() { echo "$STATUS" | grep -E "^$1=" | head -1 | sed -E 's/^[^=]+=//; s/^"//; s/"$//'; }

API_URL=$(extraire API_URL)
ANON=$(extraire ANON_KEY)
SERVICE=$(extraire SERVICE_ROLE_KEY)
DB_URL=$(extraire DB_URL)

if [ -z "$API_URL" ] || [ -z "$ANON" ]; then
  echo "⛔ 'supabase status' n'a rien rendu — le stack local est-il demarre ?"
  exit 1
fi

cat > .env.development.local <<VARS
# Genere par scripts/local/04-env-local.sh — Supabase LOCAL.
# Surcharge .env.local en mode dev uniquement. Supprimer ou renommer ce
# fichier fait repasser \`npm run dev\` sur la prod.
NEXT_PUBLIC_SUPABASE_URL="$API_URL"
NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON"
SUPABASE_ANON_KEY="$ANON"
SUPABASE_SERVICE_ROLE_KEY="$SERVICE"
SUPABASE_DB_URL="$DB_URL"
DATABASE_URL="$DB_URL"
VARS

echo "→ .env.development.local ecrit (API $API_URL)"
echo "  Studio : http://127.0.0.1:54323 · mails : http://127.0.0.1:54324"
