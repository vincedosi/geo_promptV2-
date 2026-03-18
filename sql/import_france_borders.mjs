/**
 * import_france_borders.mjs
 * Télécharge les frontières France précises et met à jour france_borders.
 * Usage : node sql/import_france_borders.mjs
 */

import { readFileSync, existsSync } from 'fs';

const envPath = '.env.local';
if (!existsSync(envPath)) {
  console.error('! .env.local introuvable');
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(envPath, 'utf-8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim().replace(/^["']|["']$/g, '')]; })
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('! Variables manquantes');
  process.exit(1);
}

const HEADERS = {
  'apikey': SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal',
};

async function execSQL(sql) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ sql }),
  });
  if (!res.ok) {
    // exec_sql n'existe pas — on utilise pg_dump via l'URL SQL directe
    return { error: await res.text() };
  }
  return { error: null };
}

async function run() {
  // ── Télécharger GeoJSON France métropole + outre-mer ─────────────────────
  console.log('Téléchargement frontières France (gregoiredavid/france-geojson)...');
  const geoRes = await fetch(
    'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/metropole-et-outre-mer.geojson'
  );
  if (!geoRes.ok) throw new Error(`HTTP ${geoRes.status}`);
  const geojson = await geoRes.json();
  console.log(`✓ GeoJSON téléchargé — type: ${geojson.type}`);

  // Extraire la géométrie (Feature ou FeatureCollection)
  const features = geojson.type === 'FeatureCollection'
    ? geojson.features
    : [geojson];

  // ── Vider l'ancienne table ────────────────────────────────────────────────
  console.log('Suppression anciens polygones...');
  const delRes = await fetch(`${SUPABASE_URL}/rest/v1/france_borders?id=gt.0`, {
    method: 'DELETE',
    headers: HEADERS,
  });
  if (!delRes.ok) {
    console.warn('! DELETE échoué:', await delRes.text());
  } else {
    console.log('✓ Table vidée');
  }

  // ── Insérer via PostgREST RPC ─────────────────────────────────────────────
  // On utilise la RPC upsert_france_borders si elle existe,
  // sinon on insère le GeoJSON encodé dans la colonne geom via SQL direct.

  let inserted = 0;
  for (const feat of features) {
    const geomStr = JSON.stringify(feat.geometry ?? feat).replace(/'/g, "''");

    // Tentative via RPC exec_sql (nécessite extension pg_net ou function exec_sql)
    const { error } = await execSQL(
      `INSERT INTO france_borders (geom) VALUES (ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON('${geomStr}'), 4326)))`
    );

    if (error) {
      // Fallback : afficher le SQL à coller dans le Dashboard
      console.log('\n[!] exec_sql non disponible — coller ce SQL dans Supabase Dashboard SQL Editor:');
      console.log('---');
      console.log('DELETE FROM france_borders;');
      for (const f of features) {
        const g = JSON.stringify(f.geometry ?? f).replace(/'/g, "''");
        console.log(`INSERT INTO france_borders (geom) VALUES (ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON('${g}'), 4326)));`);
      }
      console.log('---');
      return;
    }
    inserted++;
  }

  console.log(`\n✓ ${inserted} polygone(s) insérés dans france_borders`);
  console.log('✓ get_isochrone_battle v10 utilisera les vraies frontières');
}

run().catch(err => {
  console.error('! Erreur:', err.message);
  process.exit(1);
});
