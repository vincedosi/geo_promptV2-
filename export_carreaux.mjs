#!/usr/bin/env node
/**
 * Export carreaux Filosofi → NDJSON via Supabase REST API (RPC paginé)
 * Pas besoin de connexion PostgreSQL directe — utilise le client HTTPS
 *
 * Usage: node scripts/export_carreaux_node.mjs [output_path]
 */

import { createClient } from '@supabase/supabase-js';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

// ── Config ────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = resolve(__dirname, '.env.local');
  const lines = readFileSync(envPath, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return env;
}

const env        = loadEnv();
const SUPA_URL   = env['NEXT_PUBLIC_SUPABASE_URL'];
const SUPA_KEY   = env['SUPABASE_SERVICE_ROLE_KEY'] || env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

if (!SUPA_URL || !SUPA_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant dans .env.local');
  process.exit(1);
}

const BATCH_SIZE  = 5000;
const OUTPUT_FILE = resolve(__dirname, '../genesis_etl/data/processed/carreaux_filosofi.ndjson');
const outputPath  = process.argv[2] ? resolve(process.argv[2]) : OUTPUT_FILE;

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  await mkdir(dirname(outputPath), { recursive: true });

  const supabase = createClient(SUPA_URL, SUPA_KEY, {
    auth: { persistSession: false },
  });

  // Compte total
  const { count } = await supabase
    .from('carreaux_filosofi')
    .select('*', { count: 'exact', head: true })
    .not('metadata', 'is', null)
    .not('geom', 'is', null);

  console.log(`[export] ${count?.toLocaleString('fr-FR') ?? '?'} carreaux à exporter`);
  console.log(`[export] Écriture → ${outputPath}`);

  const out      = createWriteStream(outputPath, { encoding: 'utf8' });
  let written    = 0;
  let lastIdcar  = '';  // keyset cursor — évite le OFFSET lent

  while (true) {
    const { data, error } = await supabase.rpc('export_carreaux_after', {
      p_last_idcar: lastIdcar,
      p_limit:      BATCH_SIZE,
    });

    if (error) {
      console.error('[export] Erreur RPC:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      const geom = JSON.parse(row.geom_json);
      const { idcar, geom_json: _g, ...props } = row;
      props.idcar = idcar;

      const feature = {
        type: 'Feature',
        geometry: geom,
        properties: props,
      };
      out.write(JSON.stringify(feature) + '\n');
      written++;
    }

    lastIdcar = data[data.length - 1].idcar;  // prochain curseur

    if (written % 100_000 < BATCH_SIZE) {
      console.log(`  ${written.toLocaleString('fr-FR')} lignes exportées...`);
    }

    if (data.length < BATCH_SIZE) break;
  }

  out.end();
  console.log(`\n[export] Terminé : ${written.toLocaleString('fr-FR')} carreaux → ${outputPath}`);
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  ÉTAPE SUIVANTE : Générer le fichier PMTiles avec tippecanoe    ║
║                                                                  ║
║  Dans WSL (ou Linux) :                                           ║
║  tippecanoe \\                                                    ║
║    -o carreaux_filosofi.pmtiles \\                                ║
║    -Z 4 -z 14 \\                                                  ║
║    --no-feature-limit --no-tile-size-limit \\                     ║
║    --coalesce-densest-as-needed \\                                ║
║    --extend-zooms-if-still-dropping \\                            ║
║    -l carreaux \\                                                  ║
║    carreaux_filosofi.ndjson                                      ║
╚══════════════════════════════════════════════════════════════════╝
`);
}

main().catch(err => {
  console.error('[export] Fatal:', err);
  process.exit(1);
});
