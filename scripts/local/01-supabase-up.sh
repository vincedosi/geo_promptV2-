#!/usr/bin/env bash
# Monte le stack Supabase local (Postgres 17 + PostGIS, PostgREST, GoTrue,
# Realtime, Storage, Studio) declare dans supabase/config.toml.
#
# Le premier lancement telecharge ~2,5 Go d'images : c'est long, une seule fois.
# Ports : API 54321 · Postgres 54322 · Studio 54323 · Inbucket (mails) 54324.
#
# ⚠ `[db.migrations] enabled = false` dans config.toml : le schema local vient
# du DUMP DE PROD (script 02/03), pas des 43 fichiers de supabase/migrations/,
# qui n'ont jamais ete l'historique reel du projet — les migrations vivantes
# sont les ~150 fichiers de sql/, appliques par le MCP Supabase. Les laisser
# tourner poserait un schema partiel que le restore viendrait contredire.
set -euo pipefail
cd "$(dirname "$0")/../.."

npx supabase start
echo
npx supabase status
