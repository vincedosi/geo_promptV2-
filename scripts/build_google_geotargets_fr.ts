/**
 * Génère lib/digital/google-geo-postal-fr.json — mapping code postal français
 * → Criteria ID Google (geotargets), utilisé par l'export DV360 (SDF + push API).
 *
 * Source : CSV geotargets officiel Google Ads
 * https://developers.google.com/google-ads/api/data/geotargets
 *
 * Usage :
 *   npx tsx scripts/build_google_geotargets_fr.ts <chemin/geotargets-YYYY-MM-DD.csv> [sortie.json]
 *
 * Le fichier généré est committé dans le repo (référentiel versionné par la date
 * de release Google, ~6k entrées) : aucune table DB, zéro I/O Nano à l'export.
 */
import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';

interface GeoTargetRow {
  'Criteria ID': string;
  Name: string;
  'Canonical Name': string;
  'Parent ID': string;
  'Country Code': string;
  'Target Type': string;
  Status: string;
}

const DEFAULT_OUTPUT = path.join(__dirname, '..', 'lib', 'digital', 'google-geo-postal-fr.json');

function main(): void {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage : npx tsx scripts/build_google_geotargets_fr.ts <geotargets.csv> [sortie.json]');
    process.exit(1);
  }
  const outputPath = process.argv[3] ?? DEFAULT_OUTPUT;

  // La date de version Google est dans le nom du fichier (geotargets-YYYY-MM-DD.csv)
  const versionMatch = path.basename(csvPath).match(/(\d{4}-\d{2}-\d{2})/);
  const version = versionMatch ? versionMatch[1] : 'unknown';

  console.log(`[1/3] Parsing ${csvPath}…`);
  const raw = fs.readFileSync(csvPath, 'utf-8');
  const parsed = Papa.parse<GeoTargetRow>(raw, { header: true, skipEmptyLines: true });
  if (parsed.errors.length > 0) {
    console.error(`Erreurs de parsing (${parsed.errors.length}), première :`, parsed.errors[0]);
    process.exit(1);
  }
  console.log(`      ${parsed.data.length} lignes geotargets monde`);

  console.log('[2/3] Filtrage France / Postal Code / Active…');
  const postal: Record<string, number> = {};
  let skippedInvalid = 0;
  for (const row of parsed.data) {
    if (row['Country Code'] !== 'FR') continue;
    if (row['Target Type'] !== 'Postal Code') continue;
    if (row.Status !== 'Active') continue;
    const cp = row.Name.trim();
    const id = Number(row['Criteria ID']);
    if (!/^\d{5}$/.test(cp) || !Number.isFinite(id)) {
      skippedInvalid++;
      continue;
    }
    postal[cp] = id;
  }
  const count = Object.keys(postal).length;
  console.log(`      ${count} codes postaux FR mappés (${skippedInvalid} lignes écartées)`);
  if (count === 0) {
    console.error('Aucun code postal FR trouvé — colonnes ou filtre à vérifier.');
    process.exit(1);
  }

  console.log(`[3/3] Écriture ${outputPath}…`);
  const output = {
    _source: 'https://developers.google.com/google-ads/api/data/geotargets',
    _version: version,
    _target_type: 'Postal Code',
    _country: 'FR',
    count,
    postal,
  };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf-8');
  console.log(`Terminé : ${count} entrées, version geotargets ${version}.`);
}

main();
