/**
 * Diagnostic bulk API Atmo Data v2 — à lancer avec les creds du compte Atmo :
 *
 *   ATMO_FRANCE_USERNAME=... ATMO_FRANCE_PASSWORD=... npx tsx scripts/test_atmo_bulk.ts
 *   (ou renseigner les variables dans .env.local puis : npx tsx --env-file=.env.local scripts/test_atmo_bulk.ts)
 *
 * Vérifie ce que l'API accepte réellement pour l'ingestion nationale pollen
 * (lib/civic-health/pollen-ingest.ts) :
 *   A. dataset 122, filtre date seule            → France entière en 1 appel ?
 *   B. dataset 122, filtre date + code_qual >= 3 → filtre serveur sur l'indice ?
 *   C. dataset 122, filtre date + aasqa = 11     → repli par région AASQA ?
 *
 * Affiche pour chaque essai : nb de lignes, communes distinctes, champs présents.
 */
import { fetchDatasetRaw, loginWithEnv } from '../lib/civic-health/atmofrance-client';

const DATASET_POLLEN = 122;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function tryCase(
  label: string,
  filter: Record<string, { operator: string; value: string | number }>,
  token: string,
): Promise<void> {
  console.log(`\n── ${label}`);
  console.log(`   filtre : ${JSON.stringify(filter)}`);
  const t0 = Date.now();
  try {
    const rows = await fetchDatasetRaw(DATASET_POLLEN, filter, token, 120_000);
    const communes = new Set(rows.map(r => r.code_zone));
    const sample = rows[0] ?? {};
    console.log(`   ✅ ${rows.length} lignes · ${communes.size} communes distinctes · ${Date.now() - t0} ms`);
    console.log(`   champs : ${Object.keys(sample).join(', ')}`);
    if (rows[0]) console.log(`   exemple : ${JSON.stringify(rows[0]).slice(0, 300)}`);
  } catch (err) {
    console.log(`   ❌ ${err instanceof Error ? err.message : err} · ${Date.now() - t0} ms`);
  }
}

async function main() {
  console.log('Login Atmo Data…');
  const token = await loginWithEnv();
  console.log('Token OK.');
  const date = today();

  await tryCase('A — France entière (date seule)', {
    date_ech: { operator: '=', value: date },
  }, token);

  await tryCase('B — France entière + code_qual >= 3', {
    date_ech: { operator: '=', value: date },
    code_qual: { operator: '>=', value: 3 },
  }, token);

  await tryCase('C — AASQA Île-de-France (aasqa = 11)', {
    aasqa: { operator: '=', value: '11' },
    date_ech: { operator: '=', value: date },
  }, token);

  console.log('\nInterprétation :');
  console.log('  A OK (>30k lignes)  → l\'ingestion utilisera 1 appel/jour, rien à changer.');
  console.log('  A KO mais C OK      → l\'ingestion basculera d\'elle-même sur 18 appels AASQA/jour.');
  console.log('  A et C KO           → la carte CP restera vide, l\'échelle département continue de fonctionner.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
